const URGENCY = ["low", "medium", "high", "emergency"];
const SENTIMENT = ["negative", "neutral", "positive", "mixed"];
const OWNER = ["office", "accounts", "engineer", "manager", "unknown"];

const URGENCY_ALIASES: Record<string, string> = {
  urgent: "high",
  critical: "emergency",
  severe: "high",
};
const SENTIMENT_ALIASES: Record<string, string> = {
  bad: "negative",
  good: "positive",
  angry: "negative",
  happy: "positive",
};
const OWNER_ALIASES: Record<string, string> = {
  billing: "accounts",
  admin: "office",
  ops: "office",
  technician: "engineer",
  director: "manager",
};

interface NormalizedInsight {
  intent: string;
  urgency: string;
  sentiment: string;
  summary: string;
  action_required: boolean;
  suggested_owner: string;
  confidence: number;
}

function lower(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/** urgency: allowed set → alias map → default "medium". */
function normUrgency(v: unknown): string {
  const s = lower(v);
  if (URGENCY.includes(s)) return s;
  return URGENCY_ALIASES[s] ?? "medium";
}

/** sentiment: allowed set → alias map → default "neutral". */
function normSentiment(v: unknown): string {
  const s = lower(v);
  if (SENTIMENT.includes(s)) return s;
  return SENTIMENT_ALIASES[s] ?? "neutral";
}

/** suggested_owner: allowed set → alias map → default "unknown". */
function normOwner(v: unknown): string {
  const s = lower(v);
  if (OWNER.includes(s)) return s;
  return OWNER_ALIASES[s] ?? "unknown";
}

/** action_required: boolean / "true"/"false" / 1/0 / "yes"/"no" → default false. */
function normActionRequired(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "1") return true;
    if (s === "false" || s === "no" || s === "0") return false;
  }
  return false;
}

/** confidence: numeric/string-numeric, percentages (85 → 0.85), clamp 0..1, default 0.5. */
function normConfidence(v: unknown): number {
  let n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n)) return 0.5;
  if (n > 1) n = n / 100;
  return Math.max(0, Math.min(1, n));
}

/** intent: trim → lowercase → spaces to underscores → max 64 → fallback "unknown". */
function normIntent(v: unknown): string {
  if (typeof v !== "string") return "unknown";
  const s = v.trim().toLowerCase().replace(/\s+/g, "_");
  return s === "" ? "unknown" : s.slice(0, 64);
}

/** summary: string, trim, max 1000, fallback "AI analysis unavailable". */
function normSummary(v: unknown): string {
  if (typeof v !== "string") return "AI analysis unavailable";
  const s = v.trim();
  return s === "" ? "AI analysis unavailable" : s.slice(0, 1000);
}

/**
 * Strictly validate/normalise the raw AI object before any DB write. Returns
 * { ok: false } when the object lacks the expected structure — the caller then
 * emits `malformed_response`.
 */
export function normalizeInsight(
  raw: unknown,
): { ok: true; value: NormalizedInsight } | { ok: false } {
  if (!raw || typeof raw !== "object") return { ok: false };
  const obj = raw as Record<string, unknown>;
  const expected = [
    "intent",
    "urgency",
    "sentiment",
    "summary",
    "action_required",
    "suggested_owner",
    "confidence",
  ];
  if (!expected.every((k) => k in obj)) return { ok: false };
  return {
    ok: true,
    value: {
      intent: normIntent(obj.intent),
      urgency: normUrgency(obj.urgency),
      sentiment: normSentiment(obj.sentiment),
      summary: normSummary(obj.summary),
      action_required: normActionRequired(obj.action_required),
      suggested_owner: normOwner(obj.suggested_owner),
      confidence: normConfidence(obj.confidence),
    },
  };
}
