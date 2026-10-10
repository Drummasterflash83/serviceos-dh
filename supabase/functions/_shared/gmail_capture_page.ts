/** Bounded, explicit Gmail pages for the receipt-based worker. These helpers do
 * not update cursors, sync runs or queue jobs and never discard a next-page token.
 * API contracts: developers.google.com/workspace/gmail/api/reference/rest/v1/
 * users.messages/list and users.history/list.
 */
import { parseGmailMessages } from "./gmail_message.ts";
export type GmailPageRequest = {
  mode: "history" | "reconcile" | "historical";
  label: "INBOX" | "SENT" | null;
  pageSize: number;
  pageToken: string | null;
  originHistoryId: string | null;
};
export type GmailCapturePage = { ids: string[]; nextPageToken: string | null; exhausted: boolean };
export type GmailPageEvidence = {
  persistence: "confirmed";
  message_upsert_count: number;
  thread_upsert_count: number;
  ids_seen: number;
  gone_count: number;
  unresolved_count: 0;
};
export interface GmailPageStore {
  existingMessageIds(ids: string[]): Promise<string[]>;
  /** Atomically save both sets, preserving newer summaries and participants. */
  savePage(
    threads: Record<string, unknown>[],
    messages: Record<string, unknown>[],
  ): Promise<{
    thread_upsert_count: number;
    message_upsert_count: number;
  }>;
}
export class GmailCaptureError extends Error {
  readonly code:
    | "fetch_failed"
    | "parse_failed"
    | "persistence_failed"
    | "history_expired"
    | "pagination_no_progress"
    | "source_ineligible";
  readonly persistenceUnknown: boolean;
  constructor(code: GmailCaptureError["code"], persistenceUnknown = false) {
    super(`Email capture requires review (${code}).`);
    this.name = "GmailCaptureError";
    this.code = code;
    this.persistenceUnknown = persistenceUnknown;
  }
}
const obj = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,256}$/.test(v);
export const gmailHistoryId = (v: unknown): v is string =>
  typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n;
const token = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 8192;
function fail(code: GmailCaptureError["code"] = "parse_failed"): never {
  throw new GmailCaptureError(code);
}
function validateRequest(r: GmailPageRequest) {
  if (
    !r ||
    !["history", "reconcile", "historical"].includes(r.mode) ||
    !Number.isInteger(r.pageSize) ||
    r.pageSize < 1 ||
    r.pageSize > 500 ||
    !(r.pageToken === null || token(r.pageToken)) ||
    (r.mode === "historical" ? r.label !== null : !["INBOX", "SENT"].includes(r.label ?? "")) ||
    (r.mode === "history" ? !gmailHistoryId(r.originHistoryId) : r.originHistoryId !== null)
  )
    fail();
}
async function request(
  accessToken: string,
  path: string,
  fetcher: typeof fetch,
  history = false,
  gone = false,
  timeoutMs = 15000,
  reserveBytes?: (bytes: number) => void,
): Promise<Record<string, any> | null> {
  if (typeof accessToken !== "string" || !accessToken) fail("source_ineligible");
  try {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail("fetch_failed");
    const response = await fetcher(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs))),
    });
    if (response.status === 404 && history) fail("history_expired");
    if (gone && [404, 410].includes(response.status)) return null;
    if (!response.ok) fail("fetch_failed");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = response.body?.getReader();
    if (!reader) fail();
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 8 * 1024 * 1024) {
          await reader.cancel();
          fail();
        }
        reserveBytes?.(part.value.byteLength);
        chunks.push(part.value);
      }
    } catch (e) {
      await reader.cancel().catch(() => {});
      throw e;
    } finally {
      reader.releaseLock();
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    } catch {
      fail();
    }
    if (!obj(value)) fail();
    return value;
  } catch (e) {
    if (e instanceof GmailCaptureError) throw e;
    throw new GmailCaptureError("fetch_failed");
  }
}
export async function readGmailCaptureBoundary(
  accessToken: string,
  mailbox: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (typeof mailbox !== "string" || !mailbox.trim()) fail("source_ineligible");
  const data = await request(accessToken, "/profile", fetcher);
  if (
    !data ||
    typeof data.emailAddress !== "string" ||
    data.emailAddress.toLowerCase() !== mailbox.toLowerCase()
  )
    fail("source_ineligible");
  if (!gmailHistoryId(data.historyId)) fail();
  return data.historyId;
}
export async function readGmailCapturePage(
  accessToken: string,
  r: GmailPageRequest,
  fetcher: typeof fetch = fetch,
): Promise<GmailCapturePage> {
  validateRequest(r);
  const params = new URLSearchParams({ maxResults: String(r.pageSize) });
  if (r.pageToken !== null) params.set("pageToken", r.pageToken);
  if (r.mode === "history") {
    params.set("startHistoryId", r.originHistoryId!);
    params.set("historyTypes", "messageAdded");
    params.set("labelId", r.label!);
  } else if (r.label !== null) params.set("labelIds", r.label);
  const data = (await request(
    accessToken,
    `${r.mode === "history" ? "/history" : "/messages"}?${params}`,
    fetcher,
    r.mode === "history",
  ))!;
  if ("nextPageToken" in data && !token(data.nextPageToken)) fail();
  const next = data.nextPageToken ?? null;
  if (next !== null && next === r.pageToken) fail("pagination_no_progress");
  const ids = new Set<string>();
  if (r.mode === "history") {
    if (!gmailHistoryId(data.historyId) || BigInt(data.historyId) < BigInt(r.originHistoryId!))
      fail();
    if ("history" in data && !Array.isArray(data.history)) fail();
    if ((data.history ?? []).length > r.pageSize) fail();
    for (const record of data.history ?? []) {
      if (
        !obj(record) ||
        !gmailHistoryId(record.id) ||
        ("messagesAdded" in record && !Array.isArray(record.messagesAdded))
      )
        fail();
      for (const added of record.messagesAdded ?? []) {
        if (!obj(added) || !obj(added.message) || !id(added.message.id)) fail();
        ids.add(added.message.id);
      }
      if (ids.size > 2000) fail();
    }
  } else {
    if ("messages" in data && !Array.isArray(data.messages)) fail();
    if ((data.messages ?? []).length > r.pageSize) fail();
    for (const message of data.messages ?? []) {
      if (!obj(message) || !id(message.id)) fail();
      ids.add(message.id);
    }
  }
  return { ids: [...ids], nextPageToken: next, exhausted: next === null };
}
function validateMessage(message: Record<string, any>, expectedId: string) {
  if (
    message.id !== expectedId ||
    !id(message.threadId) ||
    !obj(message.payload) ||
    typeof message.internalDate !== "string" ||
    !/^\d{1,16}$/.test(message.internalDate) ||
    !Number.isFinite(new Date(Number(message.internalDate)).getTime()) ||
    ("labelIds" in message &&
      (!Array.isArray(message.labelIds) ||
        message.labelIds.some((x: unknown) => typeof x !== "string"))) ||
    ("snippet" in message && typeof message.snippet !== "string") ||
    ("historyId" in message && !gmailHistoryId(message.historyId))
  )
    fail();
  let nodes = 0;
  function part(p: unknown, depth: number) {
    if (!obj(p) || depth > 20 || ++nodes > 1000) fail();
    for (const k of ["mimeType", "filename"]) if (k in p && typeof p[k] !== "string") fail();
    if (
      "headers" in p &&
      (!Array.isArray(p.headers) ||
        p.headers.some(
          (h: unknown) => !obj(h) || typeof h.name !== "string" || typeof h.value !== "string",
        ))
    )
      fail();
    if ("body" in p) {
      if (!obj(p.body)) fail();
      if ("data" in p.body) {
        const data = p.body.data;
        if (
          typeof data !== "string" ||
          !/^[a-zA-Z0-9_-]*={0,2}$/.test(data) ||
          data.replace(/=+$/, "").length % 4 === 1
        )
          fail();
        try {
          atob(data.replace(/-/g, "+").replace(/_/g, "/"));
        } catch {
          fail();
        }
      }
    }
    if ("parts" in p) {
      if (!Array.isArray(p.parts)) fail();
      for (const child of p.parts) part(child, depth + 1);
    }
  }
  part(message.payload, 0);
}
/** Fetch a complete page, parse it and await every storage acknowledgement.
 * Failure returns no checkpoint evidence. No source rows are deleted, including
 * when Gmail reports that an individual message has since disappeared.
 */
export async function persistGmailCapturePage(options: {
  accessToken: string;
  tenantId: string;
  mailbox: string;
  page: GmailCapturePage;
  fetchPolicy: "missing_only" | "refetch_all";
  store: GmailPageStore;
  fetcher?: typeof fetch;
  deadlineMs?: number;
}): Promise<GmailPageEvidence> {
  const { accessToken, tenantId, mailbox, page, store } = options,
    fetcher = options.fetcher ?? fetch;
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(tenantId) ||
    !mailbox ||
    !page ||
    !Array.isArray(page.ids) ||
    page.ids.length > 2000 ||
    page.ids.some((x) => !id(x)) ||
    new Set(page.ids).size !== page.ids.length ||
    !(page.nextPageToken === null || token(page.nextPageToken)) ||
    page.exhausted !== (page.nextPageToken === null) ||
    !["missing_only", "refetch_all"].includes(options.fetchPolicy)
  )
    fail();
  const deadline = options.deadlineMs ?? Date.now() + 60000;
  if (!Number.isFinite(deadline) || deadline <= Date.now()) fail("fetch_failed");
  let needed = page.ids;
  if (options.fetchPolicy === "missing_only" && needed.length) {
    try {
      const existing = await store.existingMessageIds([...needed]);
      if (!Array.isArray(existing) || existing.some((x) => !id(x) || !page.ids.includes(x)))
        throw Error();
      const have = new Set(existing);
      needed = needed.filter((x) => !have.has(x));
    } catch {
      throw new GmailCaptureError("persistence_failed");
    }
  }
  const messages: Record<string, unknown>[] = [];
  let index = 0,
    gone = 0,
    pageBytes = 0,
    failed: GmailCaptureError | undefined;
  // Bound aggregate retained response bytes as well as each response. A rejected
  // page returns no progress evidence; the caller must retain its input cursor.
  const reserveBytes = (bytes: number) => {
    pageBytes += bytes;
    if (pageBytes > 32 * 1024 * 1024) fail();
  };
  await Promise.all(
    Array.from({ length: Math.min(4, needed.length) }, async () => {
      while (!failed && index < needed.length) {
        const expected = needed[index++];
        try {
          const message = await request(
            accessToken,
            `/messages/${encodeURIComponent(expected)}?format=full`,
            fetcher,
            false,
            true,
            Math.min(15000, deadline - Date.now()),
            reserveBytes,
          );
          if (message === null) {
            gone++;
            continue;
          }
          validateMessage(message, expected);
          messages.push(message);
        } catch (e) {
          failed = e instanceof GmailCaptureError ? e : new GmailCaptureError("fetch_failed");
        }
      }
    }),
  );
  if (failed) throw failed;
  let parsed: ReturnType<typeof parseGmailMessages>;
  try {
    parsed = parseGmailMessages(messages, {
      tenantId,
      provider: "gmail",
      mailbox: mailbox.toLowerCase(),
    });
    if (parsed.messageRows.length !== messages.length) fail();
  } catch {
    throw new GmailCaptureError("parse_failed");
  }
  let counts = { thread_upsert_count: 0, message_upsert_count: 0 };
  try {
    if (parsed.messageRows.length)
      counts = await store.savePage(parsed.threadRows, parsed.messageRows);
    if (
      !counts ||
      !Number.isInteger(counts.thread_upsert_count) ||
      counts.thread_upsert_count < 0 ||
      counts.thread_upsert_count > parsed.threadRows.length ||
      !Number.isInteger(counts.message_upsert_count) ||
      counts.message_upsert_count < 0 ||
      counts.message_upsert_count > parsed.messageRows.length
    )
      throw Error();
  } catch {
    throw new GmailCaptureError("persistence_failed", true);
  }
  return {
    persistence: "confirmed",
    ...counts,
    ids_seen: page.ids.length,
    gone_count: gone,
    unresolved_count: 0,
  };
}
