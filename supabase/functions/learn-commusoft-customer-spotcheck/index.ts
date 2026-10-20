import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { runCustomerSpotcheck, validateSpotcheckRequest } from "../_shared/commusoft/exact_customer_spotcheck.ts";

const fixed = { "Content-Type": "application/json", "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const origins = new Set(["https://app.openfolk.ai", "https://www.openfolk.ai", "https://test.openfolk.ai"]);
function reply(data: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...fixed, ...headers } });
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin !== null && !origins.has(origin)) return reply({ error: "origin_denied" }, 403);
  const cors: Record<string, string> = origin ? { "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" } : {};
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...fixed, ...cors } });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405, cors);
  const auth = req.headers.get("authorization");
  if (!auth || !/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(auth)) return reply({ error: "sign_in_required" }, 401, cors);
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    return reply({ error: "request_invalid" }, 400, cors);
  let body: unknown;
  try {
    if (!req.body || Number(req.headers.get("content-length") ?? "0") > 4096) throw Error();
    const reader = req.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength; if (size > 4096) throw Error(); parts.push(part.value); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return reply({ error: "request_invalid" }, 400, cors); }
  if (!validateSpotcheckRequest(body)) return reply({ error: "request_invalid" }, 400, cors);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"),
    service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply({ error: "configuration_unavailable" }, 503, cors);
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const user = createClient(url, anon, { ...options, global: { headers: { Authorization: auth } } });
  const checked = await user.auth.getUser(auth.slice(7));
  if (checked.error || !checked.data.user) return reply({ error: "sign_in_required" }, 401, cors);
  const server = createClient(url, service, options);
  try {
    return reply(await runCustomerSpotcheck(body, {
      userRpc: (name, args) => user.rpc(name, args),
      serviceRpc: (name, args) => server.rpc(name, args),
      signal: req.signal,
    }), 200, cors);
  } catch { return reply({ error: "customer_spotcheck_unconfirmed" }, 409, cors); }
});
