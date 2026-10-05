// ServiceOS — masked import samples (PURE, explicit policy).
//
// The brief requires masked sample data: a reviewer must understand the
// column mapping and predicted outcome WITHOUT the preview response carrying
// raw row PII. Every directly identifying canonical contact field has an
// explicit masking rule here; a field without a rule falls back to full
// masking, so a newly added identifying column can never leak by omission.
// Non-identifying vocabulary fields (relationship type, lifecycle stage) stay
// readable.

/** a***@domain — never the verbatim address, but the shape stays reviewable */
export function maskEmail(v: string): string {
  const at = v.indexOf("@");
  if (at <= 0) return maskFreeText(v);
  return `${v[0]}***@${v.slice(at + 1)}`;
}

/** …last four digits only */
export function maskPhone(v: string): string {
  const digits = v.replace(/\D+/g, "");
  return digits.length > 4 ? `…${digits.slice(-4)}` : "…";
}

/** first character + ellipsis + bounded length hint */
export function maskFreeText(v: string): string {
  const t = v.trim();
  if (t.length === 0) return "";
  return `${t[0]}…(${Math.min(t.length, 99)})`;
}

/** outward half only, e.g. "AB1 …" */
export function maskPostcode(v: string): string {
  const t = v.trim();
  return t.length <= 2 ? "…" : `${t.slice(0, Math.min(4, Math.ceil(t.length / 2))).trim()} …`;
}

/** first two characters of an external/source reference */
export function maskRef(v: string): string {
  const t = v.trim();
  return t.length <= 2 ? "…" : `${t.slice(0, 2)}…`;
}

const FIELD_POLICY: Record<string, (v: string) => string> = {
  primary_email: maskEmail,
  secondary_email: maskEmail,
  owner_email: maskEmail,
  primary_phone: maskPhone,
  secondary_phone: maskPhone,
  display_name: maskFreeText,
  first_name: maskFreeText,
  last_name: maskFreeText,
  company_name: maskFreeText,
  address_text: maskFreeText,
  postcode: maskPostcode,
  external_id: maskRef,
  source_ref: maskRef,
};

/** vocabulary fields a reviewer needs verbatim — never person-identifying */
const PASS_THROUGH = new Set(["relationship_type", "lifecycle_stage"]);

/** Mask one mapped record for a preview sample. Unknown fields are fully
 *  masked (deny-by-default), never passed through. */
export function maskSampleRecord(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith("__")) continue;
    if (v === null || v === undefined || v === "") continue;
    const s = String(v);
    if (PASS_THROUGH.has(k)) out[k] = s;
    else out[k] = (FIELD_POLICY[k] ?? maskFreeText)(s);
  }
  return out;
}
