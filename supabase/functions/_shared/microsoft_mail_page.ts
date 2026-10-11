import {
  fail,
  object,
  uuid,
  id,
  graphUrl,
  readMicrosoftGraphJson,
} from "./microsoft_graph_transport.ts";
export { MicrosoftMailError, type MicrosoftMailErrorCode } from "./microsoft_graph_transport.ts";
/** Microsoft Graph v1.0 mail delta transport. No database writes or cursor advances.
 * Track each real folder separately; continuations are opaque, mailbox-bound URLs.
 * https://learn.microsoft.com/en-us/graph/delta-query-messages
 * https://learn.microsoft.com/en-us/graph/outlook-immutable-id
 */
export type MicrosoftMailScope = {
  tenantId: string;
  accountId: string;
  /** Microsoft directory object ID, resolved by the authorized connector. */
  mailboxId: string;
  /** Actual folder ID, not a well-known alias such as inbox. */
  folderId: string;
};
export type MicrosoftMailRequest = MicrosoftMailScope & {
  continuation: null | { kind: "next" | "delta"; url: string };
  pageSize: number;
};
export type MicrosoftMailEvent =
  | { kind: "removed_from_folder"; id: string; reason: "deleted"; raw: Record<string, unknown> }
  | { kind: "observed"; id: string; fields: Record<string, unknown>; raw: Record<string, unknown> };
export type MicrosoftMailPage = {
  contract: "microsoft-mail-page/1";
  scope: MicrosoftMailScope;
  requestUrl: string;
  events: MicrosoftMailEvent[];
  continuation: { kind: "next" | "delta"; url: string };
  /** Transport completion for this folder round; not persisted mailbox coverage. */
  folderRoundComplete: boolean;
  fetchedAt: string;
  persistence: "not_attempted";
  attachmentsCaptured: false;
};
export const MICROSOFT_MAIL_FIELDS = [
  "id",
  "changeKey",
  "parentFolderId",
  "conversationId",
  "internetMessageId",
  "subject",
  "body",
  "bodyPreview",
  "from",
  "sender",
  "replyTo",
  "toRecipients",
  "ccRecipients",
  "bccRecipients",
  "receivedDateTime",
  "sentDateTime",
  "createdDateTime",
  "lastModifiedDateTime",
  "isDraft",
  "isRead",
  "hasAttachments",
  "internetMessageHeaders",
  "categories",
  "importance",
] as const;
function scope(s: MicrosoftMailScope): MicrosoftMailScope {
  if (!s || ![s.tenantId, s.accountId, s.mailboxId].every(uuid) || !id(s.folderId))
    fail("invalid_scope");
  return {
    tenantId: s.tenantId,
    accountId: s.accountId,
    mailboxId: s.mailboxId,
    folderId: s.folderId,
  };
}
/** Accept slash and OData parenthesized address forms Microsoft returns, but
 * never forward a credential to a different host, user, folder or resource. */
export function validateMicrosoftMailContinuation(
  s: MicrosoftMailScope,
  continuation: { kind: "next" | "delta"; url: string },
): string {
  scope(s);
  if (
    !continuation ||
    !["next", "delta"].includes(continuation.kind) ||
    typeof continuation.url !== "string" ||
    continuation.url.length > 32768 ||
    /[\s\\\u0000-\u001f]/.test(continuation.url)
  )
    fail("invalid_continuation");
  const u = graphUrl(continuation.url);
  // Resource names are case insensitive; IDs are not. Match resource syntax
  // before decoding IDs so an encoded slash remains part of one identifier.
  const match = u.pathname.match(
    /^\/v1\.0\/(?:users\/([^/]+)|users\('([^'/]+)'\))\/(?:mailfolders\/([^/]+)|mailfolders\('([^'/]+)'\))\/messages\/(?:microsoft\.graph\.)?delta$/i,
  );
  if (!match) fail("invalid_continuation");
  try {
    if (
      decodeURIComponent(match[1] ?? match[2]) !== s.mailboxId ||
      decodeURIComponent(match[4] ?? match[3]) !== s.folderId
    )
      fail("invalid_continuation");
  } catch {
    return fail("invalid_continuation");
  }
  const tokenName = continuation.kind === "next" ? "$skiptoken" : "$deltatoken";
  const otherName = continuation.kind === "next" ? "$deltatoken" : "$skiptoken";
  const token = u.searchParams.getAll(tokenName);
  if (token.length !== 1 || !token[0] || u.searchParams.has(otherName))
    fail("invalid_continuation");
  // Microsoft encodes the original options in the opaque token. Extra server
  // options are passed through unchanged; this function never reconstructs it.
  return continuation.url;
}
export function microsoftMailRequestUrl(r: MicrosoftMailRequest): string {
  const s = scope(r);
  if (!Number.isSafeInteger(r.pageSize) || r.pageSize < 1 || r.pageSize > 100)
    fail("invalid_scope");
  if (r.continuation !== null) return validateMicrosoftMailContinuation(s, r.continuation);
  const params = new URLSearchParams({ $select: MICROSOFT_MAIL_FIELDS.join(",") });
  return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(s.mailboxId)}/mailFolders/${encodeURIComponent(s.folderId)}/messages/delta?${params}`;
}
function text(v: unknown, max: number, nullable = true): boolean {
  return (nullable && v === null) || (typeof v === "string" && v.length <= max);
}
function timestamp(v: unknown): boolean {
  if (v === null) return true;
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    return false;
  // Reject Date.parse's calendar rollover, retaining provider fractional precision.
  return new Date(Date.parse(v)).toISOString().slice(0, 19) === v.slice(0, 19);
}
function recipient(v: unknown): boolean {
  return (
    v === null ||
    (object(v) &&
      object(v.emailAddress) &&
      text(v.emailAddress.address, 2048) &&
      (v.emailAddress.name === undefined || text(v.emailAddress.name, 2048)))
  );
}
function parseEvent(raw: unknown): MicrosoftMailEvent {
  if (!object(raw) || !id(raw.id)) return fail();
  if (Object.hasOwn(raw, "@removed")) {
    if (!object(raw["@removed"]) || raw["@removed"].reason !== "deleted") return fail();
    return { kind: "removed_from_folder", id: raw.id, reason: "deleted", raw };
  }
  const fields: Record<string, unknown> = {};
  for (const key of MICROSOFT_MAIL_FIELDS) {
    if (key === "id" || !Object.hasOwn(raw, key)) continue; // Sparse patches must not erase prior fields.
    const value = raw[key];
    let valid: boolean;
    if (["changeKey", "parentFolderId", "conversationId"].includes(key))
      valid = value === null || id(value);
    else if (key.endsWith("DateTime")) valid = timestamp(value);
    else if (["isDraft", "isRead", "hasAttachments"].includes(key))
      valid = typeof value === "boolean";
    else if (["from", "sender"].includes(key)) valid = recipient(value);
    else if (["replyTo", "toRecipients", "ccRecipients", "bccRecipients"].includes(key))
      valid = Array.isArray(value) && value.length <= 2000 && value.every(recipient);
    else if (key === "body")
      valid =
        value === null ||
        (object(value) &&
          ["text", "html"].includes(value.contentType) &&
          text(value.content, 16 * 1024 * 1024, false));
    else if (key === "internetMessageHeaders")
      valid =
        Array.isArray(value) &&
        value.length <= 2000 &&
        value.every(
          (h: unknown) => object(h) && text(h.name, 1024, false) && text(h.value, 65536, false),
        );
    else if (key === "categories")
      valid =
        Array.isArray(value) &&
        value.length <= 1000 &&
        value.every((v: unknown) => text(v, 2048, false));
    else if (key === "importance") valid = ["low", "normal", "high"].includes(value);
    else valid = text(value, 65536);
    if (!valid) return fail();
    fields[key] = value;
  }
  return { kind: "observed", id: raw.id, fields, raw };
}
export async function readMicrosoftMailPage(
  accessToken: string,
  request: MicrosoftMailRequest,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<MicrosoftMailPage> {
  const url = microsoftMailRequestUrl(request),
    bound = scope(request);
  const { body, fetchedAt } = await readMicrosoftGraphJson(
    accessToken,
    url,
    request.pageSize,
    fetcher,
    now,
  );
  if (!object(body) || !Array.isArray(body.value) || body.value.length > 1000) fail();
  const next = Object.hasOwn(body, "@odata.nextLink"),
    delta = Object.hasOwn(body, "@odata.deltaLink");
  if (next === delta) fail();
  const continuation = {
    kind: next ? ("next" as const) : ("delta" as const),
    url: body[next ? "@odata.nextLink" : "@odata.deltaLink"],
  };
  validateMicrosoftMailContinuation(bound, continuation);
  // A stable delta URL on an empty new round is valid. An unchanged next URL is not progress.
  if (next && continuation.url === url) fail("pagination_no_progress");
  const events = body.value.map(parseEvent);
  return {
    contract: "microsoft-mail-page/1",
    scope: bound,
    requestUrl: url,
    events,
    continuation,
    folderRoundComplete: delta,
    fetchedAt,
    persistence: "not_attempted",
    attachmentsCaptured: false,
  };
}
