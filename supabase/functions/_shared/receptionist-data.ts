export interface ReceptionistCall {
  id: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  caller: string;
  number: string | null;
  type: string;
  status: string;
  duration: number | null;
  cost: number | null;
  summary: string | null;
  success: string | null;
  sentiment: string | null;
  endedReason: string | null;
  transcript: string | null;
  recording: string | null;
  needsReview: boolean;
  outputs: { name: string; result: unknown }[];
}
export const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
export function secureUrl(v: unknown): string | null {
  try {
    const u = new URL(String(v));
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
export function normalizeCall(raw: unknown): ReceptionistCall {
  const c = record(raw),
    a = record(c.analysis),
    artifact = record(c.artifact),
    customer = record(c.customer);
  const outputs = Object.values(record(artifact.structuredOutputs))
    .map((v) => record(v))
    .map((v) => ({ name: str(v.name) ?? "Call assessment", result: v.result ?? null }));
  const structured = Object.assign(
    {},
    record(a.structuredData),
    ...outputs.map((v) => record(v.result)),
  );
  const sentiment = str(structured.callerSentiment) ?? str(structured.sentiment);
  const success =
    typeof a.successEvaluation === "boolean"
      ? String(a.successEvaluation)
      : str(a.successEvaluation);
  const start = str(c.startedAt),
    end = str(c.endedAt);
  const seconds = start && end ? (Date.parse(end) - Date.parse(start)) / 1000 : NaN;
  const endedReason = str(c.endedReason);
  return {
    id: str(c.id) ?? "",
    createdAt: str(c.createdAt) ?? "",
    startedAt: start,
    endedAt: end,
    caller: str(customer.name) ?? "Unidentified caller",
    number: str(customer.number),
    type: str(c.type) ?? "Unknown",
    status: str(c.status) ?? "unknown",
    duration: Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null,
    cost: typeof c.cost === "number" && Number.isFinite(c.cost) ? c.cost : null,
    summary: str(a.summary) ?? str(c.summary) ?? str(structured.summary),
    success,
    sentiment,
    endedReason,
    transcript: str(artifact.transcript) ?? str(c.transcript),
    recording: secureUrl(artifact.recordingUrl) ?? secureUrl(c.recordingUrl),
    outputs,
    needsReview:
      success === "false" ||
      /fail|error|silence-timed-out/i.test(endedReason ?? "") ||
      /negative|frustrated|unhappy/i.test(sentiment ?? ""),
  };
}
export function scopedCalls(raw: unknown, assistantId: string): ReceptionistCall[] {
  if (!Array.isArray(raw)) throw new Error("Unexpected call response");
  if (raw.some((c) => record(c).assistantId !== assistantId))
    throw new Error("Call scope mismatch");
  return raw
    .map(normalizeCall)
    .filter((c) => !!c.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function callerGroups(calls: ReceptionistCall[]) {
  const map = new Map<
    string,
    { key: string; name: string; number: string | null; calls: ReceptionistCall[] }
  >();
  for (const c of calls) {
    // Withheld/unknown numbers must never be merged into a fictitious customer.
    const key = c.number?.replace(/[\s()-]/g, "") || c.id;
    const group = map.get(key) ?? { key, name: c.caller, number: c.number, calls: [] };
    group.calls.push(c);
    if (group.name === "Unidentified caller") group.name = c.caller;
    map.set(key, group);
  }
  return [...map.values()];
}
export function durationLabel(seconds: number | null) {
  return seconds === null ? "—" : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
