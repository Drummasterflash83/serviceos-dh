// Read-only evidence review. This endpoint has no Vapi write path.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { normalizeCall, record } from "../_shared/receptionist-data.ts";
import { practiceCallMatches } from "../_shared/receptionist-web-call.ts";
import { reviewConversation, evidenceHash } from "../_shared/receptionist-care.ts";
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
const safeError = (e: unknown) => {
  const code = e instanceof Error ? e.message : "";
  if (code === "review_credit_required")
    return "OpenAI review credit is exhausted. Add credit in the organisation billing settings. Emma is unchanged.";
  if (code === "review_rate_limited")
    return "The review service is busy. Try again shortly. Emma is unchanged.";
  if (code === "evidence_too_large")
    return "This call needs manual review because its evidence exceeds the review size limit.";
  if (code === "assessment_evidence_invalid")
    return "The AI review included a quotation that did not exactly match the call. It was rejected. Retry the review; Emma is unchanged.";
  if (code === "assessment_invalid")
    return "The AI review did not meet the required evidence format. Retry the review; Emma is unchanged.";
  if (code === "review_incomplete")
    return "The AI review ended before returning a complete assessment. Retry the review; Emma is unchanged.";
  if (code === "review_provider_unavailable")
    return "OpenAI could not accept the review request. Check the dedicated project's model access and billing. Emma is unchanged.";
  if (code === "review_save_failed")
    return "The assessment could not be saved. Retry the review; Emma is unchanged.";
  return "The review could not complete. Check the call evidence and try again. No changes were made to Emma.";
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  let reservation: string | null = null;
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  try {
    const authorization = req.headers.get("authorization");
    if (!authorization) return reply({ error: "Sign in to OpenFolk." }, 401);
    const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const auth = await userDb.auth.getUser();
    if (auth.error || !auth.data.user) return reply({ error: "Sign in to OpenFolk." }, 401);
    const allowed = await userDb.rpc("care_desk_operator");
    if (
      allowed.error ||
      allowed.data !== true ||
      auth.data.user.email?.toLowerCase() !== "chris@openfolk.ai"
    )
      return reply({ error: "OpenFolk administrator required. Leave client preview first." }, 403);
    const raw = await req.text();
    if (raw.length > 2000) return reply({ error: "Request too large." }, 400);
    const body = JSON.parse(raw);
    if (!uuid(body.tenantId) || !uuid(body.issueId))
      return reply({ error: "Choose a client and task." }, 400);
    const issue = await db
      .from("receptionist_care_issues")
      .select("feedback_id,detail,stage")
      .eq("tenant_id", body.tenantId)
      .eq("id", body.issueId)
      .maybeSingle();
    if (issue.error || !issue.data?.feedback_id)
      return reply({ error: "This task has no linked feedback to review." }, 404);
    if (issue.data.stage === "resolved")
      return reply({ error: "Reopen this task before requesting another review." }, 409);
    const note = await db
      .from("receptionist_feedback")
      .select("call_id,practice_session_id,title,body,version")
      .eq("tenant_id", body.tenantId)
      .eq("id", issue.data.feedback_id)
      .single();
    const workspace = await db
      .from("receptionist_workspaces")
      .select("assistant_id,vapi_secret_name")
      .eq("tenant_id", body.tenantId)
      .single();
    if (note.error || workspace.error)
      return reply({ error: "The original feedback is unavailable." }, 404);
    let callId = note.data.call_id,
      sessionId = note.data.practice_session_id;
    if (sessionId) {
      const session = await db
        .from("receptionist_practice_sessions")
        .select("call_id")
        .eq("tenant_id", body.tenantId)
        .eq("id", sessionId)
        .single();
      if (session.error || !session.data.call_id || (callId && callId !== session.data.call_id))
        return reply({ error: "Practice evidence does not match this task." }, 409);
      callId = session.data.call_id;
    }
    if (!uuid(callId))
      return reply(
        {
          error: "This observation is not linked to a completed call. Review its details manually.",
        },
        409,
      );
    const key = Deno.env.get("OPENAI_EMMA_REVIEW_KEY"),
      providerKey = Deno.env.get(workspace.data.vapi_secret_name);
    if (!key || !providerKey)
      return reply({ error: "The review connection awaits setup. Feedback remains saved." }, 503);
    const reserved = await db.rpc("care_desk_reserve_review", {
      p_tenant: body.tenantId,
      p_issue: body.issueId,
      p_actor: auth.data.user.id,
    });
    if (reserved.error || !uuid(reserved.data))
      return reply(
        {
          error:
            "A review is already running, was requested recently, or the daily safeguard has been reached. Try later.",
        },
        409,
      );
    reservation = reserved.data;
    const get = async (path: string) => {
      const r = await fetch("https://api.vapi.ai/" + path, {
        headers: { Authorization: "Bearer " + providerKey },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw Error("provider_unavailable");
      return record(await r.json());
    };
    const [rawCall, assistant] = await Promise.all([
      get("call/" + callId),
      get("assistant/" + workspace.data.assistant_id),
    ]);
    if (rawCall.id !== callId || assistant.id !== workspace.data.assistant_id)
      throw Error("evidence_mismatch");
    if (
      sessionId
        ? !practiceCallMatches(rawCall, sessionId, body.tenantId)
        : rawCall.assistantId !== workspace.data.assistant_id
    )
      throw Error("call_workspace_mismatch");
    const call = normalizeCall(rawCall);
    if (call.status !== "ended" || !call.transcript) throw Error("awaiting_transcript");
    const modelConfig = record(assistant.model);
    const instructions = (Array.isArray(modelConfig.messages) ? modelConfig.messages : [])
      .map(record)
      .filter((m) => m.role === "system" && typeof m.content === "string")
      .map((m) => m.content)
      .join("\n");
    if (!instructions.trim()) throw Error("approved_rules_required");
    const rules =
      "Current configured assistant instructions (historical call-time instructions may differ):\n" +
      instructions +
      "\nConfigured opening message:\n" +
      String(assistant.firstMessage ?? "");
    const hash = await evidenceHash({
      transcript: call.transcript,
      feedback: note.data.body,
      assistantVersion: assistant.updatedAt,
      rules,
    });
    const model = Deno.env.get("OPENAI_EMMA_REVIEW_MODEL") || "gpt-4.1-mini";
    const assessment = await reviewConversation({
      key,
      model,
      transcript: call.transcript,
      approvedRules: rules,
      feedback: [note.data.body],
      callType: sessionId
        ? "Browser practice; transfers are simulated, not real telephone handovers"
        : String(call.type),
    });
    const saved = await db
      .from("receptionist_task_reviews")
      .update({
        state: "completed",
        assessment,
        evidence_hash: hash,
        assistant_version: assistant.updatedAt ?? null,
        call_id: callId,
        model,
        finished_at: new Date().toISOString(),
      })
      .eq("id", reservation)
      .eq("state", "running")
      .select("id");
    if (saved.error || saved.data?.length !== 1) throw Error("review_save_failed");
    return reply({ reviewId: reservation, completed: true, providerChanges: 0 });
  } catch (e) {
    const message = safeError(e);
    if (reservation)
      await db
        .from("receptionist_task_reviews")
        .update({ state: "failed", safe_error: message, finished_at: new Date().toISOString() })
        .eq("id", reservation)
        .eq("state", "running");
    return reply({ error: message }, 502);
  }
});
