// Operator-triggered independent review. No Vapi mutation path exists here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { normalizeCall, record } from "../_shared/receptionist-data.ts";
import { practiceCallMatches } from "../_shared/receptionist-web-call.ts";
import { verifyCareChannel, postCareAlert } from "../_shared/care-slack.ts";
import { evidenceHash } from "../_shared/receptionist-care.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { headers, status });
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const token = req.headers.get("authorization");
    if (!token) return reply({ error: "Sign in to continue" }, 401);
    const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: token } },
      auth: { persistSession: false },
    });
    const user = await userDb.auth.getUser();
    if (user.error || !user.data.user) return reply({ error: "Sign in to continue" }, 401);
    const permission = await userDb.rpc("current_user_is_openfolk_operator", {
      required_permission: "platform.controlplane.admin",
    });
    if (permission.error || permission.data !== true)
      return reply({ error: "OpenFolk administrator required" }, 403);
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const preview = await admin
      .from("view_as_context")
      .select("expires_at")
      .eq("actor_user_id", user.data.user.id)
      .is("ended_at", null);
    if (
      preview.error ||
      preview.data.some((v) => !v.expires_at || Date.parse(v.expires_at) > Date.now())
    )
      return reply({ error: "Leave client preview before reviewing" }, 403);
    const body = record(await req.json());
    if (!uuid(body.tenantId)) return reply({ error: "Valid workspace required" }, 400);
    if (body.action === "activate_notifications") {
      const secret = Deno.env.get("RECEPTIONIST_CARE_WORKER_SECRET");
      if (!secret) return reply({ error: "The care worker awaits setup" }, 503);
      const probe = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/receptionist-care-worker`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: { "Content-Type": "application/json", "x-care-secret": secret },
          body: JSON.stringify({ action: "readiness" }),
        },
      );
      if (!probe.ok)
        return reply({ error: "The deployed worker has not passed its setup check" }, 503);
      const readiness = await probe.json();
      if (!uuid(readiness.receipt) || readiness.version !== "care-worker-v1")
        return reply({ error: "Worker readiness receipt unavailable" }, 503);
      const activation = await userDb.rpc("care_enable_notifications", {
        p_tenant: body.tenantId,
        p_worker_receipt: readiness.receipt,
      });
      if (activation.error)
        return reply(
          {
            code:
              activation.error.message === "legacy_delivery_uncertain"
                ? "legacy_delivery_uncertain"
                : "notification_setup_incomplete",
            error:
              activation.error.message === "legacy_delivery_uncertain"
                ? "An earlier report may already have reached Slack. Check its delivery before switching routes; retrying must not send it twice."
                : "Not activated. Verify all three routes and allow any in-flight report to finish, then retry.",
          },
          409,
        );
      return reply({ activated: true, providerChanges: 0 });
    }
    if (body.action === "verify_alert_route") {
      if (!["updates", "attention", "urgent"].includes(String(body.kind)))
        return reply({ error: "Invalid alert route" }, 400);
      const route = await admin
        .from("module_alert_routes")
        .select("team_id,channel_id,updated_at")
        .eq("tenant_id", body.tenantId)
        .eq("module", "receptionist")
        .eq("kind", body.kind)
        .single();
      if (route.error) return reply({ error: "Save a destination first" }, 409);
      const slackToken = Deno.env.get("OPENFOLK_SLACK_BOT_TOKEN"),
        team = Deno.env.get("OPENFOLK_SLACK_TEAM_ID");
      if (!slackToken || !team)
        return reply({ error: "OpenFolk Slack app connection awaits setup" }, 503);
      const verified = await verifyCareChannel(
        slackToken,
        team,
        route.data.team_id,
        route.data.channel_id,
      );
      // A harmless routing test is required before enabling any customer report delivery.
      const receipt = await postCareAlert({
        token: slackToken,
        channel: verified.channel_id,
        reference: crypto.randomUUID(),
        text: `OpenFolk care: ${body.kind} route verification. No customer call content is included.`,
      });
      const saved = await admin
        .from("module_alert_routes")
        .update({
          enabled: true,
          verified_at: new Date().toISOString(),
          verified_channel_name: verified.name,
          verification_receipt: receipt,
        })
        .eq("tenant_id", body.tenantId)
        .eq("module", "receptionist")
        .eq("kind", body.kind)
        .eq("updated_at", route.data.updated_at)
        .select("channel_id");
      if (saved.error || saved.data.length !== 1)
        return reply({ error: "Route changed during verification. Review and retry." }, 409);
      return reply({ verified: true, channel: verified.name, receipt });
    }
    if (body.action && body.action !== "review") return reply({ error: "Unsupported action" }, 400);
    if (!uuid(body.callId)) return reply({ error: "Valid workspace and call required" }, 400);
    const settings = await admin
      .from("receptionist_review_settings")
      .select("approved_rules,version,enabled")
      .eq("tenant_id", body.tenantId)
      .maybeSingle();
    if (settings.error || !settings.data?.enabled)
      return reply({ error: "Approve review rules and enable review first" }, 409);
    const workspace = await admin
      .from("receptionist_workspaces")
      .select("assistant_id,vapi_secret_name")
      .eq("tenant_id", body.tenantId)
      .single();
    if (workspace.error) return reply({ error: "Workspace unavailable" }, 404);
    const providerKey = Deno.env.get(workspace.data.vapi_secret_name);
    if (!providerKey) return reply({ error: "Review connection awaits setup" }, 503);
    const provider = await fetch(`https://api.vapi.ai/call/${body.callId}`, {
      headers: { Authorization: `Bearer ${providerKey}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!provider.ok) return reply({ error: "Call evidence unavailable" }, 502);
    const raw = record(await provider.json());
    if (raw.id !== body.callId) return reply({ error: "Call reference mismatch" }, 409);
    if (raw.assistantId !== workspace.data.assistant_id) {
      const session = await admin
        .from("receptionist_practice_sessions")
        .select("id")
        .eq("tenant_id", body.tenantId)
        .eq("call_id", body.callId)
        .maybeSingle();
      if (
        session.error ||
        !session.data ||
        !practiceCallMatches(raw, session.data.id, body.tenantId)
      )
        return reply({ error: "Call unavailable in this workspace" }, 403);
    }
    const call = normalizeCall(raw);
    if (call.status !== "ended" || !call.transcript)
      return reply({ error: "Awaiting completed call evidence" }, 409);
    // Manual requests join the same leased, budgeted lane as background review.
    // A second browser click cannot bypass quotas or race a second paid model request.
    const hash = await evidenceHash({
      transcript: call.transcript,
      updatedAt: raw.updatedAt,
      rulesVersion: settings.data.version,
    });
    const saved = await admin.rpc("care_enqueue_review", {
      p_tenant: body.tenantId,
      p_call: body.callId,
      p_observation_key: `manual:${hash}`,
      p_observed_at: new Date().toISOString(),
      p_source: "manual",
    });
    if (saved.error) throw Error("review_save_failed");
    return reply({ queued: true, replayed: saved.data === false });
  } catch {
    // Provider text, credentials and call content must never become error diagnostics.
    return reply({ error: "Review did not complete. No changes were made to Emma." }, 502);
  }
});
