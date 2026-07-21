// ServiceOS — Job-number normalization + reference extraction (PURE, tenant-configurable).
//
// Job numbers are a tenant/source-scoped identifier. Slack/phone/email text references them in
// many forms (123456, "Job 123456", "#123456", "J123456", "Commusoft 123456"). This module
// turns free text into CANDIDATE references — it never decides a match. Resolution against the
// tenant's real `jobs`/`job_number_aliases` happens in the worker; a bare number only becomes a
// job if it EXACTLY matches a known job number. We deliberately avoid treating phone numbers or
// monetary values as jobs: candidates that look like phones/money are excluded here.

export interface JobRefConfig {
  /** Prefix words/symbols that mark a high-confidence reference (case-insensitive). */
  prefixes?: string[];
  /** Allowed job-number digit length range (inclusive). */
  minDigits?: number;
  maxDigits?: number;
  /** Whether bare digit runs (no prefix) may be emitted as low-confidence candidates. */
  bareDigitsAllowed?: boolean;
}

const DEFAULTS: Required<JobRefConfig> = {
  prefixes: ["job", "commusoft", "#", "j"],
  minDigits: 4,
  maxDigits: 8,
  bareDigitsAllowed: true,
};

export interface JobRefCandidate {
  raw: string; // as written, e.g. "#123456" / "Job 123456"
  normalized: string; // canonical digits, e.g. "123456"
  form: "prefixed" | "bare";
  confidence: number; // 0.9 prefixed, 0.4 bare (still requires an exact job match to resolve)
}

/** Strip prefixes/symbols and return the canonical digit string, or null if none. */
export function normalizeJobNumber(raw: string): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D+/g, "");
  return digits.length ? digits : null;
}

// A token that is clearly a phone number (UK-ish) — exclude from job candidates.
function looksLikePhone(token: string): boolean {
  const d = token.replace(/\D+/g, "");
  return d.length >= 9; // 9+ digits → treat as phone/other, never a job number
}
// A token that is clearly money (has a decimal part or currency symbol nearby) — excluded by
// the caller via context; here we drop tokens with a decimal point.
function looksLikeMoney(raw: string): boolean {
  return /[£$€]/.test(raw) || /\d[.,]\d{2}\b/.test(raw);
}

/**
 * Extract job-number candidates from free text. Prefixed forms (configured) are high-confidence;
 * bare digit runs within the configured length are low-confidence and MUST be confirmed against a
 * real job before use. Phone-like and money-like tokens are excluded.
 */
export function extractJobReferences(text: string, config: JobRefConfig = {}): JobRefCandidate[] {
  if (!text) return [];
  const cfg = { ...DEFAULTS, ...config };
  const prefixes = cfg.prefixes.map((p) => p.toLowerCase());
  const out: JobRefCandidate[] = [];
  const seen = new Set<string>();

  // 1) Prefixed forms: <prefix> <optional space/#/-> <digits>
  const prefixAlt = prefixes.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const prefixed = new RegExp(
    `(?:${prefixAlt})\\s*[#:\\-]?\\s*(\\d{${cfg.minDigits},${cfg.maxDigits}})`,
    "gi",
  );
  for (const m of text.matchAll(prefixed)) {
    const raw = m[0].trim();
    const normalized = m[1];
    if (looksLikeMoney(raw) || looksLikePhone(normalized)) continue;
    const key = `p:${normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ raw, normalized, form: "prefixed", confidence: 0.9 });
  }

  // 2) Bare digit runs (low confidence, resolution required)
  if (cfg.bareDigitsAllowed) {
    const bare = new RegExp(
      `(?<![\\d.,£$€#Jj])(\\d{${cfg.minDigits},${cfg.maxDigits}})(?![\\d.,])`,
      "g",
    );
    for (const m of text.matchAll(bare)) {
      const normalized = m[1];
      const raw = m[0];
      if (looksLikePhone(normalized)) continue;
      if (seen.has(`p:${normalized}`) || seen.has(`b:${normalized}`)) continue;
      seen.add(`b:${normalized}`);
      out.push({ raw, normalized, form: "bare", confidence: 0.4 });
    }
  }
  return out;
}
