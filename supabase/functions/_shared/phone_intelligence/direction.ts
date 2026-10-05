// ServiceOS — PHONE INTELLIGENCE V1: deterministic call-direction classifier (PURE).
//
// Direction is decided from PROVIDER METADATA ONLY (Simwood/Birchills raw_payload).
// The transcript is NEVER consulted here — uncertain speech must not decide who
// called whom. Pure + dependency-free so it runs identically in the Deno worker and
// in node tests, and every decision carries explainable evidence + a confidence.
//
// Observed Simwood shape (audited): direction 'IN'|'OUT'; srcEndpoint/dstEndpoint are
// SCALARS (extension or number); outcome 'ANSWERED'|'NO_ANSWER'|'BUSY'|'FAILED';
// from/to/callerId numbers; id/callId + parent (parent≠id ⇒ this leg was transferred).

export const DIRECTION_CLASSIFIER_VERSION = "v1";

export type CallDirection =
  | "inbound"
  | "outbound"
  | "internal"
  | "transferred"
  | "picked_up"
  | "missed"
  | "voicemail"
  | "unknown";

export interface DirectionEvidenceItem {
  signal: string;
  value: string;
  weight: number;
}

export interface DirectionResult {
  direction: CallDirection;
  providerDirection: string | null;
  originatingNumber: string | null;
  destinationNumber: string | null;
  externalPartyNumber: string | null;
  originatingExtension: string | null;
  answeringExtension: string | null;
  pickupExtension: string | null;
  transferredFromExtension: string | null;
  transferredToExtension: string | null;
  evidence: DirectionEvidenceItem[];
  confidence: number; // 0..1
  classifierVersion: string;
}

export interface DirectionInput {
  rawPayload: Record<string, unknown> | null | undefined;
  /** Extensions known to be internal (from telephony_directory). Optional. */
  internalExtensions?: Iterable<string>;
}

/** Coerce a jsonb value to a trimmed non-empty string, else null. Never throws. */
function scalar(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** An extension is short and all-digits, or explicitly declared internal. E.164 (long,
 *  or '+'-prefixed) is never an extension. */
function looksLikeExtension(s: string | null, internal: Set<string>): boolean {
  if (!s) return false;
  if (internal.has(s)) return true;
  if (s.startsWith("+")) return false;
  return /^\d{2,5}$/.test(s);
}

/**
 * Classify a call's direction from provider metadata alone. Deterministic and pure;
 * returns `unknown` with confidence 0 when metadata is absent (never a guess).
 */
export function classifyCallDirection(input: DirectionInput): DirectionResult {
  const raw = (input.rawPayload ?? {}) as Record<string, unknown>;
  const internal = new Set<string>(input.internalExtensions ?? []);
  const evidence: DirectionEvidenceItem[] = [];

  const providerDirection = scalar(raw.direction);
  const prov = providerDirection ? providerDirection.toUpperCase() : null;
  const outcome = (scalar(raw.outcome) ?? "").toUpperCase();
  const scope = (scalar(raw.scope) ?? "").toUpperCase();

  const src = scalar(raw.srcEndpoint);
  const dst = scalar(raw.dstEndpoint);
  const fromNum = scalar(raw.from) ?? scalar(raw.callerId);
  const toNum = scalar(raw.to);

  // NOTE (audited real data): with the Sipcentric/Birchills feed, srcEndpoint/
  // dstEndpoint are opaque API resource URIs (not extensions), and `parent` differs
  // from `id` on EVERY call — so parent≠id is structural, NOT a transfer signal.
  // Transfer/pickup requires cross-leg correlation (multiple call rows sharing a
  // group id) which is a documented V1+ item; the pure classifier therefore never
  // infers a transfer from a single leg, and only trusts extension roles the caller
  // supplies explicitly (input.internalExtensions) or that appear as clean extensions.
  const srcIsExt = looksLikeExtension(src, internal);
  const dstIsExt = looksLikeExtension(dst, internal);

  // ── Extension roles by transport direction ────────────────────────────────
  let originatingExtension: string | null = null;
  let answeringExtension: string | null = null;
  let externalPartyNumber: string | null = null;

  if (prov === "OUT") {
    originatingExtension = srcIsExt ? src : null;
    externalPartyNumber = toNum ?? (dstIsExt ? null : dst);
  } else if (prov === "IN") {
    answeringExtension = dstIsExt ? dst : null;
    externalPartyNumber = fromNum ?? (srcIsExt ? null : src);
  } else {
    if (srcIsExt) originatingExtension = src;
    if (dstIsExt) answeringExtension = dst;
    externalPartyNumber = !srcIsExt ? (fromNum ?? src) : !dstIsExt ? (toNum ?? dst) : null;
  }

  // ── Base direction from provider metadata ─────────────────────────────────
  let direction: CallDirection = "unknown";
  let confidence = 0;

  if (prov === "IN") {
    direction = "inbound";
    confidence = 0.85;
    evidence.push({ signal: "provider_direction", value: providerDirection ?? "IN", weight: 0.85 });
  } else if (prov === "OUT") {
    direction = "outbound";
    confidence = 0.85;
    evidence.push({
      signal: "provider_direction",
      value: providerDirection ?? "OUT",
      weight: 0.85,
    });
  } else if (srcIsExt && dstIsExt) {
    direction = "internal";
    confidence = 0.6;
    evidence.push({ signal: "both_endpoints_internal", value: `${src}->${dst}`, weight: 0.6 });
  }

  // An endpoint match raises confidence — metadata corroborated on both axes.
  if ((prov === "IN" && answeringExtension) || (prov === "OUT" && originatingExtension)) {
    confidence = 0.95;
    evidence.push({
      signal: "endpoint_extension",
      value: originatingExtension ?? answeringExtension ?? "",
      weight: 0.1,
    });
  }

  // ── Refinements (never override a known transport direction silently) ─────
  // Unanswered inbound ⇒ missed. (Outbound no-answer stays 'outbound' — we placed it.)
  if (direction === "inbound" && (outcome === "NO_ANSWER" || outcome === "BUSY")) {
    direction = "missed";
    evidence.push({ signal: "outcome", value: outcome, weight: 0.2 });
  } else if (outcome) {
    evidence.push({ signal: "outcome", value: outcome, weight: 0.05 });
  }

  // Transfer/pickup is intentionally NOT inferred here (no reliable single-leg signal
  // in the audited provider feed). These stay null until cross-leg correlation lands.
  const transferredFromExtension: string | null = null;
  const transferredToExtension: string | null = null;

  if (scope) evidence.push({ signal: "scope", value: scope, weight: 0.02 });

  return {
    direction,
    providerDirection,
    originatingNumber: prov === "OUT" ? (src ?? fromNum) : fromNum,
    destinationNumber: prov === "OUT" ? toNum : (dst ?? toNum),
    externalPartyNumber,
    originatingExtension,
    answeringExtension,
    pickupExtension: null, // reserved for explicit pickup metadata (not in Simwood v1 shape)
    transferredFromExtension,
    transferredToExtension,
    evidence,
    confidence: Math.min(1, Math.max(0, confidence)),
    classifierVersion: DIRECTION_CLASSIFIER_VERSION,
  };
}
