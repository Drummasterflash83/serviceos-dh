import { startQuickBooksAuthorization, completeQuickBooksAuthorization } from "./oauth_flow.ts";
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;
interface Ports {
  siteOrigin: string;
  minorVersion: number;
  userRpc: (jwt: string) => Promise<Rpc | null>;
  serviceRpc: Rpc;
  fetcher?: typeof fetch;
}
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, ...extra, "Content-Type": "application/json" },
  });
function origin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value || url.username || url.password)
    throw new Error("configuration_invalid");
  return url.origin;
}
async function smallBody(req: Request): Promise<unknown> {
  if (
    req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" ||
    !req.body
  )
    throw new Error("request_invalid");
  const reader = req.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    bytes = 0;
  const signal = AbortSignal.timeout(10000);
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 8192) throw new Error("request_invalid");
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function handleQuickBooksStart(req: Request, ports: Ports): Promise<Response> {
  let site: string;
  try {
    site = origin(ports.siteOrigin);
  } catch {
    return json({ error: "configuration_unavailable" }, 503);
  }
  const cors = {
    "Access-Control-Allow-Origin": site,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  if (req.headers.has("origin") && req.headers.get("origin") !== site)
    return json({ error: "origin_denied" }, 403);
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: { ...headers, ...cors } });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
  const authorization = req.headers.get("authorization");
  if (!authorization || !/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(authorization))
    return json({ error: "sign_in_required" }, 401, cors);
  try {
    const rpc = await ports.userRpc(authorization.slice(7));
    if (!rpc) return json({ error: "sign_in_required" }, 401, cors);
    const body = await smallBody(req);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).sort().join(",") !== "appId,connectionId,reason,requestId,tenantId"
    )
      return json({ error: "request_invalid" }, 400, cors);
    const result = await startQuickBooksAuthorization(
      body as Parameters<typeof startQuickBooksAuthorization>[0],
      rpc,
    );
    return json(result, 200, cors);
  } catch {
    return json({ error: "connection_not_started" }, 400, cors);
  }
}
export async function handleQuickBooksCallback(req: Request, ports: Ports): Promise<Response> {
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  let site: string;
  try {
    site = origin(ports.siteOrigin);
  } catch {
    return json({ error: "configuration_unavailable" }, 503);
  }
  if (
    !Number.isSafeInteger(ports.minorVersion) ||
    ports.minorVersion < 1 ||
    ports.minorVersion > 1000
  )
    return json({ error: "configuration_unavailable" }, 503);
  const result = await completeQuickBooksAuthorization(req.url, {
    rpc: ports.serviceRpc,
    minorVersion: ports.minorVersion,
    fetcher: ports.fetcher,
    signal: req.signal,
  });
  // Hosted Supabase rewrites GET text/html to text/plain. Render guidance on
  // the frontend instead; never forward code/state/realm/error query values.
  // An explicit empty fragment also prevents inheriting a callback fragment.
  const outcome = result.state === "saved" ? "review" : "needs_check";
  return new Response(null, {
    status: 303,
    headers: {
      ...headers,
      Location: `${site}/quickbooks?mode=connect&result=${outcome}#`,
    },
  });
}
