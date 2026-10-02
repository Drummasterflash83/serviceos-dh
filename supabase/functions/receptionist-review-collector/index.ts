import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { timingSafeEqualStr } from "../_shared/marketing_tracking.ts";
import { normalizeCall, record } from "../_shared/receptionist-data.ts";
import { evidenceHash, reviewConversation, REVIEW_VERSION } from "../_shared/receptionist-care.ts";
import {
  AUTO_REVIEW_LIMIT,
  AUTO_REVIEW_PAGE_SIZE,
  liveCallOwned,
  queuedCallOwned,
  reviewPage,
  reviewCallType,
  safeAutoReviewError,
  feedbackEvidence,
} from "../_shared/receptionist-auto-review.ts";
import { sendSlackMessage, verifySlackChannel } from "../_shared/notification-slack.ts";

// Private scheduler only. This worker reads Vapi, reviews evidence and creates
// care tasks. There is deliberately no provider PATCH or automatic fix path.
Deno.serve(async (req) => {
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("WORKER_SECRET");
  if (!secret || !timingSafeEqualStr(secret, req.headers.get("x-schedule-secret") ?? ""))
    return reply({ error: "Scheduler required" }, 401);
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const aiKey = Deno.env.get("OPENAI_EMMA_REVIEW_KEY");
  const model = Deno.env.get("OPENAI_EMMA_REVIEW_MODEL") || "gpt-4.1-mini";
  const totals = {
    scanned: 0,
    enqueued: 0,
    reviewed: 0,
    waiting: 0,
    failed: 0,
    alertsSent: 0,
    providerChanges: 0,
  };
  const get = async (path: string, key: string) => {
    const response = await fetch("https://api.vapi.ai/" + path, {
      headers: { Authorization: "Bearer " + key },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error("provider_unavailable");
    return response.json();
  };
  try {
    const settings = await db
      .from("receptionist_review_settings")
      .select("tenant_id")
      .eq("enabled", true)
      .order("last_scan_at", { nullsFirst: true })
      .limit(10);
    if (settings.error) throw Error("Could not load enabled review settings");
    for (const setting of settings.data ?? []) {
      const claimed = await db.rpc("care_auto_scan_claim", { p_tenant: setting.tenant_id });
      if (claimed.error) {
        totals.failed++;
        continue;
      }
      const s = claimed.data?.[0];
      if (!s) continue;
      try {
        const workspace = await db
          .from("receptionist_workspaces")
          .select("assistant_id,vapi_secret_name")
          .eq("tenant_id", s.tenant_id)
          .single();
        const key = workspace.data && Deno.env.get(workspace.data.vapi_secret_name);
        if (workspace.error || !key) throw Error("review_connection_unavailable");
        const owners = await db
          .from("receptionist_workspaces")
          .select("tenant_id")
          .eq("assistant_id", workspace.data.assistant_id)
          .limit(2);
        if (owners.error || owners.data?.length !== 1 || owners.data[0].tenant_id !== s.tenant_id)
          throw Error("call_workspace_mismatch");
        const params = new URLSearchParams({
          assistantId: workspace.data.assistant_id,
          limit: String(AUTO_REVIEW_PAGE_SIZE),
          createdAtGe: s.scan_window_start,
          createdAtLt: s.scan_before ?? s.scan_window_end,
        });
        const page = reviewPage(
          await get("call?" + params, key),
          s.scan_before ?? s.scan_window_end,
        );
        const rows = page.rows
          .filter(
            (c) =>
              liveCallOwned(c, workspace.data.assistant_id) &&
              Date.parse(String(c.createdAt)) >= Date.parse(s.scan_window_start),
          )
          .map((c) => ({
            tenant_id: s.tenant_id,
            call_id: c.id,
            reviewer_version: REVIEW_VERSION,
            call_kind: "live",
            call_created_at: c.createdAt,
          }));
        if (rows.length) {
          const queued = await db
            .from("receptionist_auto_review_queue")
            .upsert(rows, {
              onConflict: "tenant_id,call_id,reviewer_version",
              ignoreDuplicates: true,
            })
            .select("id");
          if (queued.error) throw Error("review_save_failed");
          totals.enqueued += queued.data?.length ?? 0;
        }
        // Practice calls use transient assistants, so their trusted session rows
        // are scanned separately. Ownership is checked again against Vapi below.
        const practice = await db.rpc("care_auto_enqueue_practice", {
          p_tenant: s.tenant_id,
          p_from: s.scan_window_start,
          p_until: s.scan_window_end,
          p_reviewer: REVIEW_VERSION,
        });
        if (practice.error) throw Error("review_save_failed");
        const saved = await db
          .from("receptionist_review_settings")
          .update(
            page.exhausted
              ? {
                  last_scan_at: s.scan_window_end,
                  scan_state: "scan_complete",
                  scan_window_start: null,
                  scan_window_end: null,
                  scan_before: null,
                  scan_lease: null,
                  scan_lease_until: null,
                }
              : {
                  scan_before: page.nextBefore,
                  scan_state: "more_calls_to_scan",
                  scan_lease: null,
                  scan_lease_until: null,
                },
          )
          .eq("tenant_id", s.tenant_id)
          .eq("scan_lease", s.scan_lease);
        if (saved.error) throw Error("review_save_failed");
        totals.scanned++;
      } catch (error) {
        totals.failed++;
        await db
          .from("receptionist_review_settings")
          .update({
            scan_state: safeAutoReviewError(error),
            scan_lease: null,
            scan_lease_until: null,
          })
          .eq("tenant_id", s.tenant_id)
          .eq("scan_lease", s.scan_lease);
      }
    }

    for (let index = 0; index < AUTO_REVIEW_LIMIT; index++) {
      const claim = await db.rpc("care_auto_review_claim");
      if (claim.error) throw Error("Could not claim review work");
      const q = claim.data?.[0];
      if (!q) break;
      const finish = async (values: Record<string, unknown>) => {
        const saved = await db
          .from("receptionist_auto_review_queue")
          .update({
            ...values,
            lease_id: null,
            lease_until: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", q.id)
          .eq("tenant_id", q.tenant_id)
          .eq("state", "running")
          .eq("lease_id", q.lease_id)
          .select("id");
        if (saved.error || saved.data?.length !== 1) throw Error("review_save_failed");
      };
      let aiStarted = false;
      try {
        const [workspace, rules, existing] = await Promise.all([
          db
            .from("receptionist_workspaces")
            .select("assistant_id,vapi_secret_name")
            .eq("tenant_id", q.tenant_id)
            .single(),
          db
            .from("receptionist_review_settings")
            .select("enabled,approved_rules,version")
            .eq("tenant_id", q.tenant_id)
            .single(),
          db
            .from("receptionist_call_reviews")
            .select("evidence_hash,assessment")
            .eq("tenant_id", q.tenant_id)
            .eq("call_id", q.call_id)
            .eq("reviewer_version", q.reviewer_version)
            .eq("state", "reviewed")
            .limit(1)
            .maybeSingle(),
        ]);
        if (workspace.error || rules.error || existing.error)
          throw Error("review_connection_unavailable");
        if (!rules.data.enabled) {
          await finish({
            state: "pending",
            next_attempt_at: new Date(Date.now() + 3600000).toISOString(),
          });
          continue;
        }
        if (existing.data) {
          const recovered = await db.rpc("care_auto_store_review", {
            p_queue: q.id,
            p_lease: q.lease_id,
            p_hash: existing.data.evidence_hash,
            p_assessment: existing.data.assessment,
            p_model: existing.data.assessment?.model ?? model,
            p_rules_version: existing.data.assessment?.rulesVersion ?? rules.data.version,
          });
          if (recovered.error) throw Error("review_save_failed");
          totals.reviewed++;
          continue;
        }
        const providerKey = Deno.env.get(workspace.data.vapi_secret_name);
        if (!providerKey || !aiKey) throw Error("review_connection_unavailable");
        if (!rules.data.approved_rules?.trim()) throw Error("approved_rules_required");
        if (q.call_kind === "live") {
          const owners = await db
            .from("receptionist_workspaces")
            .select("tenant_id")
            .eq("assistant_id", workspace.data.assistant_id)
            .limit(2);
          if (owners.error || owners.data?.length !== 1 || owners.data[0].tenant_id !== q.tenant_id)
            throw Error("call_workspace_mismatch");
        }
        const rawCall = record(await get("call/" + q.call_id, providerKey));
        if (!queuedCallOwned(rawCall, q, workspace.data.assistant_id))
          throw Error("call_workspace_mismatch");
        const call = normalizeCall(rawCall);
        if (call.status !== "ended" || !call.transcript?.trim()) throw Error("awaiting_transcript");
        // Let the provider finish its end-of-call artifact before assessing it.
        if (
          typeof rawCall.endedAt === "string" &&
          Date.now() - Date.parse(rawCall.endedAt) < 120000
        )
          throw Error("awaiting_transcript");
        let feedbackQuery = db
          .from("receptionist_feedback")
          .select("title,body,priority,category")
          .eq("tenant_id", q.tenant_id);
        feedbackQuery =
          q.call_kind === "practice" && q.practice_session_id
            ? feedbackQuery.or(
                `call_id.eq.${q.call_id},practice_session_id.eq.${q.practice_session_id}`,
              )
            : feedbackQuery.eq("call_id", q.call_id);
        const feedback = await feedbackQuery.order("created_at").limit(20);
        if (feedback.error) throw Error("review_connection_unavailable");
        const notes = q.feedback_id
          ? [feedbackEvidence(q.feedback_snapshot)]
          : (feedback.data ?? []).map(feedbackEvidence);
        const approvedRules =
          "Operator-approved configuration snapshot; historical call-time instructions may differ. Do not infer audio quality or successful telephone delivery from text.\n" +
          rules.data.approved_rules;
        const hash = await evidenceHash({
          transcript: call.transcript,
          feedback: notes,
          rules: approvedRules,
          rulesVersion: rules.data.version,
          kind: q.call_kind,
        });
        const cached = await db
          .from("receptionist_call_reviews")
          .select("assessment")
          .eq("tenant_id", q.tenant_id)
          .eq("call_id", q.call_id)
          .eq("evidence_hash", hash)
          .eq("state", "reviewed")
          .like("reviewer_version", REVIEW_VERSION + "%")
          .limit(1)
          .maybeSingle();
        if (cached.error) throw Error("review_connection_unavailable");
        let assessment = cached.data?.assessment;
        if (!assessment) {
          const reserved = await db.rpc("care_auto_review_reserve_evidence", {
            p_id: q.id,
            p_lease: q.lease_id,
            p_hash: hash,
          });
          if (reserved.data === "evidence_busy") throw Error("review_evidence_in_progress");
          if (reserved.error || reserved.data !== "reserved") throw Error("daily_review_safeguard");
          aiStarted = true;
          assessment = await reviewConversation({
            transcript: call.transcript,
            approvedRules,
            feedback: notes,
            callType: reviewCallType(q.call_kind),
            key: aiKey,
            model,
          });
        }
        const savedModel = cached.data?.assessment?.model ?? model;
        const stored = await db.rpc("care_auto_store_review", {
          p_queue: q.id,
          p_lease: q.lease_id,
          p_hash: hash,
          p_model: savedModel,
          p_rules_version: rules.data.version,
          p_assessment: {
            ...assessment,
            callKind: q.call_kind,
            rulesVersion: rules.data.version,
            model: savedModel,
            source: "scheduled_call_review",
            audioAssessed: false,
            reusedEquivalentEvidence: !!cached.data,
          },
        });
        if (stored.error) throw Error("review_save_failed");
        totals.reviewed++;
      } catch (error) {
        const code = safeAutoReviewError(error);
        const permanent =
          ["call_workspace_mismatch", "evidence_too_large", "approved_rules_required", "feedback_snapshot_invalid"].includes(
            code,
          ) ||
          q.attempts + Number(aiStarted) >= 3 ||
          (code === "awaiting_transcript" &&
            Date.now() - Date.parse(q.call_created_at) > 3 * 86400000);
        await finish({
          state: permanent
            ? "needs_review"
            : code === "awaiting_transcript"
              ? "awaiting_evidence"
              : "pending",
          safe_error: code,
          next_attempt_at: new Date(
            Date.now() + (code === "daily_review_safeguard" ? 3600000 : 600000),
          ).toISOString(),
        }).catch(() => undefined);
        if (
          ["awaiting_transcript", "daily_review_safeguard", "review_evidence_in_progress"].includes(
            code,
          )
        )
          totals.waiting++;
        else totals.failed++;
      }
    }

    // No healthy-call noise. Alert only actionable findings; uncertain deliveries
    // are not blindly resent. The private care task remains the source of truth.
    const alerts = await db
      .from("receptionist_auto_review_queue")
      .select("id,tenant_id,call_id,call_kind,evidence_hash,reviewer_version")
      .eq("slack_state", "pending")
      .eq("state", "reviewed")
      .order("updated_at")
      .limit(5);
    if (alerts.error) throw Error("Could not load pending alerts");
    for (const q of alerts.data ?? []) {
      const claim = await db
        .from("receptionist_auto_review_queue")
        .update({ slack_state: "sending" })
        .eq("id", q.id)
        .eq("slack_state", "pending")
        .select("id");
      if (!claim.data?.length) continue;
      try {
        const review = await db
          .from("receptionist_call_reviews")
          .select("assessment")
          .eq("tenant_id", q.tenant_id)
          .eq("call_id", q.call_id)
          .eq("evidence_hash", q.evidence_hash)
          .eq("reviewer_version", q.reviewer_version)
          .single();
        if (review.error || !Array.isArray(review.data?.assessment?.findings))
          throw Error("Review receipt missing");
        const alertCategories = review.data.assessment.alertCategories;
        const findings = Array.isArray(alertCategories)
          ? review.data.assessment.findings.filter((f: { category: string }) =>
              alertCategories.includes(f.category),
            )
          : review.data.assessment.findings;
        if (!findings.length) {
          await db
            .from("receptionist_auto_review_queue")
            .update({ slack_state: "not_required" })
            .eq("id", q.id);
          continue;
        }
        const event = findings.some((f: { severity: string }) => f.severity === "urgent")
          ? "urgent_feedback"
          : q.call_kind === "practice"
            ? "practice_feedback"
            : "receptionist_feedback";
        const route = await db
          .from("operator_notification_routes")
          .select("channel_id")
          .eq("tenant_id", q.tenant_id)
          .eq("event_key", event)
          .single();
        const token = await db.rpc("notification_slack_token");
        if (route.error || token.error || !token.data)
          throw Error("Notification route unavailable");
        const channel = await verifySlackChannel(token.data, route.data.channel_id);
        const receipt = await sendSlackMessage(
          token.data,
          channel.id,
          `OpenFolk · Emma ${q.call_kind === "practice" ? "practice" : "live-call"} review needs attention\n${findings.length} evidence-linked finding(s): ${[...new Set(findings.map((f: { category: string }) => f.category))].join(", ")}.\nEmma has not been changed. Review the evidence and proposed improvement in OpenFolk.\nhttps://app.openfolk.ai/openfolk/${q.tenant_id}?module=receptionist&view=improvements&tools=false`,
          q.id,
        );
        await db
          .from("receptionist_auto_review_queue")
          .update({ slack_state: "sent", slack_receipt: receipt })
          .eq("id", q.id);
        totals.alertsSent++;
      } catch {
        await db
          .from("receptionist_auto_review_queue")
          .update({ slack_state: "needs_review" })
          .eq("id", q.id);
      }
    }
    return reply(totals);
  } catch {
    return reply({ error: "Automatic review collection needs attention", ...totals }, 503);
  }
});
