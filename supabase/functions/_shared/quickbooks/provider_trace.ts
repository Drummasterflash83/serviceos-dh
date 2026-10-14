/** Server-only provider metadata. Intuit's trace ID lets support locate a request.
 * Never log URLs, query strings, headers other than intuit_tid, bodies, tokens,
 * company identifiers or raw exceptions. These events use existing Edge logs;
 * they are not accounting evidence or an indefinite audit archive.
 */
export interface QuickBooksProviderTrace {
  event: "quickbooks_provider_response";
  operation: "token" | "company_info" | "query" | "revoke";
  environment: "sandbox" | "production" | "oauth";
  observedAt: string;
  status: number | null;
  intuitTid: string | null;
  outcome: "response" | "transport_unconfirmed";
}
type Sink = (event: QuickBooksProviderTrace) => void | Promise<void>;
const traceId = (headers: Headers): string | null => {
  const value = headers.get("intuit_tid") ?? headers.get("intuit-tid");
  return value !== null && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
};
function endpoint(input: Parameters<typeof fetch>[0], init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (url.username || url.password || url.hash) throw Error("quickbooks_transport_invalid");
  if (method === "POST" && !url.search) {
    if (url.href === "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer")
      return { operation: "token" as const, environment: "oauth" as const };
    if (url.href === "https://developer.api.intuit.com/v2/oauth2/tokens/revoke")
      return { operation: "revoke" as const, environment: "oauth" as const };
  }
  if (
    method === "GET" &&
    ["https://quickbooks.api.intuit.com", "https://sandbox-quickbooks.api.intuit.com"].includes(
      url.origin,
    )
  ) {
    const environment = url.hostname.startsWith("sandbox-")
      ? ("sandbox" as const)
      : ("production" as const);
    if (/^\/v3\/company\/[1-9][0-9]{0,29}\/query$/.test(url.pathname))
      return { operation: "query" as const, environment };
    if (/^\/v3\/company\/([1-9][0-9]{0,29})\/companyinfo\/\1$/.test(url.pathname))
      return { operation: "company_info" as const, environment };
  }
  throw Error("quickbooks_transport_invalid");
}
export function quickBooksDiagnosticFetch(
  fetcher: typeof fetch = fetch,
  sink: Sink = (event) => console.info(JSON.stringify(event)),
): typeof fetch {
  const emit = (event: QuickBooksProviderTrace) => {
    // Logging failure must never cause a repeat token exchange or provider call.
    try {
      void Promise.resolve(sink(event)).catch(() => {});
    } catch {
      /* existing outcome wins */
    }
  };
  return async (input, init) => {
    const context = endpoint(input, init);
    let response: Response;
    try {
      response = await fetcher(input, init);
    } catch {
      emit({
        event: "quickbooks_provider_response",
        ...context,
        observedAt: new Date().toISOString(),
        status: null,
        intuitTid: null,
        outcome: "transport_unconfirmed",
      });
      throw Error("quickbooks_transport_unconfirmed");
    }
    emit({
      event: "quickbooks_provider_response",
      ...context,
      observedAt: new Date().toISOString(),
      status: response.status,
      intuitTid: traceId(response.headers),
      outcome: "response",
    });
    // Preserve the same response and unread stream for size/schema validation.
    return response;
  };
}
