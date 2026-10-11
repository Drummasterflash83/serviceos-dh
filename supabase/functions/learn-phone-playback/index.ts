import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser, assertSameTenant } from "../_shared/authz.ts";
import { retainedPhonePlayback } from "../_shared/learn-phone-playback.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers });
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply(405, { error: "Use POST" });
  try {
    // Playback is for a real signed-in company reviewer, never internal impersonation.
    if (req.headers.has("x-serviceos-internal-key") || req.headers.has("x-internal-tenant-id"))
      return reply(401, { error: "Sign in required" });
    const backend = Deno.env.get("SUPABASE_URL")!,
      key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(backend, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const auth = await requireTenantUser(req, db, ["owner", "admin"]);
    if (!auth.ok || auth.ctx.userId === "service")
      return reply(401, { error: "Recording unavailable with your current access" });
    if (Number(req.headers.get("content-length") ?? 0) > 2048)
      return reply(400, { error: "Invalid recording request" });
    const reader = req.body?.getReader();
    if (!reader) return reply(400, { error: "Invalid recording request" });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 2048) return reply(400, { error: "Invalid recording request" });
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const body = JSON.parse(raw);
    if (
      !body ||
      Object.keys(body).some((k) => !["tenant_id", "recording_id"].includes(k)) ||
      typeof body.tenant_id !== "string" ||
      assertSameTenant(auth.ctx, body.tenant_id)
    )
      return reply(403, { error: "Recording unavailable with your current access" });
    return reply(
      200,
      await retainedPhonePlayback(db, {
        tenant: auth.ctx.tenantId,
        actor: auth.ctx.userId,
        recording: body.recording_id,
        backend,
      }),
    );
  } catch {
    return reply(503, { error: "Recording unavailable. Try again or contact your administrator." });
  }
});
