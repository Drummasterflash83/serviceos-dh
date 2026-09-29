// Approved, transient text comparison only. No PATCH, phone call or tool path.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { record } from "../_shared/receptionist-data.ts";
import { evidenceHash } from "../_shared/receptionist-care.ts";
import {
  rehearsalAssistant,
  rehearsalOutput,
  REHEARSAL_VERSION,
  REHEARSAL_LIMITS,
} from "../_shared/receptionist-rehearsal.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { headers, status });
const uuid = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s);
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  let reservation: string | null = null;
  try {
    const authorization = req.headers.get("authorization");
    if (!authorization) return reply({ error: "Sign in to OpenFolk." }, 401);
    const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const auth = await userDb.auth.getUser(),
      allowed = await userDb.rpc("care_desk_operator");
    if (auth.error || !auth.data.user) return reply({ error: "Sign in to OpenFolk." }, 401);
    if (
      allowed.error ||
      allowed.data !== true ||
      auth.data.user.email?.toLowerCase() !== "chris@openfolk.ai"
    )
      return reply({ error: "OpenFolk administrator required. Leave client preview first." }, 403);
    const raw = await req.text();
    if (raw.length > 4000) return reply({ error: "Request too large." }, 400);
    const body = JSON.parse(raw);
    if (
      !uuid(body.tenantId) ||
      !uuid(body.issueId) ||
      !Number.isInteger(body.version) ||
      typeof body.caller !== "string" ||
      !body.caller.trim() ||
      body.caller.length > 2000
    )
      return reply({ error: "Choose the approved task and enter a caller sentence." }, 400);
    const issue = await db
      .from("receptionist_care_issues")
      .select("stage,version,proposal,approved_at")
      .eq("tenant_id", body.tenantId)
      .eq("id", body.issueId)
      .single();
    if (
      issue.error ||
      issue.data.stage !== "approved" ||
      issue.data.version !== body.version ||
      !issue.data.approved_at
    )
      return reply(
        { error: "Reload the task. A current approval for this exact proposal is required." },
        409,
      );
    const workspace = await db
      .from("receptionist_workspaces")
      .select("assistant_id,vapi_secret_name")
      .eq("tenant_id", body.tenantId)
      .single();
    if (workspace.error) return reply({ error: "Workspace unavailable." }, 404);
    const key = Deno.env.get(workspace.data.vapi_secret_name);
    if (!key) return reply({ error: "The Vapi connection needs attention." }, 503);
    const getAssistant = async () => {
      const r = await fetch("https://api.vapi.ai/assistant/" + workspace.data.assistant_id, {
        headers: { Authorization: "Bearer " + key },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw Error("assistant_unavailable");
      const s = record(await r.json());
      if (s.id !== workspace.data.assistant_id || typeof s.updatedAt !== "string")
        throw Error("assistant_mismatch");
      return s;
    };
    const source = await getAssistant();
    const baseline = rehearsalAssistant(source, ""),
      candidate = rehearsalAssistant(source, issue.data.proposal);
    const opening = typeof source.firstMessage === "string" ? source.firstMessage : "";
    const sourceHash = await evidenceHash(source),
      candidateHash = await evidenceHash(candidate);
    const reserved = await db.rpc("care_reserve_rehearsal", {
      p_tenant: body.tenantId,
      p_issue: body.issueId,
      p_actor: auth.data.user.id,
      p_version: body.version,
      p_assistant_version: source.updatedAt,
      p_assistant_hash: sourceHash,
      p_candidate_hash: candidateHash,
      p_opening: opening,
      p_caller: body.caller.trim(),
    });
    if (reserved.error || !uuid(reserved.data))
      return reply(
        {
          error:
            "The approval changed, another rehearsal is running, or the usage safeguard was reached. Reload before retrying.",
        },
        409,
      );
    reservation = reserved.data;
    const input = [
      ...(opening ? [{ role: "assistant", content: opening }] : []),
      { role: "user", content: body.caller.trim() },
    ];
    const run = async (assistant: unknown) => {
      const r = await fetch("https://api.vapi.ai/chat", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ assistant, input, stream: false }),
      });
      if (!r.ok) throw Error(`vapi_rehearsal_http_${r.status}`);
      return rehearsalOutput(await r.json());
    };
    const [before, after] = await Promise.allSettled([run(baseline), run(candidate)]);
    const current = await getAssistant();
    if ((await evidenceHash(current)) !== sourceHash) throw Error("assistant_changed");
    if (before.status !== "fulfilled") throw before.reason;
    if (after.status !== "fulfilled") throw after.reason;
    const result = {
      version: REHEARSAL_VERSION,
      baseline: before.value,
      candidate: after.value,
      limits: REHEARSAL_LIMITS,
      verdict: "human_review_required",
      liveChanges: 0,
    };
    const saved = await db.rpc("care_finish_rehearsal", { p_id: reservation, p_result: result });
    if (saved.error) throw Error("rehearsal_save_failed");
    return reply({ id: reservation, completed: true, liveChanges: 0 });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    const message = /^vapi_rehearsal_http_\d{3}$/.test(code)
      ? `Vapi could not run this isolated text rehearsal (HTTP ${code.slice(-3)}). The approved proposal is saved and Emma's live setup is unchanged.`
      : code === "assistant_changed"
        ? "Emma's configuration changed during the comparison. Do not use this result for release; review the new version first."
        : code === "unsupported_rehearsal_model"
          ? "This model needs a dedicated rehearsal adapter. Emma's live setup is unchanged."
          : "The isolated rehearsal could not complete. No live change was made. Check Vapi availability before retrying.";
    if (reservation)
      await db.rpc("care_finish_rehearsal", {
        p_id: reservation,
        p_result: null,
        p_error: message,
      });
    return reply({ error: message }, 502);
  }
});
