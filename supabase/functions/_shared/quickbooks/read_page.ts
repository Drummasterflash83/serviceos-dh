/** Server-only QuickBooks Online reads. This transport cannot write accounting
 * records. OAuth's accounting scope itself is broader: credentials stay in Vault.
 * The worker must supply durable, tenant-bound authority and request reservations.
 */
export const quickBooksEntities = [
  "Customer", "Invoice", "Payment", "CreditMemo", "SalesReceipt", "Estimate",
  "Vendor", "Bill", "BillPayment", "Purchase", "VendorCredit", "Account", "Item",
] as const;
export type QuickBooksEntity = typeof quickBooksEntities[number];
export type QuickBooksEnvironment = "sandbox" | "production";
export interface QuickBooksBinding {
  tenantId: string;
  connectionId: string;
  realmId: string;
  environment: QuickBooksEnvironment;
}
export interface QuickBooksRead extends QuickBooksBinding {
  entity: QuickBooksEntity;
  startPosition: number;
  pageSize: number;
  minorVersion: number;
}
export interface QuickBooksCredential extends QuickBooksBinding {
  accessToken: string;
  expiresAt: string;
}
export type QuickBooksFailure =
  | "invalid_request" | "credential_binding_mismatch" | "authentication_required"
  | "authority_unavailable" | "reservation_unavailable" | "access_denied"
  | "rate_limited" | "provider_unavailable" | "provider_rejected"
  | "invalid_response" | "response_too_large" | "transport_unavailable";
export class QuickBooksReadError extends Error {
  readonly code: QuickBooksFailure;
  readonly retryAt: number | null;
  constructor(code: QuickBooksFailure, retryAt: number | null = null) {
    super(code);
    this.name = "QuickBooksReadError";
    this.code = code;
    this.retryAt = retryAt;
  }
}
function fail(code: QuickBooksFailure): never { throw new QuickBooksReadError(code); }
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const origins = { production: "https://quickbooks.api.intuit.com", sandbox: "https://sandbox-quickbooks.api.intuit.com" };
const activeEntities = new Set<string>(["Customer", "Vendor", "Account", "Item"]);
const bindingKeys = ["tenantId", "connectionId", "realmId", "environment"] as const;
const maximumBytes = 8 * 1024 * 1024;

export function quickBooksReadUrl(input: QuickBooksRead): string {
  if (!input || !uuid(input.tenantId) || !uuid(input.connectionId) ||
    typeof input.realmId !== "string" || !/^[1-9][0-9]{0,29}$/.test(input.realmId) ||
    !Object.hasOwn(origins, input.environment) || !quickBooksEntities.includes(input.entity) ||
    !Number.isSafeInteger(input.startPosition) || input.startPosition < 1 || input.startPosition > 1000000000 ||
    !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 1000 ||
    !Number.isSafeInteger(input.minorVersion) || input.minorVersion < 1 || input.minorVersion > 1000)
    fail("invalid_request");
  const url = new URL(`/v3/company/${input.realmId}/query`, origins[input.environment]);
  // No arbitrary query, endpoint or filter accepted. Include inactive list records.
  const active = activeEntities.has(input.entity) ? " WHERE Active IN (true, false)" : "";
  url.searchParams.set("query", `SELECT * FROM ${input.entity}${active} STARTPOSITION ${input.startPosition} MAXRESULTS ${input.pageSize}`);
  url.searchParams.set("minorversion", String(input.minorVersion));
  return url.href;
}

export interface QuickBooksReadPorts {
  stillAuthorized: (binding: QuickBooksBinding) => Promise<boolean>;
  reserveRequest: (request: QuickBooksRead) => Promise<{ permitId: string; expiresAt: string }>;
  fetcher?: typeof fetch;
  clock?: () => number;
  signal?: AbortSignal;
}
export interface QuickBooksPage {
  binding: QuickBooksBinding;
  entity: QuickBooksEntity;
  records: Record<string, unknown>[];
  rawEnvelope: Record<string, unknown>;
  permitId: string;
  nextPosition: number | null;
  traversalExhausted: boolean;
  // Offset traversal is not an atomic snapshot; reconcile before claiming coverage.
  coverage: "non_atomic_query_traversal";
  providerTime: string;
  observedAt: string;
}

async function jsonBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    await response.body?.cancel();
    fail("invalid_response");
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximumBytes) fail("response_too_large");
      chunks.push(part.value);
    }
    const all = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all)); }
    catch { return fail("invalid_response"); }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readQuickBooksPage(input: QuickBooksRead, credential: QuickBooksCredential, ports: QuickBooksReadPorts): Promise<QuickBooksPage> {
  // Freeze reviewed inputs before awaits; caller mutation must not change authority.
  const request = Object.freeze({ ...input });
  const url = quickBooksReadUrl(request);
  const binding: QuickBooksBinding = Object.freeze(Object.fromEntries(bindingKeys.map(k => [k, request[k]]))) as unknown as QuickBooksBinding;
  if (!credential || bindingKeys.some(k => credential[k] !== request[k])) fail("credential_binding_mismatch");
  const accessToken = credential.accessToken, expires = Date.parse(credential.expiresAt);
  const now = ports.clock ?? Date.now;
  if (typeof accessToken !== "string" || !/^[\x21-\x7e]{1,8192}$/.test(accessToken) || !Number.isFinite(expires) || expires <= now() + 30000)
    fail("authentication_required");
  const signal = ports.signal ? AbortSignal.any([ports.signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000);
  try {
    signal.throwIfAborted();
    if (!await ports.stillAuthorized(binding)) fail("authority_unavailable");
    const permit = await ports.reserveRequest(request);
    if (!permit || !uuid(permit.permitId) || !Number.isFinite(Date.parse(permit.expiresAt)) || Date.parse(permit.expiresAt) <= now()) fail("reservation_unavailable");
    signal.throwIfAborted();
    if (expires <= now() + 30000) fail("authentication_required");
    if (!await ports.stillAuthorized(binding)) fail("authority_unavailable");
    const response = await (ports.fetcher ?? fetch)(url, {
      method: "GET", redirect: "error", signal,
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) fail("authentication_required");
      if (response.status === 403) fail("access_denied");
      if (response.status === 429) {
        const header = response.headers.get("retry-after");
        const seconds = header && /^\d{1,7}$/.test(header) ? Number(header) : null;
        const date = header && seconds === null ? Date.parse(header) : NaN;
        throw new QuickBooksReadError("rate_limited", Math.max(now() + 60000, seconds !== null ? now() + seconds * 1000 : Number.isFinite(date) ? date : 0));
      }
      fail(response.status >= 500 ? "provider_unavailable" : "provider_rejected");
    }
    const raw = await jsonBody(response, signal);
    if (!object(raw) || Object.hasOwn(raw, "Fault") || !object(raw.QueryResponse) ||
      typeof raw.time !== "string" || !Number.isFinite(Date.parse(raw.time))) fail("invalid_response");
    const query = raw.QueryResponse;
    if (Object.keys(query).some(k => ![request.entity, "startPosition", "maxResults", "totalCount"].includes(k))) fail("invalid_response");
    const records = query[request.entity] ?? [];
    if (!Array.isArray(records) || records.length > request.pageSize ||
      (records.length > 0 && (query.startPosition !== request.startPosition || query.maxResults !== records.length)) ||
      (query.startPosition !== undefined && query.startPosition !== request.startPosition) ||
      (query.maxResults !== undefined && query.maxResults !== records.length)) fail("invalid_response");
    const ids = new Set<string>();
    for (const record of records) {
      if (!object(record) || typeof record.Id !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(record.Id) || ids.has(record.Id) ||
        typeof record.SyncToken !== "string" || !/^\d+$/.test(record.SyncToken) ||
        new TextEncoder().encode(JSON.stringify(record)).length > 1024 * 1024) fail("invalid_response");
      ids.add(record.Id);
    }
    if (!await ports.stillAuthorized(binding)) fail("authority_unavailable");
    if (Date.parse(permit.expiresAt) <= now()) fail("reservation_unavailable");
    signal.throwIfAborted();
    const exhausted = records.length < request.pageSize;
    return { binding, entity: request.entity, records, rawEnvelope: raw, permitId: permit.permitId,
      nextPosition: exhausted ? null : request.startPosition + records.length,
      traversalExhausted: exhausted, coverage: "non_atomic_query_traversal", providerTime: raw.time, observedAt: new Date(now()).toISOString() };
  } catch (error) {
    if (error instanceof QuickBooksReadError) throw error;
    throw new QuickBooksReadError("transport_unavailable");
  }
}
