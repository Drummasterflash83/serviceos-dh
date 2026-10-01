import { approvedClockOverride } from "./receptionist-test-clock.ts";
export const object = (x: unknown): Record<string, any> =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, any>) : {};
export const list = (x: unknown): any[] => (Array.isArray(x) ? x : []);
export const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export type TestCheck = {
  key: string;
  label: string;
  state: "passed" | "failed" | "not_tested";
  detail: string;
};
export function configurationChecks(
  assistant: unknown,
  tools: unknown[],
  main: string | null,
): TestCheck[] {
  const a = object(assistant),
    ts = tools.map(object),
    transfers = ts.filter((t) => t.type === "transferCall");
  const destinations = transfers.flatMap((t) => list(t.destinations));
  const loops = destinations.filter(
    (d) => main && String(d.number).replace(/\D/g, "") === main.replace(/\D/g, ""),
  );
  return [
    {
      key: "transfer_count",
      label: "Transfer configuration",
      state: transfers.length <= 1 ? "passed" : "failed",
      detail:
        transfers.length <= 1
          ? "At most one transfer tool is attached."
          : `${transfers.length} transfer tools attached. Vapi rejects this configuration.`,
    },
    {
      key: "main_loop",
      label: "No route back to the main number",
      state: !main ? "not_tested" : loops.length ? "failed" : "passed",
      detail: !main
        ? "Main number not recorded."
        : loops.length
          ? "A destination points back to the main number. Verify a mailbox bypass before launch."
          : "No configured transfer destination points to the main number.",
    },
    {
      key: "voice",
      label: "Voice and transcription configured",
      state: a.voice && a.transcriber ? "passed" : "failed",
      detail: "Configuration only. Audio quality must be checked in a recorded voice test.",
    },
    {
      key: "telephone",
      label: "Real telephone handover",
      state: "not_tested",
      detail:
        "Requires an answered phone test and matching provider call records. Simulations do not prove a handset rang.",
    },
    {
      key: "delivery",
      label: "Voicemail and email delivery",
      state: "not_tested",
      detail:
        "Requires a received voicemail and email receipt. A saved call is not delivery proof.",
    },
  ];
}
export function assertSafeScenario(scenario: unknown, tools: unknown[], assistant?: unknown) {
  const s = object(scenario);
  if (!list(s.evaluations).length) throw Error("A scenario has no success criteria.");
  if (list(s.hooks).length) throw Error("Scenario webhooks require a separate review.");
  const overrides = object(s.targetOverrides);
  if (
    Object.keys(overrides).some(
      (k) => !["variableValues", "firstMessage", "maxDurationSeconds"].includes(k),
    ) &&
    !approvedClockOverride(overrides, assistant)
  )
    throw Error("Unsupported test overrides.");
  const mocks = list(s.toolMocks).map(object);
  for (const raw of tools) {
    const tool = object(raw),
      name = object(tool.function).name;
    if (["endCall"].includes(tool.type)) continue;
    if (!name || !mocks.some((m) => m.toolName === name && m.enabled !== false))
      throw Error("Every external-action tool must be intercepted before running.");
  }
}
export function safeRecording(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (u.hostname.endsWith(".vapi.ai") ||
        u.hostname.endsWith(".vapi.co") ||
        u.hostname.endsWith(".amazonaws.com"))
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function itemReport(raw: unknown) {
  const i = object(raw),
    meta = object(i.metadata),
    call = object(meta.call),
    result = object(i.results);
  return {
    id: i.id,
    name: object(meta.scenario).name ?? "Voice scenario",
    status: i.status,
    callId: i.callId ?? null,
    failure: typeof i.failureReason === "string" ? i.failureReason.slice(0, 2000) : null,
    passed: result.passed === true && list(result.evaluations).length > 0,
    transcript: typeof call.transcript === "string" ? call.transcript.slice(0, 40000) : null,
    recordingUrl: safeRecording(call.recordingUrl ?? object(call.artifact).recordingUrl),
    evaluations: list(result.evaluations),
    latency: result.latencyMetrics ?? null,
  };
}
export function runState(run: unknown, items: ReturnType<typeof itemReport>[]) {
  const r = object(run);
  if (r.status !== "ended") return "running";
  if (items.some((i) => i.status === "canceled")) return "cancelled";
  const expected = Number(object(r.itemCounts).total);
  return items.length > 0 &&
    (!Number.isFinite(expected) || expected === items.length) &&
    items.every((i) => i.status === "passed" && i.passed)
    ? "passed"
    : "failed";
}
