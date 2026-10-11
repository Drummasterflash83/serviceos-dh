/** Shared bounded transport for the Microsoft mail resource readers. */
export type MicrosoftMailErrorCode =
  | "invalid_scope"
  | "invalid_continuation"
  | "fetch_failed"
  | "invalid_response"
  | "response_too_large"
  | "auth_required"
  | "access_denied"
  | "folder_unavailable"
  | "delta_expired"
  | "throttled"
  | "provider_unavailable"
  | "pagination_no_progress"
  | "invalid_discovery_state"
  | "hierarchy_conflict"
  | "discovery_limit";
export class MicrosoftMailError extends Error {
  readonly code: MicrosoftMailErrorCode;
  readonly retryAfterSeconds: number | null;
  constructor(code: MicrosoftMailErrorCode, retryAfterSeconds: number | null = null) {
    super(`Microsoft mail capture: ${code}`);
    this.name = "MicrosoftMailError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
export function fail(code: MicrosoftMailErrorCode = "invalid_response"): never {
  throw new MicrosoftMailError(code);
}
export const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
// Graph identifiers are case-sensitive. Encode each ID as one path component.
export const id = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 2048 && /^[A-Za-z0-9+/_=-]+$/.test(v);
const MAX_BYTES = 16 * 1024 * 1024;

/** Global-cloud Graph URL only. Each resource reader must additionally bind the
 * path and continuation to its authorized mailbox and collection before calling. */
export function graphUrl(url: unknown): URL {
  if (typeof url !== "string" || url.length > 32768 || /[\s\\\u0000-\u001f]/.test(url))
    fail("invalid_continuation");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail("invalid_continuation");
  }
  if (
    parsed.origin !== "https://graph.microsoft.com" ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  )
    fail("invalid_continuation");
  return parsed;
}
async function jsonBody(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) {
    await discardBody(response);
    fail("response_too_large");
  }
  const reader = response.body?.getReader();
  if (!reader) return fail();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return fail("response_too_large");
      }
      chunks.push(value);
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch (e) {
    if (e instanceof MicrosoftMailError) throw e;
    return fail();
  } finally {
    reader.releaseLock();
  }
}
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A transport cleanup failure must not expose provider content or hide status.
  }
}
function retryAfter(response: Response, now: number): number | null {
  const v = response.headers.get("retry-after");
  if (v === null) return null;
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  }
  const time = Date.parse(v);
  return Number.isFinite(time) ? Math.max(0, Math.ceil((time - now) / 1000)) : null;
}

export async function readMicrosoftGraphJson(
  accessToken: string,
  url: string,
  pageSize: number,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<{ body: unknown; fetchedAt: string }> {
  graphUrl(url);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) fail("invalid_scope");
  const startedAt = now();
  if (!Number.isFinite(startedAt) || !Number.isFinite(new Date(startedAt).getTime()))
    fail("invalid_scope");
  if (
    typeof accessToken !== "string" ||
    !accessToken ||
    accessToken.length > 32768 ||
    /[\s\u0000-\u001f]/.test(accessToken)
  )
    fail("auth_required");
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: `IdType="ImmutableId", odata.maxpagesize=${pageSize}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    return fail("fetch_failed");
  }
  const statusCode: MicrosoftMailErrorCode | null =
    response.status === 401
      ? "auth_required"
      : response.status === 403
        ? "access_denied"
        : response.status === 404
          ? "folder_unavailable"
          : response.status === 410
            ? "delta_expired"
            : response.status === 429
              ? "throttled"
              : response.status >= 500
                ? "provider_unavailable"
                : null;
  if (statusCode) {
    await discardBody(response);
    throw new MicrosoftMailError(
      statusCode,
      response.status === 429 || response.status >= 500 ? retryAfter(response, startedAt) : null,
    );
  }
  const body = await jsonBody(response);
  if (response.status !== 200) {
    if (
      object(body) &&
      object(body.error) &&
      ["syncStateNotFound", "ErrorSyncStateNotFound", "resyncRequired"].includes(body.error.code)
    )
      fail("delta_expired");
    return fail("fetch_failed");
  }

  const finishedAt = now();
  if (!Number.isFinite(finishedAt) || !Number.isFinite(new Date(finishedAt).getTime()))
    fail("invalid_response");
  return { body, fetchedAt: new Date(finishedAt).toISOString() };
}
