// ServiceOS — PHONE INTELLIGENCE V1: spoken-name evidence extraction (PURE).
//
// Extracts self-identification phrases ("it's Liz", "Mary speaking", "you're through
// to Julie") from a transcript. This is EVIDENCE that confirms or challenges metadata
// — never a definitive identity on its own, and always scaled by transcript quality.
// Pure + dependency-free; matching against known people is optional and tenant-scoped
// (the caller passes only this tenant's people).

export const SPOKEN_NAME_VERSION = "v1";

export interface KnownPerson {
  id: string;
  name: string;
  aliases?: string[];
}

export interface SpokenNameCandidate {
  name: string; // extracted (as spoken)
  matchedPersonId: string | null; // canonical graph person id, if matched
  matchedPersonName: string | null;
  span: { start: number; end: number };
  pattern: string;
  /** True when the phrase names a THIRD party ("pass you to Tony"), not the speaker. */
  thirdParty: boolean;
  confidence: number; // pattern strength × transcript quality (+ known-person boost)
}

export interface SpokenNameInput {
  transcript: string;
  /** 0..1 ASR quality; low quality caps confidence. Default 0.7. */
  transcriptQuality?: number;
  knownPeople?: KnownPerson[];
}

// Self-identification patterns. Each captures the name in group 1. `thirdParty` marks
// phrases that name someone the speaker is handing off to (not the speaker).
const PATTERNS: Array<{ re: RegExp; strength: number; label: string; thirdParty: boolean }> = [
  {
    re: /\bthis is ([a-z]+(?:\s+[a-z]+)?)\b/gi,
    strength: 0.85,
    label: "this_is",
    thirdParty: false,
  },
  { re: /\b([a-z]+) speaking\b/gi, strength: 0.85, label: "name_speaking", thirdParty: false },
  { re: /\bit'?s ([a-z]+(?:\s+[a-z]+)?)\b/gi, strength: 0.8, label: "its_name", thirdParty: false },
  {
    re: /\byou'?re through to ([a-z]+)\b/gi,
    strength: 0.8,
    label: "through_to",
    thirdParty: false,
  },
  {
    re: /\b(?:i'?ll |i will )?(?:pass|put) you (?:to|through to) ([a-z]+)\b/gi,
    strength: 0.75,
    label: "pass_to",
    thirdParty: true,
  },
];

// Words that are never names (avoid "it's fine", "this is great", "it's okay", …).
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "fine",
  "okay",
  "ok",
  "good",
  "great",
  "all",
  "just",
  "not",
  "no",
  "yes",
  "here",
  "there",
  "him",
  "her",
  "them",
  "me",
  "you",
  "us",
  "about",
  "regarding",
  "calling",
  "ringing",
  "going",
  "done",
  "ready",
  "sorted",
  "alright",
  "right",
  "that",
  "this",
  "them",
  "really",
  "very",
]);

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Deterministically extract spoken-name candidates. Same input → same output. */
export function detectSpokenNames(input: SpokenNameInput): SpokenNameCandidate[] {
  const text = input.transcript ?? "";
  if (!text) return [];
  const quality = Math.min(1, Math.max(0, input.transcriptQuality ?? 0.7));
  const people = input.knownPeople ?? [];

  const results: SpokenNameCandidate[] = [];
  const seen = new Set<string>();

  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(text)) !== null) {
      const rawName = (m[1] ?? "").trim();
      const first = rawName.split(/\s+/)[0]?.toLowerCase() ?? "";
      if (!first || first.length < 2 || STOPWORDS.has(first)) continue;

      const start = m.index + m[0].toLowerCase().indexOf(rawName.toLowerCase());
      const key = `${p.label}:${start}:${rawName.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Match against known people (first-name or full-name / alias, case-insensitive).
      let matchedId: string | null = null;
      let matchedName: string | null = null;
      const rl = rawName.toLowerCase();
      for (const person of people) {
        const names = [person.name, ...(person.aliases ?? [])].map((n) => n.toLowerCase());
        const firstNames = names.map((n) => n.split(/\s+/)[0]);
        if (names.includes(rl) || firstNames.includes(first)) {
          matchedId = person.id;
          matchedName = person.name;
          break;
        }
      }

      let confidence = p.strength * quality;
      if (matchedId) confidence = Math.min(1, confidence + 0.1);

      results.push({
        name: titleCase(rawName),
        matchedPersonId: matchedId,
        matchedPersonName: matchedName,
        span: { start, end: start + rawName.length },
        pattern: p.label,
        thirdParty: p.thirdParty,
        confidence: Math.min(1, Math.max(0, confidence)),
      });
    }
  }

  return results.sort((a, b) => a.span.start - b.span.start);
}
