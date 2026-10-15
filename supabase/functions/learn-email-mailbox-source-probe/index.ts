/** Internal, read-only Google proof for one held Workspace mailbox.
 * The existing platform credential stays inside Edge; no token, address,
 * history ID or message content is returned. Every provider attempt is audited.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createEmailCapturePorts } from "../_shared/email_capture_ports.ts";
import { GmailCaptureError, readGmailCaptureBoundary } from "../_shared/gmail_capture_page.ts";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers });
function equal(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function bodyOf(req: Request): Promise<{ account_id: string } | null> {
  if (Number(req.headers.get("content-length") ?? 0) > 512) return null;
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 512) return null;
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === 1 && uuid(value.account_id) ? value : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return reply(405, { ok: false, code: "method_not_allowed" });
  const authorization = req.headers.get("authorization") ?? "";
  const callerKey = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const tenantId = req.headers.get("x-internal-tenant-id");
  if (!callerKey || !equal(req.headers.get("x-serviceos-internal-key") ?? "", callerKey) ||
    !uuid(tenantId)) return reply(403, { ok: false, code: "forbidden" });
  const body = await bodyOf(req);
  if (!body) return reply(400, { ok: false, code: "invalid_request" });
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return reply(503, { ok: false, code: "source_unavailable" });
  // A rotated public API key may differ from the Edge runtime's saved key.
  // Auth Admin independently verifies this caller has this project's service
  // role; neither its one-row response nor the credential is logged or returned.
  let authorized = false;
  try {
    const auth = await fetch(`${url}/auth/v1/admin/users?per_page=1&page=1`, {
      headers: { apikey: callerKey, Authorization: authorization },
      redirect: "error", signal: AbortSignal.timeout(10000),
    });
    authorized = auth.status === 200;
    await auth.body?.cancel();
  } catch { /* Fail closed when Auth cannot verify the caller. */ }
  if (!authorized) return reply(403, { ok: false, code: "forbidden" });
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const accountId = body.account_id;
  const { data: held, error: heldError } = await db.from("email_ingestion_checkpoints")
    .select("generation,revision,state,block_code")
    .eq("tenant_id", tenantId).eq("email_account_id", accountId)
    .eq("stream", "recent").maybeSingle();
  if (heldError) return reply(503, { ok: false, code: "source_unavailable" });
  if (!held || held.state !== "blocked" || held.block_code !== "admin_delegation_missing")
    return reply(409, { ok: false, code: "hold_changed" });
  const { data: recent, error: recentError } = await db.from("audit_logs")
    .select("id").eq("tenant_id", tenantId)
    .eq("resource_type", "email_account").eq("resource_id", accountId)
    .eq("action", "learn.email.mailbox_source_probe")
    .gte("created_at", new Date(Date.now() - 15 * 60000).toISOString())
    .limit(1);
  if (recentError) return reply(503, { ok: false, code: "audit_unavailable" });
  if ((recent ?? []).length) return reply(429, { ok: false, code: "probe_cooldown" });
  const { data: requestAudit, error: auditError } = await db.from("audit_logs")
    .insert({ tenant_id: tenantId, actor: "system:learn-email-mailbox-source-probe",
      action: "learn.email.mailbox_source_probe", resource_type: "email_account",
      resource_id: accountId, status: "requested",
      detail: { checkpoint_generation: held.generation, checkpoint_revision: held.revision,
        provider_scope: "gmail.readonly", mailbox_content_read: false } })
    .select("id").single();
  if (auditError || !uuid(requestAudit?.id))
    return reply(503, { ok: false, code: "audit_unavailable" });
  let code = "provider_verified";
  try {
    const scope = { tenantId, accountId, syncType: "workspace_messages" as const };
    const ports = createEmailCapturePorts(db);
    const source = await ports.mailbox(scope);
    const token = await ports.accessToken(scope, source);
    await readGmailCaptureBoundary(token, source.profileMailbox ?? source.mailbox);
    const { data: current, error } = await db.from("email_ingestion_checkpoints")
      .select("generation,revision,state,block_code")
      .eq("tenant_id", tenantId).eq("email_account_id", accountId)
      .eq("stream", "recent").maybeSingle();
    if (error || !current || current.generation !== held.generation ||
      current.revision !== held.revision || current.state !== held.state ||
      current.block_code !== held.block_code) code = "hold_changed";
  } catch (error) {
    code = error instanceof GmailCaptureError ? error.code : "provider_unconfirmed";
  }
  const { error: resultAuditError } = await db.from("audit_logs").insert({
    tenant_id: tenantId, actor: "system:learn-email-mailbox-source-probe",
    action: "learn.email.mailbox_source_probe_result", resource_type: "email_account",
    resource_id: accountId, status: code === "provider_verified" ? "success" : "failed",
    detail: { request_audit_id: requestAudit.id,
      checkpoint_generation: held.generation, checkpoint_revision: held.revision,
      code, mailbox_content_read: false },
  });
  if (resultAuditError) return reply(503, { ok: false, code: "audit_unavailable" });
  return reply(code === "provider_verified" ? 200 : 409, {
    ok: code === "provider_verified", version: "learn-email-mailbox-source-probe/1",
    code, checkpoint_revision: held.revision, checked_at: new Date().toISOString(),
  });
});
