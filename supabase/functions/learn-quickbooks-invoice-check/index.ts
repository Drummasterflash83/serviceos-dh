import { quickBooksEdgePorts } from "../_shared/quickbooks/edge_ports.ts";
import { runInvoiceCheck, validateInvoiceCheckRequest } from "../_shared/quickbooks/invoice_check.ts";
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const reply = (body: unknown, status: number, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
Deno.serve(async (req: Request) => {
  let ports: ReturnType<typeof quickBooksEdgePorts>;
  try { ports = quickBooksEdgePorts(); } catch { return reply({ error: "configuration_unavailable" }, 503); }
  let site: string;
  try { const url = new URL(ports.siteOrigin); if (url.protocol !== "https:" || url.origin !== ports.siteOrigin) throw Error(); site = url.origin; }
  catch { return reply({ error: "configuration_unavailable" }, 503); }
  const cors = { "Access-Control-Allow-Origin": site, "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
  if (req.headers.has("origin") && req.headers.get("origin") !== site) return reply({ error: "origin_denied" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, ...cors } });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405, cors);
  const auth = req.headers.get("authorization");
  if (!auth || !/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(auth)) return reply({ error: "sign_in_required" }, 401, cors);
  const rpc = await ports.userRpc(auth.slice(7));
  if (!rpc) return reply({ error: "sign_in_required" }, 401, cors);
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return reply({ error: "request_invalid" }, 400, cors);
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 4096) throw Error();
    body = JSON.parse(raw);
  } catch { return reply({ error: "request_invalid" }, 400, cors); }
  if (!validateInvoiceCheckRequest(body)) return reply({ error: "request_invalid" }, 400, cors);
  try { return reply(await runInvoiceCheck(body, { userRpc: rpc, serviceRpc: ports.serviceRpc, fetcher: ports.fetcher, signal: req.signal }), 200, cors); }
  catch { return reply({ error: "invoice_check_unconfirmed" }, 409, cors); }
});
