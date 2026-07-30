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

// ── Broadcast envelope (Phase 5) — its OWN exact allowlist. A test envelope
//    can never smuggle broadcast fields (its allowlist rejects them) and a
//    broadcast envelope can never omit its campaign/snapshot/approval/
//    unsubscribe lineage. The discriminator is `purpose`. ────────────────────

export interface BroadcastSendEnvelope {
  sender_profile_id: string;
  source_kind: "gmail_oauth" | "workspace_dwd";
  mailbox_address: string;
  recipient_profile_id: null;
  recipient_email: string;
  subject: string;
  body_text: string;
  body_html: string;
  preview_text: string | null;
  from_name: string | null;
  reply_to: string | null;
  signature_text: string | null;
  purpose: "broadcast";
  content_version: string;
  content_hash: string;
  actor_profile_id: string;
  request_id: string;
  delivery_id: string;
  campaign_id: string;
  campaign_revision_id: string;
  campaign_approval_id: string;
  revision_hash: string;
  audience_snapshot_id: string;
  audience_member_id: string;
  dispatch_id: string;
  dispatch_generation: number;
  person_id: string;
  contact_point_id: string;
  unsubscribe_token_id: string;
  unsubscribe_url: string;
}

/** The ONE declared shape of a frozen broadcast envelope. Nothing else. */
export const BROADCAST_ENVELOPE_KEYS: readonly string[] = [
  "sender_profile_id",
  "source_kind",
  "mailbox_address",
  "recipient_profile_id",
  "recipient_email",
  "subject",
  "body_text",
  "body_html",
  "preview_text",
  "from_name",
  "reply_to",
  "signature_text",
  "purpose",
  "content_version",
  "content_hash",
  "actor_profile_id",
  "request_id",
  "delivery_id",
  "campaign_id",
  "campaign_revision_id",
  "campaign_approval_id",
  "revision_hash",
  "audience_snapshot_id",
  "audience_member_id",
  "dispatch_id",
  "dispatch_generation",
  "person_id",
  "contact_point_id",
  "unsubscribe_token_id",
  "unsubscribe_url",
];

export function validateBroadcastEnvelope(
  p: Record<string, unknown>,
): { ok: true; envelope: BroadcastSendEnvelope } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  for (const k of Object.keys(p)) {
    if (!BROADCAST_ENVELOPE_KEYS.includes(k)) return bad(`undeclared envelope field ${k}`);
  }
  for (const k of BROADCAST_ENVELOPE_KEYS) {
    if (!(k in p)) return bad(`missing envelope field ${k}`);
  }
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
  const optStr = (k: string) =>
    p[k] === null ? null : typeof p[k] === "string" ? (p[k] as string) : undefined;

  if (p.recipient_profile_id !== null) {
    return bad("a broadcast envelope addresses a Person — recipient_profile_id must be null");
  }
  for (const k of [
    "sender_profile_id",
    "actor_profile_id",
    "delivery_id",
    "campaign_id",
    "campaign_revision_id",
    "campaign_approval_id",
    "audience_snapshot_id",
    "audience_member_id",
    "dispatch_id",
    "person_id",
    "contact_point_id",
    "unsubscribe_token_id",
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
  if (!body || body.length < 1 || body.length > 30000) {
    return bad("body_text must be 1-30000 chars");
  }
  const html = str("body_html");
  if (!html || html.length < 1 || html.length > 100000) {
    return bad("body_html must be 1-100000 chars");
  }
  const preview = optStr("preview_text");
  if (preview === undefined || (preview !== null && preview.length > 150)) {
    return bad("preview_text invalid");
  }
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
  if (str("purpose") !== "broadcast") return bad("purpose must be broadcast");
  const contentVersion = str("content_version");
  if (!contentVersion) return bad("content_version required");
  const contentHash = str("content_hash");
  if (!contentHash || !/^[0-9a-f]{64}$/.test(contentHash)) return bad("content_hash invalid");
  const revisionHash = str("revision_hash");
  if (!revisionHash || !/^[0-9a-f]{64}$/.test(revisionHash)) return bad("revision_hash invalid");
  const requestId = str("request_id");
  if (!requestId || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) return bad("request_id invalid");
  const gen = p.dispatch_generation;
  if (typeof gen !== "number" || !Number.isInteger(gen) || gen < 1) {
    return bad("dispatch_generation must be a positive integer");
  }
  const unsubUrl = str("unsubscribe_url");
  if (!unsubUrl || !/^https?:\/\/[^\s<>]+$/.test(unsubUrl) || hasHeaderInjection(unsubUrl)) {
    return bad("unsubscribe_url invalid");
  }
  if (!body.includes(unsubUrl) || !html.includes(unsubUrl)) {
    return bad("the visible unsubscribe link must appear in both bodies");
  }

  return {
    ok: true,
    envelope: {
      sender_profile_id: str("sender_profile_id") as string,
      source_kind: sourceKind,
      mailbox_address: mailbox,
      recipient_profile_id: null,
      recipient_email: recipient,
      subject,
      body_text: body,
      body_html: html,
      preview_text: preview,
      from_name: fromName,
      reply_to: replyTo,
      signature_text: signature,
      purpose: "broadcast",
      content_version: contentVersion,
      content_hash: contentHash,
      actor_profile_id: str("actor_profile_id") as string,
      request_id: requestId,
      delivery_id: str("delivery_id") as string,
      campaign_id: str("campaign_id") as string,
      campaign_revision_id: str("campaign_revision_id") as string,
      campaign_approval_id: str("campaign_approval_id") as string,
      revision_hash: revisionHash,
      audience_snapshot_id: str("audience_snapshot_id") as string,
      audience_member_id: str("audience_member_id") as string,
      dispatch_id: str("dispatch_id") as string,
      dispatch_generation: gen,
      person_id: str("person_id") as string,
      contact_point_id: str("contact_point_id") as string,
      unsubscribe_token_id: str("unsubscribe_token_id") as string,
      unsubscribe_url: unsubUrl,
    },
  };
}

/** Discriminated dispatcher: the envelope's own declared purpose routes to
 *  its exact validator — the two allowlists are disjoint supersets, so a test
 *  envelope carrying any broadcast field (or vice versa) is refused. */
export function validateMarketingEnvelope(
  p: Record<string, unknown>,
): { ok: true; envelope: SendEnvelope | BroadcastSendEnvelope } | { ok: false; error: string } {
  if (!p || typeof p !== "object") return { ok: false, error: "parameters missing" };
  if (p.purpose === "broadcast") return validateBroadcastEnvelope(p);
  return validateSendEnvelope(p);
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
  requiredPermission: string = "marketing.campaigns.test",
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
  if (verdict?.enabled !== true || !permissions.includes(requiredPermission)) {
    return {
      ok: false,
      code: "actor_no_longer_authorised",
      message: `the requesting actor no longer holds ${requiredPermission}`,
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

// ── Personalisation (Phase 5) — a deliberately SMALL allowlist. No property
//    paths, no expressions, no raw HTML. Tokens render ONLY from the frozen
//    member context + the approved revision's explicit fallbacks. ────────────

export const PERSONALISATION_TOKENS = [
  "first_name",
  "last_name",
  "display_name",
  "company_name",
] as const;
export type PersonalisationToken = (typeof PERSONALISATION_TOKENS)[number];

const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Extract the tokens used by an authored value; throws on unknown tokens or
 *  malformed braces (mirrors the SQL revision validator). */
export function parsePersonalisationTokens(v: string): PersonalisationToken[] {
  const seen = new Set<PersonalisationToken>();
  for (const m of v.matchAll(TOKEN_RE)) {
    const t = m[1] as PersonalisationToken;
    if (!PERSONALISATION_TOKENS.includes(t)) {
      throw new Error(`unknown personalisation token {{${m[1]}}}`);
    }
    seen.add(t);
  }
  const stripped = v.replace(TOKEN_RE, "");
  if (stripped.includes("{{") || stripped.includes("}}")) {
    throw new Error("malformed personalisation braces");
  }
  return [...seen];
}

export interface PersonalisationContext {
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  company_name?: string | null;
}

/** Substitute tokens from the FROZEN context, falling back to the approved
 *  revision's explicit fallbacks. Throws when a used token has neither — a
 *  member like that must have been excluded at preflight; rendering never
 *  invents a value and never reads current mutable Person data. Substituted
 *  values are control-character-stripped and bounded. */
export function renderPersonalised(
  v: string,
  ctx: PersonalisationContext,
  fallbacks: Record<string, string>,
): string {
  return v.replace(TOKEN_RE, (_, raw: string) => {
    const t = raw as PersonalisationToken;
    if (!PERSONALISATION_TOKENS.includes(t)) throw new Error(`unknown token {{${raw}}}`);
    const fromCtx = ctx[t];
    const value =
      typeof fromCtx === "string" && fromCtx.length > 0
        ? fromCtx
        : typeof fallbacks[t] === "string"
          ? fallbacks[t]
          : null;
    if (value === null) throw new Error(`missing personalisation value for {{${raw}}}`);
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 200);
  });
}

// ── Broadcast rendering (Phase 5) — ONE safe authored model:
//    plain text + {{token}} + [label](https://url). Deterministic plain-text
//    and escaped-HTML derivations; never arbitrary HTML in, never unescaped
//    values out. ───────────────────────────────────────────────────────────

const LINK_RE = /\[([^\][]{1,200})\]\((https?:\/\/[^\s()<>]+)\)/g;

export function escapeHtml(v: string): string {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface BroadcastRenderInput {
  subject: string;
  previewText: string | null;
  bodyAuthored: string;
  context: PersonalisationContext;
  fallbacks: Record<string, string>;
  signatureText: string | null;
  /** Company/footer identification lines (already plain text). */
  footerLines: string[];
  unsubscribeUrl: string;
}

export interface BroadcastRendered {
  subject: string;
  text: string;
  html: string;
  previewText: string | null;
}

type AuthoredSegment =
  { kind: "text"; value: string } | { kind: "link"; label: string; url: string };

/** Split the APPROVED authored body into plain-text runs and validated links.
 *  Links are extracted from the authored revision BEFORE any personalisation,
 *  so the set of destinations a recipient can be sent to is exactly the set the
 *  approver saw. Personalised values are substituted into the runs and labels
 *  afterwards and are never re-scanned for markup, so contact data (an imported
 *  display name, a company name) can never introduce a link of its own. */
function splitAuthoredLinks(authored: string): AuthoredSegment[] {
  const segments: AuthoredSegment[] = [];
  let cursor = 0;
  for (const m of authored.matchAll(LINK_RE)) {
    const at = m.index ?? 0;
    if (at > cursor) segments.push({ kind: "text", value: authored.slice(cursor, at) });
    segments.push({ kind: "link", label: m[1], url: m[2] });
    cursor = at + m[0].length;
  }
  if (cursor < authored.length) segments.push({ kind: "text", value: authored.slice(cursor) });
  return segments;
}

/** Deterministic dual rendering from the frozen inputs only. The visible
 *  unsubscribe link appears in BOTH bodies (the SQL lineage guard verifies
 *  this again server-side). */
export function renderBroadcast(i: BroadcastRenderInput): BroadcastRendered {
  const subject = renderPersonalised(i.subject, i.context, i.fallbacks);
  if (/[\r\n\0]/.test(subject)) throw new Error("rendered subject contains header material");
  const preview = i.previewText ? renderPersonalised(i.previewText, i.context, i.fallbacks) : null;
  const personalise = (v: string) => renderPersonalised(v, i.context, i.fallbacks);
  const segments = splitAuthoredLinks(i.bodyAuthored);

  const textBody = segments
    .map((s) => (s.kind === "link" ? `${personalise(s.label)} (${s.url})` : personalise(s.value)))
    .join("");
  const textParts = [textBody];
  if (i.signatureText) textParts.push(`--\n${i.signatureText}`);
  textParts.push([...i.footerLines, `Unsubscribe: ${i.unsubscribeUrl}`].join("\n"));
  const text = textParts.join("\n\n");

  // HTML: every value — run, label and href alike — is escaped, and only the
  // authored hrefs ever become anchors.
  const htmlBody = segments
    .map((s) =>
      s.kind === "link"
        ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(
            personalise(s.label),
          )}</a>`
        : escapeHtml(personalise(s.value)).replaceAll("\n", "<br/>\n"),
    )
    .join("");
  const htmlSig = i.signatureText
    ? `<p style="margin-top:16px">--<br/>\n${escapeHtml(i.signatureText).replaceAll("\n", "<br/>\n")}</p>`
    : "";
  const htmlFooter =
    `<p style="margin-top:24px;font-size:12px;color:#667085">` +
    i.footerLines.map((l) => escapeHtml(l)).join("<br/>\n") +
    (i.footerLines.length ? "<br/>\n" : "") +
    `<a href="${escapeHtml(i.unsubscribeUrl)}">Unsubscribe</a></p>`;
  const preheader = preview
    ? `<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(preview)}</span>`
    : "";
  const html =
    `${preheader}<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;` +
    `line-height:1.6;color:#101828">${htmlBody}${htmlSig}${htmlFooter}</div>`;

  return { subject, text, html, previewText: preview };
}

// ── Multipart MIME (Phase 5) — deterministic standards-compliant
//    multipart/alternative with one-click unsubscribe headers. All Phase-4
//    header hardening (encoded-word folding, quoted display names, injection
//    rejection, bounded base64 lines) is reused, never reimplemented. ───────

export interface BroadcastMimeInput {
  fromAddress: string;
  fromName: string | null;
  to: string;
  replyTo: string | null;
  subject: string;
  textBody: string;
  htmlBody: string;
  unsubscribeUrl: string;
  /** Deterministic per delivery — powers Message-ID and the part boundary. */
  deliveryId: string;
}

export interface BroadcastMime {
  raw: string;
  messageId: string;
  message: string;
}

const UUID_RE_LOCAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildBroadcastMime(i: BroadcastMimeInput): BroadcastMime {
  for (const [k, v] of Object.entries({
    fromAddress: i.fromAddress,
    to: i.to,
    subject: i.subject,
    unsubscribeUrl: i.unsubscribeUrl,
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
  if (!UUID_RE_LOCAL.test(i.deliveryId)) throw new Error("delivery id required for Message-ID");
  if (!/^https?:\/\/[^\s<>]+$/.test(i.unsubscribeUrl)) {
    throw new Error("unsubscribe url implausible");
  }

  const domain = i.fromAddress.split("@")[1];
  const messageId = `<mkt-${i.deliveryId}@${domain}>`;
  const boundary = `=_mkt_${i.deliveryId.replaceAll("-", "")}`;
  const from = i.fromName ? `${encodeDisplayName(i.fromName)} <${i.fromAddress}>` : i.fromAddress;
  const enc = new TextEncoder();

  const message = [
    `From: ${from}`,
    `To: ${i.to}`,
    ...(i.replyTo ? [`Reply-To: ${i.replyTo}`] : []),
    `Subject: ${encodeHeaderText(i.subject)}`,
    `Message-ID: ${messageId}`,
    `List-Unsubscribe: <${i.unsubscribeUrl}>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    "This is a multi-part message in MIME format.",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64Lines(bytesToBase64(enc.encode(i.textBody))),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64Lines(bytesToBase64(enc.encode(i.htmlBody))),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const raw = toBase64Url(enc.encode(message));
  return { raw, messageId, message };
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
