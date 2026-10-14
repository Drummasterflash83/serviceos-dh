import { readQuickBooksPage, QuickBooksReadError } from "./read_page.ts";
import type { QuickBooksRead, QuickBooksCredential } from "./read_page.ts";
import { refreshQuickBooksConnection } from "./oauth_flow.ts";
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
/** One durable, approved page per invocation. Scope, pacing and credential are
 * database-derived. A lost commit reply is settled through the page receipt;
 * the original provider JSON text reaches Postgres without numeric reserializing.
 */
export async function runQuickBooksImport(ports: {
  rpc: Rpc;
  fetcher?: typeof fetch;
  clock?: () => number;
  signal?: AbortSignal;
}) {
  const acquired = await ports.rpc("learn_quickbooks_import_acquire", {});
  if (acquired.error || !object(acquired.data)) throw Error("quickbooks_claim_unconfirmed");
  const a = acquired.data;
  if (a.state === "idle" || a.state === "waiting" || a.state === "held")
    return { claimed: 0, state: a.state };
  if (a.state === "refresh_required") {
    if (!uuid(a.tenantId) || !uuid(a.connectionId) || !uuid(a.runId))
      throw Error("quickbooks_claim_invalid");
    const result = await refreshQuickBooksConnection(a.tenantId, a.connectionId, ports);
    // Do not hold a worker open waiting for expiry or pace. Next scheduled tick
    // acquires only after the saved token state and run remain eligible.
    return {
      claimed: 0,
      state: result === "refreshed" || result === "current" ? "waiting" : "attention",
    };
  }
  if (
    a.state !== "ready" ||
    !uuid(a.runId) ||
    !uuid(a.permitId) ||
    typeof a.expiresAt !== "string" ||
    !object(a.request) ||
    !object(a.credential)
  )
    throw Error("quickbooks_claim_invalid");
  const scope = { p_run: a.runId, p_permit: a.permitId };
  const requested = { ...a.request };
  let failure = "persistence_unconfirmed",
    delay = 60;
  try {
    const page = await readQuickBooksPage(
      requested as unknown as QuickBooksRead,
      a.credential as unknown as QuickBooksCredential,
      {
        ...ports,
        stillAuthorized: async () => {
          const r = await ports.rpc("learn_quickbooks_import_current", scope);
          return !r.error && r.data === true;
        },
        reserveRequest: async (request) => {
          // This invocation already owns exactly this durable reservation. It cannot
          // switch a company/entity/offset after acquisition or issue another request.
          for (const key of [
            "tenantId",
            "connectionId",
            "realmId",
            "environment",
            "entity",
            "startPosition",
            "pageSize",
            "minorVersion",
          ] as const)
            if (request[key] !== requested[key])
              throw new QuickBooksReadError("reservation_unavailable");
          return { permitId: a.permitId as string, expiresAt: a.expiresAt as string };
        },
      },
    );
    const saved = await ports.rpc("learn_quickbooks_import_commit", {
      ...scope,
      p_raw: page.rawEnvelopeText,
    });
    if (
      !saved.error &&
      object(saved.data) &&
      saved.data.runId === a.runId &&
      uuid(saved.data.pageId) &&
      ["queued", "traversed", "limit_reached"].includes(String(saved.data.state))
    )
      return { claimed: 1, state: "saved", runId: a.runId, receipt: saved.data };
  } catch (error) {
    if (error instanceof QuickBooksReadError) {
      failure = error.code;
      if (error.retryAt !== null)
        delay = Math.min(
          31536000,
          Math.max(60, Math.ceil((error.retryAt - (ports.clock ?? Date.now)()) / 1000)),
        );
      if (
        ![
          "authentication_required",
          "access_denied",
          "rate_limited",
          "provider_unavailable",
          "provider_rejected",
          "invalid_response",
          "response_too_large",
          "transport_unavailable",
          "authority_unavailable",
          "reservation_unavailable",
        ].includes(failure)
      )
        failure = "invalid_response";
    }
  }
  // SQL first checks a retained page, so a committed but lost response is never
  // converted into failure or a repeated fetch at the previous position.
  const settled = await ports.rpc("learn_quickbooks_import_fail", {
    ...scope,
    p_code: failure,
    p_retry_seconds: delay,
  });
  if (settled.error || !object(settled.data) || settled.data.runId !== a.runId)
    throw Error("quickbooks_settlement_unconfirmed");
  return { claimed: 1, state: uuid(settled.data.pageId) ? "saved" : "attention", runId: a.runId };
}
