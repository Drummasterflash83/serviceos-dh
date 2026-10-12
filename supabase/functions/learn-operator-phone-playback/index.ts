import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getBearerToken } from "../_shared/authz.ts";
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
    // Real signed-in operator only. SQL checks the existing admin grant twice and audits the actual actor.
    if (
      req.headers.has("x-serviceos-internal-key") ||
      req.headers.has("x-internal-tenant-id") ||
      req.headers.has("x-openfolk-machine-key") ||
      req.headers.has("x-openfolk-actor")
    )
      return reply(401, { error: "Sign in required" });
    const backend = Deno.env.get("SUPABASE_URL")!,
      key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(backend, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const bearer = getBearerToken(req);
    if (!bearer) return reply(401, { error: "Sign in required" });
    const { data: identity, error: identityError } = await db.auth.getUser(bearer);
    if (identityError || !identity?.user?.id)
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
      Object.keys(body).some((k) => !["tenant_id", "recording_id", "reason"].includes(k)) ||
      typeof body.tenant_id !== "string" ||
      typeof body.reason !== "string" ||
      body.reason.trim().length < 3 ||
      body.reason.trim().length > 500
    )
      return reply(403, { error: "Recording unavailable with your current access" });
    const userDb = createClient(backend, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const playback = {
      rpc: async (name: string, args: Record<string, unknown>) => await userDb.rpc(name, args),
      storage: db.storage,
    };
    return reply(
      200,
      await retainedPhonePlayback(playback, {
        tenant: body.tenant_id,
        actor: identity.user.id,
        operatorReason: body.reason,
        recording: body.recording_id,
        backend,
      }),
    );
  } catch {
    return reply(503, { error: "Recording unavailable. Try again or contact your administrator." });
  }
});
