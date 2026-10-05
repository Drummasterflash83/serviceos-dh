// Marketing editorial quality guidance — DETERMINISTIC, ADVISORY, NOT AI.
//
// Pure module: no network, no database, no clock, no model. Every finding is
// a heuristic writing suggestion computed from the content alone; none of
// them ever blocks a save or a send — critical technical safety stays with
// the canonical content validator (marketing_campaign_validate_content) and
// the preflight/eligibility authorities. Thresholds are tenant-tunable
// through marketing_settings.settings.quality (the forward-compatible
// settings bag); the defaults below apply when a tenant configures nothing.
// No brand copy, no tenant-specific rules, no invented legal claims.

export const MARKETING_QUALITY_VERSION = "marketing-quality@1";

export interface QualityThresholds {
  /** advisory ceiling for subject length (chars) */
  subjectMax: number;
  /** advisory ceiling for visible links in the body */
  linkMax: number;
  /** advisory ceiling for body length (chars) */
  bodyMax: number;
  /** advisory ceiling for a single paragraph (chars) */
  paragraphMax: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
  subjectMax: 60,
  linkMax: 3,
  bodyMax: 1500,
  paragraphMax: 500,
};

export interface QualityInput {
  subject: string;
  previewText: string | null;
  bodyAuthored: string;
  tokenFallbacks: Record<string, string>;
  /** whether the selected sender profile carries a signature (advisory only) */
  senderSignaturePresent?: boolean;
  thresholds?: Partial<QualityThresholds>;
}

export interface QualityFinding {
  code: string;
  severity: "advisory";
  message: string;
}

const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;
const LINK_RE = /\[([^\][]{1,200})\]\((https?:\/\/[^\s()<>]+)\)/g;
const GREETING_RE =
  /^(hi|hiya|hello|hey|dear|good\s+(morning|afternoon|evening)|morning|afternoon|evening|greetings)\b/i;
const SIGNOFF_RE =
  /(^|\n)\s*(thanks|thank you|many thanks|best|best wishes|regards|kind regards|warm regards|cheers|yours sincerely|yours faithfully)\s*[,.!]?\s*(\n[^\n]{0,80})?\s*$/i;

function usedTokens(subject: string, body: string): string[] {
  const seen = new Set<string>();
  for (const source of [subject, body]) {
    for (const m of source.matchAll(TOKEN_RE)) seen.add(m[1]);
  }
  return [...seen];
}

/**
 * Deterministic advisory findings, stable order. Same input → same output.
 * Every finding is guidance; nothing here is authoritative or blocking.
 */
export function evaluateContentQuality(input: QualityInput): QualityFinding[] {
  const t: QualityThresholds = { ...DEFAULT_QUALITY_THRESHOLDS, ...(input.thresholds ?? {}) };
  const findings: QualityFinding[] = [];
  const advise = (code: string, message: string) =>
    findings.push({ code, severity: "advisory", message });

  const subject = input.subject ?? "";
  const body = input.bodyAuthored ?? "";
  const links = [...body.matchAll(LINK_RE)];

  if (subject.length > t.subjectMax) {
    advise(
      "long_subject",
      `The subject is ${subject.length} characters — under ${t.subjectMax} usually reads better in a crowded inbox.`,
    );
  }
  if (!input.previewText || input.previewText.trim().length === 0) {
    advise(
      "missing_preheader",
      "No preview text is set — inboxes will show the first body line instead. A short preheader is usually clearer.",
    );
  }
  const firstLine = body.split("\n").find((l) => l.trim().length > 0) ?? "";
  const greetingLike =
    GREETING_RE.test(firstLine.trim()) || /\{\{\s*(first_name|display_name)\s*\}\}/.test(firstLine);
  if (!greetingLike) {
    advise(
      "no_natural_greeting",
      "The body does not open with a greeting. Personal emails usually start with one (for example a line using {{first_name}} with a fallback).",
    );
  }
  if (links.length > t.linkMax) {
    advise(
      "many_links",
      `The body carries ${links.length} links — more than ${t.linkMax} tends to read as bulk mail. Fewer, clearer links usually perform better.`,
    );
  }
  const tokens = usedTokens(subject, body);
  const missingFallbacks = tokens.filter(
    (tok) => !(tok in (input.tokenFallbacks ?? {})) || !input.tokenFallbacks[tok],
  );
  if (missingFallbacks.length > 0) {
    advise(
      "missing_fallbacks",
      `Personalisation without a fallback (${missingFallbacks.map((x) => `{{${x}}}`).join(", ")}) — recipients missing that data would fail preflight or be excluded. Add explicit fallbacks.`,
    );
  }
  if (body.length > t.bodyMax) {
    advise(
      "long_body",
      `The body is ${body.length} characters — under ${t.bodyMax} usually holds attention better for a single-purpose email.`,
    );
  }
  const longParagraph = body
    .split(/\n\s*\n/)
    .some((p) => p.replaceAll("\n", " ").trim().length > t.paragraphMax);
  if (longParagraph) {
    advise(
      "long_paragraphs",
      `At least one paragraph exceeds ${t.paragraphMax} characters — shorter paragraphs read better as plain text.`,
    );
  }
  const asksSomething = /\?/.test(body) || /\breply\b/i.test(body) || /\bcall\b/i.test(body);
  if (links.length === 0 && !asksSomething) {
    advise(
      "no_clear_call_to_action",
      "No link, question or reply prompt found — it may be unclear what you want the reader to do next.",
    );
  }
  if (input.senderSignaturePresent !== false && SIGNOFF_RE.test(body)) {
    advise(
      "embedded_signoff",
      "The body ends with a sign-off, and the sender's signature is appended automatically — the email may sign off twice.",
    );
  }
  return findings;
}
