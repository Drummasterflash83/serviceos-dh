// ServiceOS — Customer Health: excerpt redaction (pure, deterministic).
//
// Masks obvious personal data BEFORE any excerpt is stored on a shadow proposal,
// assessment or source. It is a defensive MINIMISER, not a guarantee of zero PII —
// combined with a bounded excerpt length and the tenant privacy policy
// (redact_excerpts / expose_transcript), it keeps stored shadow evidence to the minimum
// needed to explain a classification. Order matters: most-specific patterns first so a
// broad number rule never eats a postcode/card/sort-code.
//
// RETENTION: stored excerpts live only on health_proposal_sources.excerpt and
// health_assessments.evidence, are Tenant-Superadmin-only (RLS), append-only, and are
// capped at the tenant's max_excerpt_chars. They are shadow artefacts and carry no
// customer-identifying transcript; a tenant may set expose_transcript=false (default)
// to forbid raw transcript exposure entirely.

const RULES: Array<[RegExp, string]> = [
  // Email
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi, "[email]"],
  // UK postcode (SW1A 1AA, M1 1AE, CR2 6XH)
  [/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi, "[postcode]"],
  // Sort code (12-34-56 or 12 34 56)
  [/\b\d{2}[-\s]\d{2}[-\s]\d{2}\b/g, "[sort-code]"],
  // Card / long structured number (13–19 digits, optionally grouped)
  [/\b(?:\d[ -]?){13,19}\b/g, "[card]"],
  // Phone / general long digit run (8+ digits)
  [/\b(?:\+?\d[\d ()-]{7,}\d)\b/g, "[number]"],
  // Street address (number + words + street type)
  [
    /\b\d{1,4}[a-z]?\s+[A-Za-z][A-Za-z'.\- ]{2,40}?\s(?:street|st|road|rd|avenue|ave|lane|ln|close|cl|drive|dr|way|court|ct|place|pl|terrace|crescent|cres|gardens|grove|walk)\b/gi,
    "[address]",
  ],
];

/** Mask emails, postcodes, sort codes, card/account and phone numbers, and addresses. */
export function redactText(raw: string): string {
  let s = raw;
  for (const [re, sub] of RULES) s = s.replace(re, sub);
  return s;
}
