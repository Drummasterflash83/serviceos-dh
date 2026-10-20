/** One bounded, permit-gated read of Commusoft's newest created job.
 * The caller must acquire the existing tenant/account quota lease first and
 * persist a separate scoped receipt. This transport returns no job content.
 */
import { CommusoftReadError } from "./read_page.ts";

export type NewestJobObservation = {
  id: string;
  createdOnDateTime: string;
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
const instant = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 80 && Number.isFinite(Date.parse(v)) &&
  /^\d{4}-\d{2}-\d{2}T/.test(v);
const positiveId = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;

export async function readNewestCommusoftJob(
  region: Region,
  key: string,
  ports: Ports,
): Promise<NewestJobObservation | null> {
  const now = (ports.clock ?? Date.now)();
  if (!["uk", "us"].includes(region) || !/^[\x21-\x7e]{1,4096}$/.test(key) ||
    !Number.isSafeInteger(ports.sendBefore) || ports.sendBefore <= now)
    throw new CommusoftReadError("invalid_request");
  if (!await ports.stillAuthorized()) throw new CommusoftReadError("authority_unavailable");
  const origin = region === "uk" ? "https://app.commusoft.co.uk" : "https://app.commusoft.us";
  // Official v2 Jobs reference: sort=-createdOnDateTime, limit=2. The second
  // item lets us reject an obviously reversed response before naming a newest.
  const url = new URL("/api/v2/jobs", origin);
  url.searchParams.set("sort", "-createdOnDateTime");
  url.searchParams.set("limit", "2");
  const signal = ports.signal
    ? AbortSignal.any([ports.signal, AbortSignal.timeout(15000)])
    : AbortSignal.timeout(15000);
  let response: Response;
  try {
    response = await (ports.fetcher ?? fetch)(url, {
      method: "GET", redirect: "error", signal,
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "X-API-VERSION": "2.1" },
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
      if (size > 65536) throw new CommusoftReadError("response_too_large");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new CommusoftReadError("invalid_response"); }
  if (!object(raw) || !object(raw.meta) || !instant(raw.meta.serverTime) ||
    !object(raw.pagination) || typeof raw.pagination.hasMore !== "boolean" ||
    !Array.isArray(raw.data) || raw.data.length > 2 || raw.error !== undefined ||
    (raw.pagination.hasMore && raw.data.length === 0))
    throw new CommusoftReadError("invalid_response");
  const rows = raw.data;
  for (const row of rows) {
    if (!object(row) || !positiveId(row.id) || !instant(row.createdOnDateTime))
      throw new CommusoftReadError("invalid_response");
    if (Date.parse(row.createdOnDateTime) > Date.parse(raw.meta.serverTime) + 300000)
      throw new CommusoftReadError("invalid_response");
  }
  if (rows.length === 2 && Date.parse((rows[0] as Record<string, string>).createdOnDateTime) <
    Date.parse((rows[1] as Record<string, string>).createdOnDateTime))
    throw new CommusoftReadError("invalid_response");
  if (!await ports.stillAuthorized()) throw new CommusoftReadError("authority_unavailable");
  const first = rows[0] as Record<string, unknown> | undefined;
  return first ? {
    id: String(first.id), createdOnDateTime: first.createdOnDateTime as string,
    providerServerTime: raw.meta.serverTime,
  } : null;
}
