// Marketing email — PURE helpers (no Deno APIs, no network, no DB client).
// Shared by the Gmail Marketing connector adapter, the marketing-senders Edge
// function and the node test-runner (`node --test scripts/marketing-senders-pure.test.mjs`).
//
// Everything here is deterministic and side-effect free: scope evaluation,
// EXACT frozen-envelope validation (allowlisted — undeclared fields are
// rejected), execution-time actor-authority evaluation (a pure decision over
// facts the adapter resolves from the CANONICAL SQL permission resolver —
// never an independent permission model), standards-compliant MIME
// construction from the FROZEN ENVELOPE ONLY, provider-result sanitisation
// and conservative Gmail send-result classification. The TRANSPORT
// (fetch + credentials) lives only in the Deno-side adapter; sender
// READINESS is derived only by the canonical SQL marketing_sender_readiness.

/** The ONE Gmail send scope Phase 4 introduces — nothing broader. */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** Granted-scope truth: evidence only — never inferred from account status. */
export function evaluateGmailSendScope(scope: string | null | undefined): "authorized" | "missing" {
  if (!scope) return "missing";
  return scope.split(/\s+/).includes(GMAIL_SEND_SCOPE) ? "authorized" : "missing";
}

// ── Address + header safety ──────────────────────────────────────────────────

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isPlausibleEmail(v: unknown): v is string {
  return typeof v === "string" && v.length >= 3 && v.length <= 320 && EMAIL_RE.test(v);
}

/** CR/LF (and NUL) in any header-bound value is an injection attempt — reject. */
export function hasHeaderInjection(v: string): boolean {
  return /[\r\n\0]/.test(v);
}

// ── Frozen-envelope validation (EXACT allowlist — the adapter refuses
//    anything malformed OR carrying an undeclared field) ─────────────────────

export interface SendEnvelope {
  sender_profile_id: string;
  source_kind: "gmail_oauth" | "workspace_dwd";
  mailbox_address: string;
  recipient_profile_id: string;
  recipient_email: string;
  subject: string;
  body_text: string;
  from_name: string | null;
  reply_to: string | null;
  signature_text: string | null;
  purpose: "test";
  content_version: string;
  content_hash: string;
  actor_profile_id: string;
  request_id: string;
  delivery_id: string;
}

/** The ONE declared shape of a frozen test-send envelope. Nothing else. */
export const SEND_ENVELOPE_KEYS: readonly string[] = [
  "sender_profile_id",
  "source_kind",
  "mailbox_address",
  "recipient_profile_id",
  "recipient_email",
  "subject",
  "body_text",
  "from_name",
  "reply_to",
  "signature_text",
  "purpose",
  "content_version",
  "content_hash",
  "actor_profile_id",
  "request_id",
  "delivery_id",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateSendEnvelope(
  p: Record<string, unknown>,
): { ok: true; envelope: SendEnvelope } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  // EXACT allowlist: any undeclared property (bcc, html, recipient_emails,
  // anything) rejects the envelope before any provider interaction
  for (const k of Object.keys(p)) {
    if (!SEND_ENVELOPE_KEYS.includes(k)) return bad(`undeclared envelope field ${k}`);
  }
  for (const k of SEND_ENVELOPE_KEYS) {
    if (!(k in p)) return bad(`missing envelope field ${k}`);
  }
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
  const optStr = (k: string) =>
    p[k] === null ? null : typeof p[k] === "string" ? (p[k] as string) : undefined;

  for (const k of [
    "sender_profile_id",
    "recipient_profile_id",
    "actor_profile_id",
    "delivery_id",
  ]) {
    const v = str(k);
    if (!v || !UUID_RE.test(v)) return bad(`${k} must be a uuid`);
  }
  const sourceKind = str("source_kind");
  if (sourceKind !== "gmail_oauth" && sourceKind !== "workspace_dwd") {
    return bad("source_kind must be gmail_oauth|workspace_dwd");
  }
  const mailbox = str("mailbox_address");
  if (!mailbox || !isPlausibleEmail(mailbox) || mailbox !== mailbox.toLowerCase()) {
    return bad("mailbox_address must be a lower-cased email address");
  }
  const recipient = str("recipient_email");
  if (!recipient || !isPlausibleEmail(recipient)) return bad("recipient_email invalid");
  if (hasHeaderInjection(recipient)) return bad("recipient_email contains header material");
  const subject = str("subject");
  if (!subject || subject.length < 1 || subject.length > 300) {
    return bad("subject must be 1-300 chars");
  }
  if (hasHeaderInjection(subject)) return bad("subject contains a line break");
  const body = str("body_text");
  if (!body || body.length < 1 || body.length > 10000)
    return bad("body_text must be 1-10000 chars");
  const fromName = optStr("from_name");
  if (
    fromName === undefined ||
    (fromName !== null && (fromName.length > 120 || hasHeaderInjection(fromName)))
  ) {
    return bad("from_name invalid");
  }
  const replyTo = optStr("reply_to");
  if (
    replyTo === undefined ||
    (replyTo !== null && (!isPlausibleEmail(replyTo) || hasHeaderInjection(replyTo)))
  ) {
    return bad("reply_to invalid");
  }
  const signature = optStr("signature_text");
  if (signature === undefined || (signature !== null && signature.length > 2000)) {
    return bad("signature_text invalid");
  }
  if (str("purpose") !== "test") return bad("purpose must be test");
  const contentVersion = str("content_version");
  if (!contentVersion) return bad("content_version required");
  const contentHash = str("content_hash");
  if (!contentHash || !/^[0-9a-f]{64}$/.test(contentHash)) return bad("content_hash invalid");
  const requestId = str("request_id");
  if (!requestId || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) return bad("request_id invalid");

  return {
    ok: true,
    envelope: {
      sender_profile_id: str("sender_profile_id") as string,
      source_kind: sourceKind,
      mailbox_address: mailbox,
      recipient_profile_id: str("recipient_profile_id") as string,
      recipient_email: recipient,
      subject,
      body_text: body,
      from_name: fromName,
      reply_to: replyTo,
      signature_text: signature,
      purpose: "test",
      content_version: contentVersion,
      content_hash: contentHash,
      actor_profile_id: str("actor_profile_id") as string,
      request_id: requestId,
      delivery_id: str("delivery_id") as string,
    },
  };
}

// ── Execution-time actor authority (pure DECISION; facts come from the
//    canonical SQL resolver — this is NOT an independent permission model) ──

export interface ActorAuthorityFacts {
  /** the intent's tenant */
  tenantId: string;
  /** profiles row for the frozen actor_profile_id, or null when missing */
  actor: { id: string; tenant_id: string | null } | null;
  /** marketing_effective_permissions(actor) verdict, verbatim */
  resolverVerdict: { enabled?: unknown; permissions?: unknown } | null;
}

export function evaluateActorAuthority(
  f: ActorAuthorityFacts,
): { ok: true } | { ok: false; code: string; message: string } {
  if (!f.actor) {
    return {
      ok: false,
      code: "actor_removed",
      message: "the requesting actor no longer exists",
    };
  }
  if (f.actor.tenant_id !== f.tenantId) {
    return {
      ok: false,
      code: "actor_tenant_mismatch",
      message: "the requesting actor is no longer a member of this tenant",
    };
  }
  const verdict = f.resolverVerdict;
  const permissions = Array.isArray(verdict?.permissions) ? verdict?.permissions : [];
  if (verdict?.enabled !== true || !permissions.includes("marketing.campaigns.test")) {
    return {
      ok: false,
      code: "actor_no_longer_authorised",
      message: "the requesting actor no longer holds marketing.campaigns.test",
    };
  }
  return { ok: true };
}

// ── MIME construction (standards-compliant, injection-proof, deterministic,
//    built from the FROZEN ENVELOPE ONLY — never current sender settings) ────

/** Body composition — MUST stay byte-identical to the SQL reconciler's
 *  email_messages projection (body || "\n\n--\n" || signature). */
export function composeMarketingBody(bodyText: string, signatureText: string | null): string {
  return signatureText ? `${bodyText}\n\n--\n${signatureText}` : bodyText;
}

/** atom-safe: no quoting/encoding required in a display name */
const ATOM_SAFE_RE = /^[A-Za-z0-9 !#$%&'*+\-/=?^_`{|}~.]*$/;

/**
 * RFC 2047 §2: an encoded word — INCLUDING its `=?UTF-8?B?…?=` wrapper — must
 * be at most 75 characters. The wrapper costs 12, so the base64 payload is
 * bounded at 60 chars = 45 raw bytes per word (60 is the largest multiple of
 * 4 that fits, and base64 length must be a multiple of 4).
 */
export const MAX_ENCODED_WORD_CHARS = 75;
const MAX_ENCODED_WORD_BYTES = 45;

/**
 * Split a Unicode string into RFC 2047 encoded words of ≤75 chars each.
 * Chunking iterates CODE POINTS (never UTF-16 halves) and packs whole UTF-8
 * character sequences — a multi-byte character is never split across words,
 * so every word decodes as valid UTF-8 on its own and simple concatenation
 * of the decoded words reconstructs the exact original string.
 */
export function encodeWords(v: string): string[] {
  const enc = new TextEncoder();
  const words: string[] = [];
  let chunk: number[] = [];
  for (const cp of v) {
    const bytes = enc.encode(cp);
    if (chunk.length > 0 && chunk.length + bytes.length > MAX_ENCODED_WORD_BYTES) {
      words.push(`=?UTF-8?B?${bytesToBase64(Uint8Array.from(chunk))}?=`);
      chunk = [];
    }
    for (const b of bytes) chunk.push(b);
  }
  if (chunk.length > 0 || words.length === 0) {
    words.push(`=?UTF-8?B?${bytesToBase64(Uint8Array.from(chunk))}?=`);
  }
  return words;
}

/**
 * Fold a sequence of encoded words into legal header text: words are
 * separated by CRLF + a single SPACE (folding whitespace). Per RFC 2047 §6.2
 * the whitespace between ADJACENT encoded words is not rendered, so decoding
 * yields the exact original value. Every physical continuation line is
 * `1 (space) + ≤75` chars — far under the RFC 5322 998-char hard limit.
 */
function foldEncodedWords(words: string[]): string {
  return words.join("\r\n ");
}

/**
 * Encode a From/display-name phrase safely:
 *  - plain atom-safe ASCII passes through;
 *  - printable ASCII containing specials (quotes, commas, angle brackets,
 *    backslashes, parens, colons…) becomes a QUOTED STRING with \" and \\
 *    escaping — it can never terminate the phrase or smuggle an address
 *    (bounded at 120 chars upstream, so the line stays under the hard limit);
 *  - anything non-ASCII becomes RFC 2047 encoded words, each ≤75 chars
 *    including the wrapper, folded with legal whitespace continuations.
 * CR/LF never reaches here (hasHeaderInjection is checked first).
 */
export function encodeDisplayName(v: string): string {
  if (ATOM_SAFE_RE.test(v)) return v;

  if (/^[\x20-\x7e]*$/.test(v)) {
    return `"${v.replace(/([\\"])/g, "\\$1")}"`;
  }
  return foldEncodedWords(encodeWords(v));
}

/**
 * RFC 2047 header text (Subject): short printable ASCII passes through
 * (bounded at 300 chars upstream — under the 998 hard limit); anything
 * non-ASCII becomes folded ≤75-char encoded words.
 */
function encodeHeaderText(v: string): string {
  if (/^[\x20-\x7e]*$/.test(v)) return v;
  return foldEncodedWords(encodeWords(v));
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? alphabet[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? alphabet[b2 & 63] : "=";
  }
  return out;
}

/** RFC 2045: base64 body lines must not exceed 76 characters. */
export function wrapBase64Lines(b64: string, width = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += width) lines.push(b64.slice(i, i + width));
  return lines.join("\r\n");
}

export function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface MarketingMimeInput {
  fromAddress: string;
  fromName: string | null;
  to: string;
  replyTo: string | null;
  subject: string;
  bodyText: string;
  signatureText: string | null;
  /** Deterministic per delivery — powers a stable RFC Message-ID. */
  deliveryId: string;
}

export interface MarketingMime {
  /** base64url-encoded RFC 5322 message, ready for Gmail messages.send `raw`. */
  raw: string;
  /** The deterministic Message-ID header value (with angle brackets). */
  messageId: string;
  /** The exact composed text body (content of record). */
  composedBody: string;
  /** The decoded RFC 5322 message (headers + wrapped base64 body), for tests. */
  message: string;
}

/**
 * Build a standards-compliant text/plain MIME message FROM THE FROZEN
 * ENVELOPE VALUES ONLY. Throws on any header injection or implausible
 * address — the adapter treats that as a PERMANENT refusal, never something
 * to "fix up".
 */
export function buildMarketingMime(i: MarketingMimeInput): MarketingMime {
  for (const [k, v] of Object.entries({
    fromAddress: i.fromAddress,
    to: i.to,
    subject: i.subject,
    ...(i.fromName ? { fromName: i.fromName } : {}),
    ...(i.replyTo ? { replyTo: i.replyTo } : {}),
  })) {
    if (typeof v === "string" && hasHeaderInjection(v)) {
      throw new Error(`header injection rejected in ${k}`);
    }
  }
  if (!isPlausibleEmail(i.fromAddress)) throw new Error("from address implausible");
  if (!isPlausibleEmail(i.to)) throw new Error("recipient address implausible");
  if (i.replyTo && !isPlausibleEmail(i.replyTo)) throw new Error("reply-to address implausible");
  if (!UUID_RE.test(i.deliveryId)) throw new Error("delivery id required for Message-ID");

  const domain = i.fromAddress.split("@")[1];
  const messageId = `<mkt-${i.deliveryId}@${domain}>`;
  const from = i.fromName ? `${encodeDisplayName(i.fromName)} <${i.fromAddress}>` : i.fromAddress;
  const composedBody = composeMarketingBody(i.bodyText, i.signatureText);

  const message = [
    `From: ${from}`,
    `To: ${i.to}`,
    ...(i.replyTo ? [`Reply-To: ${i.replyTo}`] : []),
    `Subject: ${encodeHeaderText(i.subject)}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64Lines(bytesToBase64(new TextEncoder().encode(composedBody))),
  ].join("\r\n");
  const raw = toBase64Url(new TextEncoder().encode(message));
  return { raw, messageId, composedBody, message };
}

// ── Provider result handling (sanitized; honest classification) ─────────────

export interface SanitizedGmailSend {
  messageId: string;
  threadId: string | null;
}

/** Allowlist projection of the Gmail messages.send response — nothing else. */
export function sanitizeGmailSendResponse(body: unknown): SanitizedGmailSend | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const r = body as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  return {
    messageId: r.id,
    threadId: typeof r.threadId === "string" && r.threadId.length > 0 ? r.threadId : null,
  };
}

export interface GmailSendClassification {
  kind: "transient" | "permanent" | "unknown";
  code: string;
  needsReconsent: boolean;
}

/**
 * Classify a NON-2xx Gmail messages.send outcome, conservatively:
 *  - 401 / 403-insufficient-scope → PERMANENT, actionable re-consent;
 *  - other 4xx → PERMANENT (the request itself is wrong; a retry cannot fix it);
 *  - 429 → TRANSIENT (Google rejected the request — proof of non-submission —
 *    so a bounded retry cannot duplicate);
 *  - 5xx → UNKNOWN. Gmail gives no idempotency key and a 500 does NOT prove
 *    the message was not submitted, so an automatic retry could double-send.
 *    Unknown freezes for reconciliation/human review — never a blind resend.
 */
export function classifyGmailSendFailure(
  status: number,
  bodyText: string,
): GmailSendClassification {
  const lower = (bodyText || "").toLowerCase();
  if (status === 401) {
    return { kind: "permanent", code: "gmail_auth_expired", needsReconsent: true };
  }
  if (status === 403) {
    if (lower.includes("scope") || lower.includes("insufficient")) {
      return { kind: "permanent", code: "gmail_send_scope_missing", needsReconsent: true };
    }
    return { kind: "permanent", code: "gmail_forbidden", needsReconsent: false };
  }
  if (status === 429) {
    return { kind: "transient", code: "gmail_rate_limited", needsReconsent: false };
  }
  if (status >= 400 && status < 500) {
    return { kind: "permanent", code: `gmail_rejected_${status}`, needsReconsent: false };
  }
  return { kind: "unknown", code: `gmail_result_unknown_${status}`, needsReconsent: false };
}
