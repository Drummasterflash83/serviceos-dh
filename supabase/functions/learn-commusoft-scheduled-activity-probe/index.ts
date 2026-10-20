import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  scheduledActivityProbeOrigin,
  runScheduledActivityProbe,
  validScheduledActivityProbeRequest,
} from "../_shared/commusoft/scheduled_activity_probe.ts";

const baseHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const reply = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...baseHeaders, ...extra } });
const boundedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(15000) });

Deno.serve(async (req: Request) => {
  const url = Deno.env.get("SUPABASE_URL"),
    anon = Deno.env.get("SUPABASE_ANON_KEY"),
    service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply({ error: "configuration_unavailable" }, 503);
  const allowed = scheduledActivityProbeOrigin(url, req.headers.get("origin"));
  if (!allowed) return reply({ error: "origin_denied" }, 403);
  const cors = {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: { ...baseHeaders, ...cors } });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405, cors);
  const authorization = req.headers.get("authorization");
  if (!authorization || !/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(authorization))
    return reply({ error: "sign_in_required" }, 401, cors);
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: boundedFetch },
  };
  const user = createClient(url, anon, {
    ...options,
    global: { ...options.global, headers: { Authorization: authorization } },
  });
  const identity = await user.auth.getUser(authorization.slice(7));
  if (identity.error || !identity.data.user?.id)
    return reply({ error: "sign_in_required" }, 401, cors);
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
    return reply({ error: "request_invalid" }, 400, cors);
  let body: unknown;
  try {
    if (!req.body || Number(req.headers.get("content-length") ?? "0") > 4096) throw Error();
    const reader = req.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 4096) throw Error();
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return reply({ error: "request_invalid" }, 400, cors);
  }
  if (!validScheduledActivityProbeRequest(body))
    return reply({ error: "request_invalid" }, 400, cors);
  const admin = createClient(url, service, options);
  try {
    const result = await runScheduledActivityProbe(body, {
      userRpc: (name, args) => user.rpc(name, args),
      serviceRpc: (name, args) => admin.rpc(name, args),
      signal: req.signal,
    });
    return reply(result, 200, cors);
  } catch {
    return reply({ error: "scheduled_activity_probe_unconfirmed" }, 409, cors);
  }
});
