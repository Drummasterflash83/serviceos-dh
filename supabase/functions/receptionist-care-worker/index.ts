// Scheduled worker. No endpoint can modify Vapi; provider writes are a separate release gate.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { scanProviderCalls, careSafeError } from "../_shared/care-provider-scan.ts";
import { runCareReview, type CareJob } from "../_shared/care-review-job.ts";
import {
  deliverCareAlert,
  reconcileCareDelivery,
  type CareAlert,
} from "../_shared/care-alert-delivery.ts";
import { evidenceHash, type Assessment } from "../_shared/receptionist-care.ts";
import { careSecretMatches } from "../_shared/care-worker-auth.ts";
import { careFeedbackReport } from "../_shared/care-feedback-report.ts";

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers });
Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("RECEPTIONIST_CARE_WORKER_SECRET");
  if (!careSecretMatches(secret, req.headers.get("x-care-secret")))
    return reply({ error: "Unauthorised" }, 401);
  let lane: string;
  try {
    const body = await req.json();
    lane = body.action === "readiness" ? "readiness" : body.lane;
  } catch {
    return reply({ error: "A worker lane is required" }, 400);
  }
  if (!["alerts", "scan", "review", "readiness"].includes(lane))
    return reply({ error: "Invalid worker lane" }, 400);
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const counts = { scans: 0, reviews: 0, alerts: 0, reconciled: 0, superseded: 0, failed: 0 };
  async function rpc(name: string, args: Record<string, unknown> = {}) {
    const r = await db.rpc(name, args);
    if (r.error) throw Error("worker_store_unavailable");
    return r.data;
  }
  async function acknowledge(name: string, args: Record<string, unknown>) {
    if ((await rpc(name, args)) !== true) throw Error("worker_store_unavailable");
  }
  async function workspace(tenant: string) {
    const r = await db
      .from("receptionist_workspaces")
      .select("assistant_id,vapi_secret_name,company")
      .eq("tenant_id", tenant)
      .single();
    if (r.error) throw Error("review_connection_required");
    return { ...r.data, key: Deno.env.get(r.data.vapi_secret_name) ?? "" };
  }
  try {
    if (lane === "readiness") {
      if (
        ![
          "OPENFOLK_SLACK_BOT_TOKEN",
          "OPENFOLK_SLACK_TEAM_ID",
          "OPENFOLK_REVIEW_OPENAI_KEY",
          "OPENFOLK_REVIEW_MODEL",
        ].every((name) => Deno.env.get(name))
      )
        return reply({ error: "Review and Slack connections await setup" }, 503);
      const receipt = await rpc("care_record_worker_readiness", { p_version: "care-worker-v1" });
      return reply({ receipt, version: "care-worker-v1", providerChanges: 0 });
    }
    // Independent alert lane runs even when review credit/provider is unavailable.
    if (lane === "alerts") await rpc("care_schedule_escalations");
    if (lane === "alerts" && Deno.env.get("OPENFOLK_SLACK_BOT_TOKEN")) {
      const unknown = await db
        .from("receptionist_alert_outbox")
        .select("id,team_id,channel_id,client_msg_id,created_at")
        .eq("state", "delivery_unknown")
        .order("updated_at")
        .limit(1);
      if (unknown.error) throw Error("worker_store_unavailable");
      for (const held of unknown.data) {
        try {
          const receipt = await reconcileCareDelivery(held, {
            token: Deno.env.get("OPENFOLK_SLACK_BOT_TOKEN")!,
            allowedTeam: Deno.env.get("OPENFOLK_SLACK_TEAM_ID") ?? "",
          });
          if (
            receipt &&
            (await rpc("care_reconcile_alert", {
              p_id: held.id,
              p_channel: receipt.channel,
              p_ts: receipt.ts,
              p_checked_absent: false,
            }))
          )
            counts.reconciled++;
        } catch {
          /* Unknown remains unknown; a failed lookup is never absence. */
        }
        // Round-robin receipt checks; preserve created_at and held state for the operator.
        await db
          .from("receptionist_alert_outbox")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", held.id)
          .eq("state", "delivery_unknown");
      }
    }
    const alerts = (
      lane === "alerts"
        ? await rpc("care_claim_alerts", {
            p_limit: 1,
            p_lease_seconds: 180,
          })
        : []
    ) as CareAlert[];
    for (const alert of alerts) {
      const delivery = await deliverCareAlert(alert, {
        token: Deno.env.get("OPENFOLK_SLACK_BOT_TOKEN") ?? "",
        allowedTeam: Deno.env.get("OPENFOLK_SLACK_TEAM_ID") ?? "",
        currentRoute: async () => {
          const r = await db
            .from("module_alert_routes")
            .select("team_id,channel_id,enabled")
            .eq("tenant_id", alert.tenant_id)
            .eq("module", "receptionist")
            .eq("kind", alert.kind)
            .single();
          if (r.error) throw Error("slack_destination_unapproved");
          return r.data;
        },
        issue: async () => {
          const r = await db
            .from("receptionist_care_issues")
            .select("title,priority,stage,feedback_id,source_key")
            .eq("tenant_id", alert.tenant_id)
            .eq("id", alert.issue_id)
            .single();
          if (r.error) throw Error("worker_store_unavailable");
          const w = await workspace(alert.tenant_id);
          // Initial reports and reopened findings retain the full report. Routine status changes
          // and repeated escalation reminders point back to it instead of retransmitting it.
          const report =
            alert.reason === "event" && alert.kind !== "updates"
              ? await careFeedbackReport(
                  { ...r.data, tenant_id: alert.tenant_id },
                  {
                    workspace: async () => w,
                    feedback: async (tenant, id) => {
                      const result = await db
                        .from("receptionist_feedback")
                        .select("id,tenant_id,call_id,practice_session_id,title,body")
                        .eq("tenant_id", tenant)
                        .eq("id", id)
                        .maybeSingle();
                      if (result.error) throw Error("feedback_unavailable");
                      return result.data;
                    },
                    practiceSession: async (tenant, call, session) => {
                      let query = db
                        .from("receptionist_practice_sessions")
                        .select("id,tenant_id,call_id")
                        .eq("tenant_id", tenant);
                      query = session ? query.eq("id", session) : query.eq("call_id", call!);
                      const result = await query.maybeSingle();
                      if (result.error) throw Error("call_scope_invalid");
                      return result.data;
                    },
                  },
                )
              : null;
          return { ...r.data, company: w.company, report };
        },
        ack: (channel, timestamp) =>
          acknowledge("care_ack_alert", {
            p_id: alert.id,
            p_lease: alert.lease_id,
            p_channel: channel,
            p_ts: timestamp,
          }),
        fail: (error, uncertain) =>
          acknowledge("care_fail_alert", {
            p_id: alert.id,
            p_lease: alert.lease_id,
            p_error: error,
            p_uncertain: uncertain,
          }),
      });
      if (delivery.delivered) counts.alerts++;
      else counts.failed++;
    }
    // An overlapping, bounded updated-time scan finds late-ended and revised calls.
    // Never advance the checkpoint after partial enumeration, failed writes or scope mismatch.
    const scans =
      lane === "scan" ? await rpc("care_claim_scans", { p_limit: 1, p_lease_seconds: 180 }) : [];
    for (const scan of scans) {
      try {
        const w = await workspace(scan.tenant_id);
        const through = scan.scan_cutoff ?? new Date().toISOString();
        const from = scan.last_scan_at
          ? new Date(Math.max(0, Date.parse(scan.last_scan_at) - 86400000)).toISOString()
          : new Date(0).toISOString();
        const result = await scanProviderCalls({
          key: w.key,
          assistantId: w.assistant_id,
          from,
          through,
          maxRequests: 12,
          maxDurationMs: 45000,
          pending: scan.scan_pending_windows ?? [],
          observe: async (calls) => {
            for (let offset = 0; offset < calls.length; offset += 100) {
              const items = await Promise.all(
                calls.slice(offset, offset + 100).map(async (call) => ({
                  call_id: call.id,
                  observation_key: await evidenceHash({
                    updatedAt: call.updatedAt,
                    status: call.status,
                    rulesVersion: scan.version,
                  }),
                  observed_at: call.updatedAt,
                  source: "provider",
                })),
              );
              await rpc("care_enqueue_reviews_batch", { p_tenant: scan.tenant_id, p_items: items });
            }
          },
        });
        await acknowledge(result.complete ? "care_complete_scan" : "care_pause_scan", {
          p_tenant: scan.tenant_id,
          p_lease: scan.lease_id,
          p_cutoff: through,
          p_count: (scan.scan_pending_count ?? 0) + result.count,
          ...(!result.complete ? { p_windows: result.pending } : {}),
        });
        if (result.complete) counts.scans++;
      } catch (error) {
        counts.failed++;
        await acknowledge("care_fail_scan", {
          p_tenant: scan.tenant_id,
          p_lease: scan.lease_id,
          p_error: careSafeError(error),
        });
      }
    }
    // Claim one at a time: a credit failure does not strand a batch of unrelated clients.
    for (let n = 0; lane === "review" && n < 1; n++) {
      const jobs = (await rpc("care_claim_reviews", {
        p_limit: 1,
        p_lease_seconds: 180,
      })) as CareJob[];
      if (!jobs.length) break;
      const job = jobs[0];
      try {
        await runCareReview(job, {
          reviewKey: Deno.env.get("OPENFOLK_REVIEW_OPENAI_KEY") ?? "",
          model: Deno.env.get("OPENFOLK_REVIEW_MODEL") ?? "",
          workspace,
          settings: async (tenant) => {
            const r = await db
              .from("receptionist_review_settings")
              .select("approved_rules,version,enabled")
              .eq("tenant_id", tenant)
              .single();
            if (r.error) throw Error("approved_rules_required");
            return r.data;
          },
          practiceSession: async (tenant, call) => {
            const r = await db
              .from("receptionist_practice_sessions")
              .select("id")
              .eq("tenant_id", tenant)
              .eq("call_id", call)
              .maybeSingle();
            if (r.error) throw Error("call_scope_invalid");
            return r.data?.id ?? null;
          },
          feedback: async (tenant, call) => {
            const feedback: string[] = [];
            for (let page = 0; ; page++) {
              const r = await db
                .from("receptionist_feedback")
                .select("body")
                .eq("tenant_id", tenant)
                .eq("call_id", call)
                .order("id")
                .range(page * 100, (page + 1) * 100 - 1);
              if (r.error) throw Error("feedback_unavailable");
              feedback.push(...r.data.map((row) => row.body));
              if (feedback.join("\n").length > 20000) throw Error("evidence_too_large");
              if (r.data.length < 100) break;
            }
            return feedback;
          },
          cached: async (tenant, call, hash, reviewer) => {
            const r = await db
              .from("receptionist_call_reviews")
              .select("assessment")
              .eq("tenant_id", tenant)
              .eq("call_id", call)
              .eq("evidence_hash", hash)
              .eq("reviewer_version", reviewer)
              .eq("state", "reviewed")
              .maybeSingle();
            if (r.error) throw Error("review_store_unavailable");
            return (r.data?.assessment as Assessment) ?? null;
          },
          complete: async (job, hash, reviewer, assessment) => {
            const accepted = await rpc("care_complete_review", {
              p_tenant: job.tenant_id,
              p_call: job.call_id,
              p_lease: job.lease_id,
              p_hash: hash,
              p_reviewer: reviewer,
              p_assessment: assessment,
            });
            if (accepted !== true) throw Error("review_lease_superseded");
          },
        });
        counts.reviews++;
      } catch (error) {
        const code = careSafeError(error);
        if (code === "review_lease_superseded") {
          counts.superseded++;
          continue;
        }
        counts.failed++;
        await acknowledge("care_fail_review", {
          p_tenant: job.tenant_id,
          p_call: job.call_id,
          p_lease: job.lease_id,
          p_error: code,
          p_retryable: ![
            "call_scope_invalid",
            "evidence_too_large",
            "assessment_evidence_invalid",
          ].includes(code),
          p_delay_seconds: ["awaiting_transcript", "awaiting_completed_call"].includes(code)
            ? 300
            : 60,
        });
        if (["review_credit_required", "review_connection_required"].includes(code)) break;
      }
    }
    return reply({ ...counts, providerChanges: 0 });
  } catch {
    return reply(
      { error: "Care worker did not complete. Pending work remains recoverable.", ...counts },
      503,
    );
  }
});
