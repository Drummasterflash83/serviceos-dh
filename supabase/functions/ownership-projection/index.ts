// ServiceOS — Edge Function: ownership-projection (TENANT-facing, derived only).
//
// The customer Command Centre calls this to learn "who owns/handles this endpoint" WITHOUT
// ever reading raw Control Plane tables (which are OpenFolk-only under RLS). It authorises
// the tenant user (requireTenantUser), resolves ownership with the service role for THAT
// user's own tenant, and returns ONLY the minimal derived projection — no provider
// metadata, identity records, audit, grants or unrelated endpoint internals.
//
// Deploy with verify_jwt=false (auth enforced via requireTenantUser).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import { deriveOwnershipForEvidence } from "../_shared/controlplane/projection.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "content-type": "application/json" },
  });
const fail = (code: string, message: string, s: number) =>
  json({ ok: false, error: { code, message } }, s);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = url && key ? createClient(url, key) : null;
  if (!admin) return fail("config_error", "Supabase admin client is not configured", 500);

  // Tenant-gated: the caller may project ONLY their own tenant (from the verified JWT).
  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops", "viewer"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const tenantId = auth.ctx.tenantId;

  let body: Row = {};
  try {
    body = ((await req.json()) ?? {}) as Row;
  } catch {
    body = {};
  }
  if (String(body.action ?? "resolve") !== "resolve")
    return fail("bad_request", "unknown action", 400);
  const now = typeof body.now_ms === "number" ? body.now_ms : Date.now();

  try {
    const derived = await deriveOwnershipForEvidence(admin, tenantId, body.evidence ?? {}, now, {
      subjectRef: body.subject_ref ?? null,
    });
    return json({ ok: true, data: derived });
  } catch (e) {
    return fail("projection_error", (e as Error).message, 500);
  }
});
