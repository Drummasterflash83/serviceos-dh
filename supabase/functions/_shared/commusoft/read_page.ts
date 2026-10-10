/** Server-only private-application transport. No provider writes or automatic retries.
 * The worker must bind credentials, reserve shared quota and commit pages under its
 * current tenant/connection authority. This module does not provide that authority.
 */
export type CommusoftResource = "properties" | "propertyContacts" | "jobs";
export type CommusoftRegion = "uk" | "us";
export type CommusoftFailure =
  | "invalid_request"
  | "authority_unavailable"
  | "transport_unavailable"
  | "authentication_required"
  | "access_denied"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_rejected"
  | "response_too_large"
  | "invalid_response";

export class CommusoftReadError extends Error {
  readonly code: CommusoftFailure;
  readonly retryAt: number | null;
  constructor(code: CommusoftFailure, retryAt: number | null = null) {
    super(code);
    this.name = "CommusoftReadError";
    this.code = code;
    this.retryAt = retryAt;
  }
}

export interface CommusoftReadRequest {
  region: CommusoftRegion;
  resource: CommusoftResource;
  after: number | null;
  limit: number;
  // Contacts can include suppliers; explicitly restrict them to customer/workaddress.
  contactType?: "customer" | "workaddress";
}
export interface CommusoftPage {
  records: Record<string, unknown>[];
  nextCursor: number | null;
  collectionExhausted: boolean;
  // Exhausting a traversal does not prove an atomic snapshot or deletion coverage.
  rawEnvelope: Record<string, unknown>;
  quota: { remaining: number | null; resetAt: number | null; retryAt: number | null };
}
const origins = { uk: "https://app.commusoft.co.uk", us: "https://app.commusoft.us" };
const resources = new Set(["properties", "propertyContacts", "jobs"]);
const maximumBodyBytes = 2 * 1024 * 1024;
const maximumRecordBytes = 256 * 1024;
const encoder = new TextEncoder();
function fail(code: CommusoftFailure): never {
  throw new CommusoftReadError(code);
}
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const positiveId = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;

function requestUrl(request: CommusoftReadRequest): string {
  if (
    !Object.hasOwn(origins, request.region) ||
    !resources.has(request.resource) ||
    !Number.isInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > 100 ||
    (request.after !== null && !positiveId(request.after)) ||
    (request.resource === "propertyContacts" &&
      !["customer", "workaddress"].includes(request.contactType ?? "")) ||
    (request.resource !== "propertyContacts" && request.contactType !== undefined)
  )
    fail("invalid_request");
  const url = new URL(`/api/v2/${request.resource}`, origins[request.region]);
  url.searchParams.set("limit", String(request.limit));
  if (request.after !== null) url.searchParams.set("after", String(request.after));
  if (request.contactType) url.searchParams.set("type", request.contactType);
  return url.href;
}

function headerInteger(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function quota(headers: Headers, now: number, throttled: boolean): CommusoftPage["quota"] {
  const remaining = headerInteger(headers, "x-ratelimit-remaining");
  const seconds = headerInteger(headers, "x-ratelimit-reset");
  const resetAt =
    seconds !== null && seconds <= Math.floor(8640000000000000 / 1000) ? seconds * 1000 : null;
  const retryAfter = headers.get("retry-after");
  const delay = headerInteger(headers, "retry-after");
  const retryTime =
    delay !== null && delay <= 31536000
      ? now + delay * 1000
      : retryAfter && !/^\d+$/.test(retryAfter)
        ? Date.parse(retryAfter)
        : NaN;
  const retryAt =
    throttled || remaining === 0
      ? Math.max(now + 60000, resetAt ?? 0, Number.isFinite(retryTime) ? retryTime : 0)
      : null;
  return { remaining, resetAt, retryAt };
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = headerInteger(response.headers, "content-length");
  if (length !== null && length > maximumBodyBytes) {
    await response.body?.cancel().catch(() => {});
    fail("response_too_large");
  }
  if (
    response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
      "application/json" ||
    !response.body
  ) {
    await response.body?.cancel().catch(() => {});
    fail("invalid_response");
  }
  const reader = response.body.getReader();
  // Cancelling also wakes a stalled stream; the deadline covers headers AND body.
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    signal.throwIfAborted();
    for (;;) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumBodyBytes) fail("response_too_large");
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return fail("invalid_response");
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function parsePage(
  raw: unknown,
  request: CommusoftReadRequest,
  usage: CommusoftPage["quota"],
): CommusoftPage {
  if (
    !object(raw) ||
    !object(raw.pagination) ||
    !Array.isArray(raw.data) ||
    raw.data.length > request.limit ||
    typeof raw.pagination.hasMore !== "boolean"
  )
    fail("invalid_response");
  let previous = request.after ?? 0;
  for (const record of raw.data) {
    // Forward id cursors only: fail closed on repeats, unordered rows or precision loss.
    if (
      !object(record) ||
      !positiveId(record.id) ||
      record.id <= previous ||
      encoder.encode(JSON.stringify(record)).byteLength > maximumRecordBytes
    )
      fail("invalid_response");
    previous = record.id;
  }
  const next = raw.pagination.nextCursor;
  if (raw.pagination.hasMore && (!raw.data.length || !positiveId(next) || next !== previous))
    fail("invalid_response");
  // Providers may return the last id, zero or null at the terminal boundary.
  if (
    !raw.pagination.hasMore &&
    next !== undefined &&
    next !== null &&
    next !== 0 &&
    next !== previous
  )
    fail("invalid_response");
  return {
    records: raw.data,
    nextCursor: raw.pagination.hasMore ? (next as number) : null,
    collectionExhausted: !raw.pagination.hasMore,
    rawEnvelope: raw,
    quota: usage,
  };
}

export async function readCommusoftPage(
  request: CommusoftReadRequest,
  apiKey: string,
  ports: {
    // Must re-read exact persisted tenant/connection revision; false refuses the read.
    stillAuthorized: () => Promise<boolean>;
    fetcher?: typeof fetch;
    clock?: () => number;
    signal?: AbortSignal;
    timeoutMs?: number;
    /** Atomic quota permit's latest send time; checked after authority reads. */
    sendBefore?: number;
  },
): Promise<CommusoftPage> {
  // Snapshot caller-owned request before any asynchronous authority check.
  const snapshot = { ...request };
  const url = requestUrl(snapshot);
  if (typeof apiKey !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(apiKey)) fail("invalid_request");
  const timeoutMs = ports.timeoutMs ?? 15000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) fail("invalid_request");
  const controller = new AbortController();
  const abort = () => controller.abort();
  ports.signal?.addEventListener("abort", abort, { once: true });
  if (ports.signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  const authorized = async () => {
    controller.signal.throwIfAborted();
    let valid = false;
    let stop: (() => void) | undefined;
    try {
      valid = await Promise.race([
        Promise.resolve().then(() => ports.stillAuthorized()),
        new Promise<never>((_, reject) => {
          stop = () => reject(new CommusoftReadError("transport_unavailable"));
          controller.signal.addEventListener("abort", stop, { once: true });
        }),
      ]);
    } catch {
      if (controller.signal.aborted) fail("transport_unavailable");
      fail("authority_unavailable");
    } finally {
      if (stop) controller.signal.removeEventListener("abort", stop);
    }
    if (!valid) fail("authority_unavailable");
    controller.signal.throwIfAborted();
  };
  try {
    await authorized();
    if (
      ports.sendBefore !== undefined &&
      (!Number.isSafeInteger(ports.sendBefore) || (ports.clock ?? Date.now)() >= ports.sendBefore)
    )
      fail("authority_unavailable");
    const response = await (ports.fetcher ?? fetch)(url, {
      method: "GET",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      headers: {
        // Verified against the existing Drummonds private app on 10 Oct 2026.
        // The endpoint's Bearer contract succeeds; the general x-api-key guide
        // returned 401. An honest application UA also avoids the generic Node 403.
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "OpenFolk-ServiceOS/1.0 (+https://openfolk.ai)",
        Accept: "application/json",
        ...(snapshot.resource === "jobs" ? { "X-API-VERSION": "2.1" } : {}),
      },
      signal: controller.signal,
    });
    const usage = quota(response.headers, (ports.clock ?? Date.now)(), response.status === 429);
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      const code =
        response.status === 401
          ? "authentication_required"
          : response.status === 403
            ? "access_denied"
            : response.status === 429
              ? "rate_limited"
              : response.status >= 500
                ? "provider_unavailable"
                : "provider_rejected";
      throw new CommusoftReadError(code, usage.retryAt);
    }
    const raw = await readJson(response, controller.signal);
    await authorized();
    return parsePage(raw, snapshot, usage);
  } catch (error) {
    if (error instanceof CommusoftReadError) throw error;
    // Never surface provider bodies, network URLs, keys or thrown authority details.
    throw new CommusoftReadError("transport_unavailable");
  } finally {
    clearTimeout(timer);
    ports.signal?.removeEventListener("abort", abort);
  }
}
