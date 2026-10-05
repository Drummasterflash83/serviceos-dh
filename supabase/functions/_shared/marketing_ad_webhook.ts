// Marketing Ads — the SIGNED-WEBHOOK boundary (pure module: no database, no
// network, no clock of its own — `nowMs` is injected so verification is
// deterministic and testable).
//
// This is the provider-neutral ServiceOS lead-capture webhook contract. It is
// honestly labelled a SIGNED WEBHOOK — it is not, and never claims to be, a
// direct Meta / Google Ads / LinkedIn integration.
//
// Contract:
//   POST /marketing-ad-webhook/{public_key}
//   headers:
//     x-serviceos-timestamp: unix seconds
//     x-serviceos-signature: hex( HMAC-SHA256(secret, timestamp + "." + raw_body) )
//   body: the strict versioned JSON payload below (raw bytes are what is
//   signed — the signature is verified BEFORE any JSON parsing).
//
// Security posture: per-source secret from the tenant Vault broker only;
// ±300s freshness window; constant-time comparison; body-size and
// content-type limits; strict key allowlists at every level; unknown keys
// refuse; no secret, signature or tenant identity ever appears in a response
// or log. A form submission is evidence of an inbound lead — NEVER
// bulk-marketing consent, and no subscription is ever invented from it.

export const ADS_WEBHOOK_SCHEMA_VERSION = "ads-lead@1";
export const ADS_WEBHOOK_MAX_BODY_BYTES = 65536;
export const ADS_WEBHOOK_FRESHNESS_SECONDS = 300;
// A rotated-away secret is honoured for exactly this long after rotation, then
// retired — never valid indefinitely. Enforced against the source's recorded
// credential_rotated_at, so rotation has a definite, bounded overlap.
export const ADS_WEBHOOK_ROTATION_OVERLAP_SECONDS = 86400;

const PUBLIC_KEY_RE = /^[0-9a-f]{48}$/;
const EVENT_ID_RE = /^[A-Za-z0-9._:-]{1,120}$/;
const SIGNATURE_RE = /^[0-9a-f]{64}$/;

const encoder = new TextEncoder();

/** hex encoding of a byte buffer */
function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** constant-time comparison over equal-length strings (XOR accumulate) */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** HMAC-SHA256(secret, `${timestamp}.${rawBody}`) as lowercase hex */
export async function computeAdsWebhookSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`));
  return toHex(mac);
}

export async function sha256Hex(raw: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(raw)));
}

export function isValidPublicKey(v: unknown): v is string {
  return typeof v === "string" && PUBLIC_KEY_RE.test(v);
}

/** Byte length (UTF-8) of the raw body — NOT the UTF-16 code-unit `.length`, so
 *  a multibyte body cannot smuggle up to ~3x the byte ceiling past the limit. */
export function adsWebhookBodyByteLength(raw: string): number {
  return encoder.encode(raw).length;
}

export type SignatureVerdict =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing_timestamp"
        | "malformed_timestamp"
        | "stale_timestamp"
        | "future_timestamp"
        | "missing_signature"
        | "malformed_signature"
        | "signature_mismatch";
    };

/**
 * Verify the signed request. `secrets` carries the CURRENT signing secret and
 * (during rotation) the PREVIOUS one. The previous secret is honoured ONLY
 * while `previousValidUntilMs` is in the future — a bounded, enforceable
 * retirement window (the caller derives it from the source's recorded
 * credential_rotated_at + ADS_WEBHOOK_ROTATION_OVERLAP_SECONDS). A rotated-away
 * secret therefore stops verifying on a definite schedule; it is never valid
 * indefinitely. When the marker is null/absent the previous secret is NOT tried
 * (there is no live overlap). Comparison is constant-time; the raw body bytes
 * are exactly what was received, BEFORE any JSON parsing.
 */
export async function verifyAdsWebhookSignature(input: {
  secrets: { current: string; previous?: string | null; previousValidUntilMs?: number | null };
  timestampHeader: string | null;
  signatureHeader: string | null;
  rawBody: string;
  nowMs: number;
}): Promise<SignatureVerdict> {
  const ts = input.timestampHeader?.trim() ?? "";
  if (ts.length === 0) return { ok: false, reason: "missing_timestamp" };
  if (!/^[0-9]{1,12}$/.test(ts)) return { ok: false, reason: "malformed_timestamp" };
  const tsSec = Number(ts);
  const nowSec = Math.floor(input.nowMs / 1000);
  if (tsSec < nowSec - ADS_WEBHOOK_FRESHNESS_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }
  if (tsSec > nowSec + ADS_WEBHOOK_FRESHNESS_SECONDS) {
    return { ok: false, reason: "future_timestamp" };
  }
  const sig = input.signatureHeader?.trim().toLowerCase() ?? "";
  if (sig.length === 0) return { ok: false, reason: "missing_signature" };
  if (!SIGNATURE_RE.test(sig)) return { ok: false, reason: "malformed_signature" };
  const expected = await computeAdsWebhookSignature(input.secrets.current, ts, input.rawBody);
  if (constantTimeEqual(sig, expected)) return { ok: true };
  const previousLive =
    typeof input.secrets.previousValidUntilMs === "number" &&
    input.nowMs < input.secrets.previousValidUntilMs;
  if (previousLive && input.secrets.previous && input.secrets.previous.length > 0) {
    const prev = await computeAdsWebhookSignature(input.secrets.previous, ts, input.rawBody);
    if (constantTimeEqual(sig, prev)) return { ok: true };
  }
  return { ok: false, reason: "signature_mismatch" };
}

/** The strict, versioned lead payload. Unknown keys at ANY level refuse. */
export interface AdsLeadPayload {
  schema_version: string;
  event_id: string;
  occurred_at: string;
  campaign_ref: string | null;
  ad_ref: string | null;
  form_ref: string | null;
  lead: {
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
  };
  meta: Record<string, string>;
  external_ref: string | null;
  consent: { basis: string; text: string | null; captured_at: string | null } | null;
}

export type PayloadResult =
  { ok: true; payload: AdsLeadPayload } | { ok: false; code: string; message: string };

const TOP_KEYS = new Set([
  "schema_version",
  "event_id",
  "occurred_at",
  "campaign_ref",
  "ad_ref",
  "form_ref",
  "lead",
  "meta",
  "external_ref",
  "consent",
]);
const LEAD_KEYS = new Set(["first_name", "last_name", "full_name", "email", "phone", "company"]);
const META_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "landing_url",
]);
const CONSENT_KEYS = new Set(["basis", "text", "captured_at"]);

function boundedString(
  v: unknown,
  max: number,
): { ok: true; value: string | null } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false };
  const t = v.trim();
  if (t.length === 0) return { ok: true, value: null };
  // eslint-disable-next-line no-control-regex
  if (t.length > max || /[\x00-\x1f\x7f]/.test(t)) return { ok: false };
  return { ok: true, value: t };
}

/** Parse + validate the raw body into the strict canonical payload. */
export function parseAdsLeadPayload(rawBody: string): PayloadResult {
  const bad = (code: string, message: string): PayloadResult => ({ ok: false, code, message });
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return bad("invalid_json", "body must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return bad("invalid_shape", "body must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (!TOP_KEYS.has(k)) return bad("unknown_key", `unknown key '${k}'`);
  }
  if (obj.schema_version !== ADS_WEBHOOK_SCHEMA_VERSION) {
    return bad("unsupported_schema", `schema_version must be ${ADS_WEBHOOK_SCHEMA_VERSION}`);
  }
  if (typeof obj.event_id !== "string" || !EVENT_ID_RE.test(obj.event_id)) {
    return bad("invalid_event_id", "event_id must match ^[A-Za-z0-9._:-]{1,120}$");
  }
  if (typeof obj.occurred_at !== "string" || Number.isNaN(Date.parse(obj.occurred_at))) {
    return bad("invalid_occurred_at", "occurred_at must be an ISO-8601 timestamp");
  }
  const refs: Record<string, string | null> = {};
  for (const k of ["campaign_ref", "ad_ref", "form_ref", "external_ref"]) {
    const r = boundedString(obj[k], 200);
    if (!r.ok) return bad("invalid_ref", `${k} must be a short clean string`);
    refs[k] = r.value;
  }
  if (!obj.lead || typeof obj.lead !== "object" || Array.isArray(obj.lead)) {
    return bad("invalid_lead", "lead must be an object");
  }
  const leadIn = obj.lead as Record<string, unknown>;
  for (const k of Object.keys(leadIn)) {
    if (!LEAD_KEYS.has(k)) return bad("unknown_key", `unknown lead key '${k}'`);
  }
  const lead: AdsLeadPayload["lead"] = {
    first_name: null,
    last_name: null,
    full_name: null,
    email: null,
    phone: null,
    company: null,
  };
  for (const k of LEAD_KEYS) {
    const r = boundedString(leadIn[k], k === "email" ? 254 : 200);
    if (!r.ok) return bad("invalid_lead_field", `lead.${k} must be a short clean string`);
    lead[k as keyof AdsLeadPayload["lead"]] = r.value;
  }
  if (!lead.email && !lead.phone && !lead.full_name && !(lead.first_name || lead.last_name)) {
    return bad("empty_lead", "a lead needs at least an email, phone or name");
  }
  const meta: Record<string, string> = {};
  if (obj.meta !== undefined && obj.meta !== null) {
    if (typeof obj.meta !== "object" || Array.isArray(obj.meta)) {
      return bad("invalid_meta", "meta must be an object");
    }
    for (const [k, v] of Object.entries(obj.meta as Record<string, unknown>)) {
      if (!META_KEYS.has(k)) return bad("unknown_key", `unknown meta key '${k}'`);
      const r = boundedString(v, 500);
      if (!r.ok || r.value === null) return bad("invalid_meta", `meta.${k} must be a clean string`);
      meta[k] = r.value;
    }
  }
  let consent: AdsLeadPayload["consent"] = null;
  if (obj.consent !== undefined && obj.consent !== null) {
    if (typeof obj.consent !== "object" || Array.isArray(obj.consent)) {
      return bad("invalid_consent", "consent must be an object");
    }
    const cIn = obj.consent as Record<string, unknown>;
    for (const k of Object.keys(cIn)) {
      if (!CONSENT_KEYS.has(k)) return bad("unknown_key", `unknown consent key '${k}'`);
    }
    const basis = boundedString(cIn.basis, 60);
    const text = boundedString(cIn.text, 500);
    const captured = boundedString(cIn.captured_at, 40);
    if (!basis.ok || basis.value === null || !text.ok || !captured.ok) {
      return bad("invalid_consent", "consent.basis is required and fields must be clean strings");
    }
    consent = { basis: basis.value, text: text.value, captured_at: captured.value };
  }
  return {
    ok: true,
    payload: {
      schema_version: ADS_WEBHOOK_SCHEMA_VERSION,
      event_id: obj.event_id,
      occurred_at: new Date(obj.occurred_at).toISOString(),
      campaign_ref: refs.campaign_ref,
      ad_ref: refs.ad_ref,
      form_ref: refs.form_ref,
      lead,
      meta,
      external_ref: refs.external_ref,
      consent,
    },
  };
}

/** The bounded, redaction-safe normalised envelope the ledger stores. */
export function buildAdsEventEnvelope(p: AdsLeadPayload): Record<string, unknown> {
  const env: Record<string, unknown> = {
    schema_version: p.schema_version,
    lead: Object.fromEntries(Object.entries(p.lead).filter(([, v]) => v !== null)),
  };
  if (p.campaign_ref) env.campaign_ref = p.campaign_ref;
  if (p.ad_ref) env.ad_ref = p.ad_ref;
  if (p.form_ref) env.form_ref = p.form_ref;
  if (p.external_ref) env.external_ref = p.external_ref;
  if (Object.keys(p.meta).length > 0) env.meta = p.meta;
  if (p.consent) env.consent = p.consent;
  return env;
}
