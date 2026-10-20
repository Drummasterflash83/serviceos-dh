import { CommusoftReadError } from "./read_page.ts";

type RpcResult = { data: unknown; error: unknown };
type Database = { rpc: (name: string, args?: Record<string, unknown>) => Promise<RpcResult> };
type State = "idle" | "waiting" | "held" | "processed" | "attention" | "unconfirmed";
type Region = "uk" | "us";
type Claim = { state: string; id?: string; claim_token?: string; external_id?: string;
  region?: Region; api_key?: string; send_before?: number };
type StatusRead = { status: string; providerUpdated: string | null; sha256: string };
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const externalId = (value: unknown): value is string => typeof value === "string" &&
  /^[1-9][0-9]{0,15}$/.test(value) && Number(value) <= Number.MAX_SAFE_INTEGER;

/** Read only one exact provider job. Return status evidence, never job content. */
export async function readDailyCommusoftJobStatus(
  region: Region, key: string, id: string,
  ports: { stillAuthorized: () => Promise<boolean>; sendBefore: number;
    fetcher?: typeof fetch; signal?: AbortSignal; clock?: () => number },
): Promise<StatusRead> {
  const clock = ports.clock ?? Date.now;
  if (!(["uk", "us"] as string[]).includes(region) ||
    !/^[\x21-\x7e]{1,4096}$/.test(key) || !externalId(id) ||
    !Number.isSafeInteger(ports.sendBefore) || ports.sendBefore <= clock())
    throw new CommusoftReadError("invalid_request");
  if (!await ports.stillAuthorized()) throw new CommusoftReadError("authority_unavailable");
  if (clock() >= ports.sendBefore) throw new CommusoftReadError("request_window_expired");
  const signal = ports.signal
    ? AbortSignal.any([ports.signal, AbortSignal.timeout(15_000)])
    : AbortSignal.timeout(15_000);
  let response: Response;
  try {
    response = await (ports.fetcher ?? fetch)(
      `${region === "uk" ? "https://app.commusoft.co.uk" : "https://app.commusoft.us"}/api/v2/jobs/${id}`,
      { method: "GET", redirect: "error", signal,
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json",
          "X-API-VERSION": "2.0" } },
    );
  } catch { throw new CommusoftReadError("transport_unavailable"); }
  if (!response.ok || !response.body ||
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    await response.body?.cancel().catch(() => {});
    throw new CommusoftReadError(response.status === 401 ? "authentication_required"
      : response.status === 403 ? "access_denied"
        : response.status === 429 ? "rate_limited" : "provider_unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 131072) throw new CommusoftReadError("response_too_large");
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof CommusoftReadError) throw error;
    throw new CommusoftReadError("transport_unavailable");
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new CommusoftReadError("invalid_response"); }
  if (!object(raw) || raw.error !== undefined ||
    typeof raw.id !== "number" || !Number.isSafeInteger(raw.id) ||
    String(raw.id) !== id || typeof raw.status !== "string" ||
    !/^[\x20-\x7e]{1,120}$/.test(raw.status))
    throw new CommusoftReadError("invalid_response");
  const updated = raw.lastUpdatedOnDateTime;
  if (updated !== undefined && updated !== null &&
    (typeof updated !== "string" || updated.length > 80 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(updated) ||
      !Number.isFinite(Date.parse(updated))))
    throw new CommusoftReadError("invalid_response");
  if (!await ports.stillAuthorized()) throw new CommusoftReadError("authority_unavailable");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return { status: raw.status, providerUpdated: typeof updated === "string" ? updated : null,
    sha256: [...digest].map(value => value.toString(16).padStart(2, "0")).join("") };
}

/** One exact GET per existing Commusoft worker invocation. SQL owns the daily
 * roster, tenant flag, credential lease, source version and durable receipt. */
export async function runDailyCommusoftJobStatus(
  db: Database, signal?: AbortSignal,
  transport: typeof readDailyCommusoftJobStatus = readDailyCommusoftJobStatus,
): Promise<{ state: State }> {
  if (signal?.aborted) return { state: "unconfirmed" };
  const claimed = await db.rpc("new_dawn_job_status_daily_claim");
  if (claimed.error || !object(claimed.data)) return { state: "unconfirmed" };
  const value = claimed.data as Claim;
  if (["idle", "waiting", "held"].includes(value.state)) return { state: value.state as State };
  if (value.state !== "ready" || !uuid(value.id) || !uuid(value.claim_token) ||
    !externalId(value.external_id) || !["uk", "us"].includes(value.region ?? "") ||
    typeof value.api_key !== "string" || !Number.isSafeInteger(value.send_before))
    return { state: "unconfirmed" };
  const id = value.id, token = value.claim_token;
  try {
    const result = await transport(value.region!, value.api_key!, value.external_id!, {
      sendBefore: value.send_before!, signal,
      stillAuthorized: async () => {
        const current = await db.rpc("new_dawn_job_status_daily_current",
          { p_id: id, p_token: token });
        return !current.error && current.data === true;
      },
    });
    const settled = await db.rpc("new_dawn_job_status_daily_finish", {
      p_id: id, p_token: token, p_external: value.external_id,
      p_status: result.status, p_provider_updated: result.providerUpdated,
      p_sha256: result.sha256,
    });
    if (settled.error || !object(settled.data) || settled.data.id !== id ||
      settled.data.state !== "observed") return { state: "unconfirmed" };
    return { state: "processed" };
  } catch (error) {
    const code = error instanceof CommusoftReadError ? error.code : "result_unconfirmed";
    const allowed = ["authority_unavailable", "request_window_expired", "transport_unavailable",
      "authentication_required", "access_denied", "rate_limited", "provider_unavailable",
      "response_too_large", "invalid_response"];
    if (code === "result_unconfirmed") return { state: "unconfirmed" };
    const failed = await db.rpc("new_dawn_job_status_daily_fail", {
      p_id: id, p_token: token,
      p_code: code === "authority_unavailable" ? "scope_changed"
        : code === "invalid_response" ? "response_invalid"
          : allowed.includes(code) ? code : "result_unconfirmed",
    });
    return { state: failed.error ? "unconfirmed" : "attention" };
  }
}
