// ServiceOS — PHONE INTELLIGENCE V1: tenant vocabulary normalisation (PURE).
//
// Repairs ASR errors ("John and Teething" → "Drummond Heating") using TENANT-SCOPED
// aliases + context — never a brittle global replace. Invariants:
//   • the RAW transcript is returned unchanged (immutable);
//   • every correction is explainable (alias matched, category, evidence, confidence,
//     span) and reversible;
//   • low-confidence corrections are SUGGESTIONS (applied=false), not silent edits;
//   • matching is word-boundary + case-insensitive and longest-alias-first, so it
//     cannot corrupt a legitimate substring.
// Pure + dependency-free: the caller supplies the tenant's vocabulary rows, so one
// tenant's aliases can never leak into another's transcript.

export const NORMALISER_VERSION = "v1";

export interface VocabularyEntry {
  term: string; // canonical value
  category: string; // org|staff|customer|supplier|equipment|terminology|acronym|place|job_ref|service
  aliases: string[]; // known written variants
  phoneticVariants: string[]; // known ASR mishears
  confidence: number; // 0..1 base confidence for this entry
  active: boolean;
}

export interface Correction {
  from: string; // exact matched raw text
  to: string; // canonical replacement
  category: string;
  evidence: string[];
  confidence: number; // 0..1
  applied: boolean; // false ⇒ suggestion only (below threshold)
  span: { start: number; end: number }; // indices into the RAW string
}

export interface NormalisationResult {
  raw: string; // unchanged, byte-for-byte
  normalised: string; // raw with applied corrections only
  corrections: Correction[]; // applied + suggested, in document order
  version: string;
}

export interface NormaliseOptions {
  /** Terms known-true for this call (e.g. resolved company/person) that corroborate a
   *  correction and raise its confidence. */
  contextTerms?: string[];
  /** Minimum confidence to APPLY (below → recorded as suggestion). Default 0.6. */
  minConfidence?: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Candidate {
  alias: string;
  entry: VocabularyEntry;
  kind: "alias" | "phonetic";
}

/**
 * Normalise a raw transcript against a tenant's vocabulary. Deterministic: same
 * inputs → identical output (so re-processing a call never changes or duplicates a
 * correction). Never mutates `raw`.
 */
export function normaliseTranscript(
  raw: string,
  vocabulary: VocabularyEntry[],
  opts: NormaliseOptions = {},
): NormalisationResult {
  const minConfidence = opts.minConfidence ?? 0.6;
  const context = new Set((opts.contextTerms ?? []).map((t) => t.toLowerCase()));

  if (!raw)
    return { raw: raw ?? "", normalised: raw ?? "", corrections: [], version: NORMALISER_VERSION };

  // Build the candidate alias list (longest first so multi-word phrases win over
  // any substring). Deterministic order: length desc, then alias asc, then term asc.
  const candidates: Candidate[] = [];
  for (const entry of vocabulary) {
    if (!entry.active || !entry.term) continue;
    for (const a of entry.aliases ?? []) if (a) candidates.push({ alias: a, entry, kind: "alias" });
    for (const p of entry.phoneticVariants ?? [])
      if (p) candidates.push({ alias: p, entry, kind: "phonetic" });
  }
  candidates.sort(
    (x, y) =>
      y.alias.length - x.alias.length ||
      x.alias.localeCompare(y.alias) ||
      x.entry.term.localeCompare(y.entry.term),
  );

  // Collect non-overlapping matches, longest candidate first.
  interface Match extends Candidate {
    start: number;
    end: number;
    text: string;
  }
  const matches: Match[] = [];
  const claimed: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => claimed.some(([cs, ce]) => s < ce && e > cs);

  for (const c of candidates) {
    // Word-boundary, case-insensitive. \b works for alphanumeric edges; phrases with
    // spaces are matched literally between boundaries.
    const re = new RegExp(`\\b${escapeRegex(c.alias)}\\b`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      // Skip a no-op correction (already the canonical term, case-insensitively).
      if (m[0].toLowerCase() === c.entry.term.toLowerCase()) continue;
      claimed.push([start, end]);
      matches.push({ ...c, start, end, text: m[0] });
    }
  }

  matches.sort((a, b) => a.start - b.start);

  // Build corrections + the normalised string (applied matches only).
  const corrections: Correction[] = [];
  let normalised = "";
  let cursor = 0;
  for (const mt of matches) {
    const contextHit = context.has(mt.entry.term.toLowerCase());
    // Phonetic mishears are inherently less certain than exact written aliases.
    let confidence = mt.entry.confidence * (mt.kind === "phonetic" ? 0.9 : 1);
    const evidence = [
      `tenant_vocabulary:${mt.entry.category}`,
      `${mt.kind}_match:"${mt.text}"→"${mt.entry.term}"`,
    ];
    if (contextHit) {
      confidence = Math.min(1, confidence + 0.08);
      evidence.push(`context_corroboration:"${mt.entry.term}"`);
    }
    const applied = confidence >= minConfidence;
    corrections.push({
      from: mt.text,
      to: mt.entry.term,
      category: mt.entry.category,
      evidence,
      confidence: Math.min(1, Math.max(0, confidence)),
      applied,
      span: { start: mt.start, end: mt.end },
    });
    normalised += raw.slice(cursor, mt.start) + (applied ? mt.entry.term : mt.text);
    cursor = mt.end;
  }
  normalised += raw.slice(cursor);

  return { raw, normalised, corrections, version: NORMALISER_VERSION };
}
