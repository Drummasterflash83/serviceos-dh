/** Permit-gated page of newest-created Commusoft jobs. Caller owns the tenant
 * authority, quota lease and durable settlement; no job content is returned. */
import { CommusoftReadError } from "./read_page.ts";

export type NewestJobPage = {
  rows: { id: string; createdAt: string }[];
  nextCursor: number | null;
  hasMore: boolean;
  providerServerTime: string;
};
type Region = "uk" | "us";
type Ports = {
  stillAuthorized: () => Promise<boolean>;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  clock?: () => number;
  sendBefore: number;
};
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const positiveId = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const jobInstant = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 80 &&
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}/.test(v) &&
  Number.isFinite(Date.parse(v));
function serverInstant(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 80) return null;
  // Published Commusoft envelopes use YYYY-MM-DD HH:MM:SS.
  const normalized = /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?$/.test(v)
    ? `${v.replace(" ", "T")}Z` : v;
  return jobInstant(normalized) ? normalized : null;
}

export async function readNewestCommusoftJobPage(
  region: Region, key: string, after: number | null, ports: Ports,
): Promise<NewestJobPage> {
  const clock = ports.clock ?? Date.now;
  if (!["uk", "us"].includes(region) || !/^[\x21-\x7e]{1,4096}$/.test(key) ||
    (after !== null && !positiveId(after)) ||
    !Number.isSafeInteger(ports.sendBefore) || ports.sendBefore <= clock())
    throw new CommusoftReadError("invalid_request");
  if (!await ports.stillAuthorized()) throw new CommusoftReadError("authority_unavailable");
  if (clock() >= ports.sendBefore) throw new CommusoftReadError("request_window_expired");
  const url = new URL("/api/v2/jobs", region === "uk"
    ? "https://app.commusoft.co.uk" : "https://app.commusoft.us");
  url.searchParams.set("sort", "-createdOnDateTime");
  url.searchParams.set("limit", "100");
  if (after !== null) url.searchParams.set("after", String(after));
  const signal = ports.signal
    ? AbortSignal.any([ports.signal, AbortSignal.timeout(15_000)])
    : AbortSignal.timeout(15_000);
  let response: Response;
  try {
    response = await (ports.fetcher ?? fetch)(url, {
      method: "GET", redirect: "error", signal,
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json",
        "X-API-VERSION": "2.1" },
    });
  } catch { throw new CommusoftReadError("transport_unavailable"); }
  if (!response.ok || !response.body ||
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    await response.body?.cancel().catch(() => {});
    throw new CommusoftReadError(response.status === 401 ? "authentication_required"
      : response.status === 403 ? "access_denied"
        : response.status === 429 ? "rate_limited" : "provider_unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2 * 1024 * 1024) throw new CommusoftReadError("response_too_large");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new CommusoftReadError("invalid_response"); }
  if (!object(raw) || !object(raw.meta) || !object(raw.pagination) ||
    !Array.isArray(raw.data) || raw.data.length > 100 || raw.error !== undefined ||
    typeof raw.pagination.hasMore !== "boolean")
    throw new CommusoftReadError("invalid_response");
  const providerServerTime = serverInstant(raw.meta.serverTime);
  if (!providerServerTime || (raw.pagination.hasMore && raw.data.length === 0))
    throw new CommusoftReadError("invalid_response");
  const rows: NewestJobPage["rows"] = [];
  let prior = Number.POSITIVE_INFINITY;
  const ids = new Set<number>();
  for (const row of raw.data) {
    if (!object(row) || !positiveId(row.id) || !jobInstant(row.createdOnDateTime) ||
      ids.has(row.id) || row.id === after ||
      Date.parse(row.createdOnDateTime) > Date.parse(providerServerTime) + 300_000 ||
      Date.parse(row.createdOnDateTime) > prior)
      throw new CommusoftReadError("invalid_response");
    ids.add(row.id);
    prior = Date.parse(row.createdOnDateTime);
    rows.push({ id: String(row.id), createdAt: row.createdOnDateTime });
  }
  const next = raw.pagination.nextCursor;
  if (raw.pagination.hasMore &&
    (!positiveId(next) || next !== Number(rows.at(-1)?.id) || next === after))
    throw new CommusoftReadError("invalid_response");
  if (!await ports.stillAuthorized()) throw new CommusoftReadError("authority_unavailable");
  return { rows, nextCursor: raw.pagination.hasMore ? next as number : null,
    hasMore: raw.pagination.hasMore, providerServerTime };
}
