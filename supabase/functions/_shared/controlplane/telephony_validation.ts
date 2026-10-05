// ServiceOS — OpenFolk Control Plane: manual telephony inventory validation.
//
// Pure, dependency-free validation for OPERATOR-ENTERED typed telephony inventory. Manual
// records are OpenFolk's canonical configuration — NOT provider-discovered — so they carry
// source='manual' and verification='manual'. This module never touches the DB: it decides
// {canonical, display, verification} or a reviewable error, and exposes a pure duplicate
// check the caller runs against existing canonical endpoints (manual AND discovered).

export type ManualEndpointKind =
  | "ddi"
  | "extension"
  | "queue"
  | "ring_group"
  | "voicemail"
  | "sip"
  | "device";

export const MANUAL_ENDPOINT_KINDS: ManualEndpointKind[] = [
  "ddi",
  "extension",
  "queue",
  "ring_group",
  "voicemail",
  "sip",
  "device",
];

export interface ManualEndpointInput {
  kind: string;
  /** The canonical value the operator typed (number / extension / provider id). */
  value?: string | null;
  /** Human-readable label (required for queues/ring groups). */
  display?: string | null;
  /** Provider/account context, e.g. "sipcentric:3950" (required for most kinds). */
  providerContext?: string | null;
  /** Optional opaque provider identifier (kept as provenance, not the canonical value). */
  providerId?: string | null;
}

export interface ManualEndpointValid {
  ok: true;
  kind: ManualEndpointKind;
  channel: "phone";
  canonical: string; // normalized_value written to communication_endpoints
  display: string; // display_value
  is_shared: boolean;
  verification: "manual";
  source: "manual";
}
export interface ManualEndpointInvalid {
  ok: false;
  errors: string[];
}
export type ManualEndpointResult = ManualEndpointValid | ManualEndpointInvalid;

/** True for anything that looks like a URL / API reference — never a valid endpoint value. */
export function looksLikeUrl(v: string): boolean {
  return /:\/\//.test(v) || /^https?:/i.test(v) || /\bwww\./i.test(v);
}

/** Normalise a dialable number to E.164 (+CC…) or return null if not a plausible number. */
export function normalizeDdi(raw: string): { e164: string; display: string } | null {
  const trimmed = raw.trim();
  if (!trimmed || looksLikeUrl(trimmed)) return null;
  // Only +, digits and common separators are allowed in a phone number.
  if (/[a-z]/i.test(trimmed)) return null;
  let digits = trimmed.replace(/[\s().-]/g, "");
  if (/[^\d+]/.test(digits)) return null;
  let e164: string;
  if (digits.startsWith("+")) {
    e164 = "+" + digits.slice(1).replace(/\D/g, "");
  } else if (digits.startsWith("00")) {
    e164 = "+" + digits.slice(2);
  } else if (digits.startsWith("0")) {
    e164 = "+44" + digits.slice(1); // UK national → E.164
  } else {
    return null; // no country context and not a UK national form
  }
  const nsn = e164.slice(1);
  // E.164: country code + national number, 8–15 digits total (reject extension-length).
  if (nsn.length < 8 || nsn.length > 15) return null;
  return { e164, display: trimmed };
}

/** Validate + normalise one manual endpoint. Returns a reviewable error, never mutates input. */
export function validateManualEndpoint(input: ManualEndpointInput): ManualEndpointResult {
  const errors: string[] = [];
  const kind = String(input.kind ?? "").trim() as ManualEndpointKind;
  const value = (input.value ?? "").toString().trim();
  const display = (input.display ?? "").toString().trim();
  const providerContext = (input.providerContext ?? "").toString().trim();

  if (!MANUAL_ENDPOINT_KINDS.includes(kind)) {
    return { ok: false, errors: [`Unsupported endpoint type "${input.kind}"`] };
  }
  // Universal rejects.
  if (value && looksLikeUrl(value)) errors.push("Endpoint value must not be a URL or API reference");
  if (input.providerId && looksLikeUrl(String(input.providerId)))
    errors.push("Provider id must not be a URL");

  let canonical = "";
  let displayOut = display;
  let is_shared = false;

  switch (kind) {
    case "ddi": {
      if (!value) errors.push("A DDI number is required");
      else {
        const n = normalizeDdi(value);
        if (!n) errors.push("Not a valid phone number (enter a UK or international number, not an extension or URL)");
        else {
          canonical = n.e164;
          displayOut = display || n.display;
        }
      }
      break;
    }
    case "extension": {
      if (!value) errors.push("An extension is required");
      else if (looksLikeUrl(value)) {
        /* already pushed */
      } else if (!/^\d{2,6}$/.test(value)) {
        errors.push("Extension must be 2–6 digits (extensions are not normalised to public numbers)");
      } else {
        canonical = value; // kept as an extension, NOT a public number
        displayOut = display || `Ext ${value}`;
      }
      if (!providerContext) errors.push("Provider/account context is required for an extension");
      break;
    }
    case "queue":
    case "ring_group": {
      if (!display) errors.push(`A display name is required for a ${kind === "queue" ? "queue" : "ring group"}`);
      if (!providerContext) errors.push("Provider/account context is required");
      // Canonical identity is the provider id when given, else a slug of the name —
      // kept separate from the human label.
      const base = (input.providerId ?? display).toString().trim();
      if (base) canonical = `${kind}:${providerContext || "?"}:${slug(base)}`;
      is_shared = true;
      break;
    }
    case "voicemail":
    case "sip":
    case "device": {
      const id = value || (input.providerId ?? "").toString().trim();
      if (!id) errors.push(`A ${kind} identifier is required`);
      else if (looksLikeUrl(id)) {
        /* already pushed */
      } else {
        canonical = `${kind}:${providerContext || "?"}:${slug(id)}`;
      }
      if (!providerContext) errors.push("Provider/account context is required");
      displayOut = display || value || String(input.providerId ?? "");
      break;
    }
  }

  if (!canonical && errors.length === 0) errors.push("Could not derive a canonical value");
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    kind,
    channel: "phone",
    canonical,
    display: displayOut || canonical,
    is_shared,
    verification: "manual",
    source: "manual",
  };
}

function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** An existing canonical endpoint, for duplicate detection. */
export interface ExistingEndpoint {
  endpoint_kind: string;
  normalized_value: string;
  provider?: string | null;
  source?: string | null;
}

/**
 * Pure duplicate check: a manual endpoint duplicates an existing canonical endpoint when
 * kind + normalized value match (within the tenant — the caller scopes the list to the
 * tenant). Checks against BOTH manual and provider-discovered endpoints.
 */
export function findDuplicate(
  candidate: ManualEndpointValid,
  existing: ExistingEndpoint[],
): ExistingEndpoint | null {
  return (
    existing.find(
      (e) => e.endpoint_kind === candidate.kind && e.normalized_value === candidate.canonical,
    ) ?? null
  );
}
