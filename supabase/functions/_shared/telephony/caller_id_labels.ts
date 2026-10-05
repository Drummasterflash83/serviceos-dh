// ServiceOS — Telephony ADAPTER: caller-ID label parsing (PURE, provider-flavoured).
//
// This is an EVIDENCE SOURCE, not canonical product logic. A hosted PBX (sipcentric today)
// stamps internal call legs with a human caller-ID string that embeds the seat's display
// name AND its extension, e.g. "Mary - Clients <103>". This module understands that provider
// convention and extracts a NORMALISED { extension, label } tuple. The canonical identity
// engine (controlplane/telephony_identity.ts) consumes the normalised tuple and never learns
// the raw provider format — so swapping providers means writing a new parser here, nothing
// downstream. External parties (bare phone numbers, "anonymous", withheld) carry no extension
// and are reported as external so they never masquerade as an internal seat.

export interface CallerIdParse {
  /** Digit-only extension when the leg is an internal seat, else null. */
  extension: string | null;
  /** The human name/role portion, with the "<ext>" marker stripped and whitespace collapsed. */
  label: string;
  /** True when the value is an external number / anonymous caller (no internal extension). */
  isExternalNumber: boolean;
  /** The original string, preserved as raw evidence. */
  raw: string;
}

const EXT_MARKER = /[<([]\s*(\d{2,6})\s*[>)\]]/; // "<103>", "(103)", "[103]"
const ANONYMOUS = /^(anonymous|unknown|withheld|private|restricted|no ?caller ?id)$/i;

/** Collapse whitespace and trim stray separators. */
function tidy(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/^[\s\-,/|]+|[\s\-,/|]+$/g, "")
    .trim();
}

/**
 * Parse one provider caller-ID string into a normalised evidence tuple. Pure + deterministic.
 *   "Mary - Clients <103>" → { extension: "103", label: "Mary - Clients", isExternalNumber: false }
 *   "Larne <207>"          → { extension: "207", label: "Larne" }
 *   "07700900123"          → { extension: null,  label: "07700900123", isExternalNumber: true }
 *   "anonymous"            → { extension: null,  label: "anonymous",   isExternalNumber: true }
 */
export function parseCallerIdLabel(raw: string | null | undefined): CallerIdParse {
  const value = (raw ?? "").trim();
  const out: CallerIdParse = { extension: null, label: value, isExternalNumber: false, raw: value };
  if (!value) return out;

  if (ANONYMOUS.test(value)) return { ...out, isExternalNumber: true };

  const m = value.match(EXT_MARKER);
  if (m) {
    const label = tidy(value.replace(EXT_MARKER, " "));
    return { extension: m[1], label: label || value, isExternalNumber: false, raw: value };
  }

  // No "<ext>" marker. A value that is essentially just a phone number is an external party.
  const digits = value.replace(/[^\d]/g, "");
  const nonDigit = value.replace(/[\d\s()+\-.]/g, "");
  if (nonDigit.length === 0 && digits.length >= 6) return { ...out, isExternalNumber: true };

  // A named label with no extension marker (e.g. "Reception") — internal-ish but no seat number.
  return { extension: null, label: tidy(value), isExternalNumber: false, raw: value };
}
