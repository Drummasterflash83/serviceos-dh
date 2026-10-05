// ServiceOS — PHONE INTELLIGENCE V1: provider-normalisation boundary (PURE).
//
// Translates provider-specific call payloads (Sipcentric/Birchills today; Simwood and
// others later) into ONE canonical telephony-evidence shape. This is the only place
// that understands provider quirks, so the identity engine and canonical product
// models never learn a provider's field names.
//
// Audited real-data invariants that MUST NOT regress:
//   • raw_payload.direction ('IN'/'OUT') is the reliable direction source;
//   • srcEndpoint/dstEndpoint are OPAQUE provider resource URIs, NOT extensions —
//     they are preserved as endpoint *references*, never parsed as a human extension;
//   • parent≠id is structural on every record and is NEVER transfer evidence;
//   • the external number lives in the canonical phone_calls.from/to columns.
// Transfer/pickup stays 'unknown' unless a provider gives explicit call-chain evidence.

export const PROVIDER_ADAPTER_VERSION = "v1";

export type CanonicalOutcome = "answered" | "no_answer" | "busy" | "failed" | "unknown";
export type CanonicalTransfer = "unknown"; // never inferred in v1

export interface CanonicalCallEvidence {
  provider: string; // 'sipcentric' | 'simwood' | 'unknown'
  providerDirection: string | null; // raw provider value, preserved
  externalNumber: string | null;
  /** Opaque provider endpoint URIs — references only, never treated as extensions. */
  originatingEndpointRef: string | null;
  destinationEndpointRef: string | null;
  /** A human extension ONLY when the provider actually supplies one (usually null). */
  originatingExtension: string | null;
  answeringExtension: string | null;
  providerOutcome: CanonicalOutcome;
  transfer: CanonicalTransfer;
  evidenceSource: string;
  adapterVersion: string;
}

function str(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function detectProvider(raw: Record<string, unknown>): string {
  const uri = (str(raw.uri) ?? "").toLowerCase();
  const src = (str(raw.srcEndpoint) ?? str(raw.dstEndpoint) ?? "").toLowerCase();
  if (uri.includes("sipcentric") || src.includes("sipcentric")) return "sipcentric";
  if (uri.includes("simwood") || src.includes("simwood")) return "simwood";
  return "unknown";
}

function canonicalOutcome(v: string | null): CanonicalOutcome {
  switch ((v ?? "").toUpperCase()) {
    case "ANSWERED":
      return "answered";
    case "NO_ANSWER":
      return "no_answer";
    case "BUSY":
      return "busy";
    case "FAILED":
      return "failed";
    default:
      return "unknown";
  }
}

/** An opaque endpoint ref is a provider URI (or any non-extension string). Only a short
 *  all-digit value is treated as a real extension. */
function classifyEndpoint(v: string | null): { ref: string | null; extension: string | null } {
  if (!v) return { ref: null, extension: null };
  if (/^\d{2,5}$/.test(v)) return { ref: v, extension: v };
  return { ref: v, extension: null };
}

export interface CanonicaliseInput {
  rawPayload: Record<string, unknown> | null | undefined;
  /** Canonical numbers from phone_calls columns (authoritative for the external party). */
  fromNumber?: string | null;
  toNumber?: string | null;
}

/**
 * Produce canonical call evidence from a provider payload. Pure + deterministic.
 * Provider-specific fields never escape this function.
 */
export function canonicaliseCall(input: CanonicaliseInput): CanonicalCallEvidence {
  const raw = (input.rawPayload ?? {}) as Record<string, unknown>;
  const provider = detectProvider(raw);
  const providerDirection = str(raw.direction);
  const dir = (providerDirection ?? "").toUpperCase();

  const src = classifyEndpoint(str(raw.srcEndpoint));
  const dst = classifyEndpoint(str(raw.dstEndpoint));

  // External party: prefer the canonical column for the "far" side by direction.
  const from = str(input.fromNumber) ?? str(raw.from) ?? str(raw.callerId);
  const to = str(input.toNumber) ?? str(raw.to);
  const externalNumber = dir === "IN" ? from : dir === "OUT" ? to : (from ?? to);

  return {
    provider,
    providerDirection,
    externalNumber,
    originatingEndpointRef: src.ref,
    destinationEndpointRef: dst.ref,
    // Extensions only when the provider genuinely supplies a short numeric endpoint.
    originatingExtension: dir === "OUT" ? src.extension : null,
    answeringExtension: dir === "IN" ? dst.extension : null,
    providerOutcome: canonicalOutcome(str(raw.outcome)),
    transfer: "unknown",
    evidenceSource: "provider_metadata",
    adapterVersion: PROVIDER_ADAPTER_VERSION,
  };
}
