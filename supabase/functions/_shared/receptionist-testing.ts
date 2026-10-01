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
        // Exact Vapi-owned recording origin verified from the signed audio
        // displayed for this account's completed simulation. Not all R2 hosts.
        u.hostname ===
          "hipaa-recordings.94bdb67bb98da30b06bdd917725c037d.r2.cloudflarestorage.com" ||
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
  const toolEvents = list(call.messages)
    .flatMap((message) =>
      list(object(message).tool_calls ?? object(message).toolCalls).map((event) => {
        const e = object(event),
          fn = object(e.function);
        let args: Record<string, any> = {};
        try {
          args = object(typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments);
        } catch {
          /* malformed evidence stays empty */
        }
        return {
          id: typeof e.id === "string" ? e.id.slice(0, 200) : null,
          name: typeof fn.name === "string" ? fn.name.slice(0, 200) : null,
          destination: typeof args.destination === "string" ? args.destination.slice(0, 200) : null,
        };
      }),
    )
    .slice(0, 100);
  const transfers = toolEvents.filter(
    (e) => e.id && e.name === "Route-Call-to-Drummond-Team-20260929",
  );
  const repeatedTransfer = new Set(transfers.map((e) => e.id)).size > 1;
  // Conservative transcript flag, not an audio diagnosis: a second handover
  // promise in the SAME assistant turn needs review even if the AI judge passes.
  const repeatedAnnouncement =
    typeof call.transcript === "string" &&
    call.transcript
      .split(/\n(?=(?:User|AI|assistant):)/)
      .filter((turn: string) => /^(?:AI|assistant):/i.test(turn))
      .some(
        (turn: string) =>
          (
            turn.match(
              /\bI(?:['’]ll| will)\s+(?:put you through|transfer you|connect you|try\b)/gi,
            ) ?? []
          ).length > 1,
      );
  const fundingBlocked =
    typeof i.failureReason === "string" &&
    /wallet balance|insufficient (?:credit|fund)|credit.balance.exhausted/i.test(i.failureReason) &&
    !i.callId &&
    !call.transcript;
  return {
    id: i.id,
    name: object(meta.scenario).name ?? "Voice scenario",
    status: i.status,
    callId: i.callId ?? null,
    failure: typeof i.failureReason === "string" ? i.failureReason.slice(0, 2000) : null,
    passed:
      result.passed === true &&
      list(result.evaluations).length > 0 &&
      !repeatedTransfer &&
      !repeatedAnnouncement &&
      !fundingBlocked,
    outcome: fundingBlocked
      ? "blocked_funding"
      : repeatedTransfer
        ? "repeated_transfer"
        : repeatedAnnouncement
          ? "repeated_announcement"
          : result.passed === true && list(result.evaluations).length > 0
            ? "passed"
            : "needs_review",
    evidenceIssue: repeatedTransfer
      ? "More than one ordinary transfer was invoked. Provider scoring does not override this safety check."
      : repeatedAnnouncement
        ? "The transcript repeats a handover announcement within one response. Review the recording; this flags wording evidence, not the cause of any audio stutter."
        : null,
    transcript: typeof call.transcript === "string" ? call.transcript.slice(0, 40000) : null,
    recordingUrl: safeRecording(call.recordingUrl ?? object(call.artifact).recordingUrl),
    evaluations: list(result.evaluations),
    latency: result.latencyMetrics ?? null,
    // Structured call events distinguish actual repeated tool invocations from
    // a provider transcript repeating the same tool-result text. Never infer
    // transfer success from either. Keep only names, IDs and routing arguments.
    toolEvents,
  };
}
export function recordingCallMatches(
  run: any,
  call: any,
  callId: string,
  assistantId: string,
  verifiedRunItem: boolean,
) {
  return (
    UUID.test(callId) &&
    UUID.test(run.orgId ?? "") &&
    object(run.target).assistantId === assistantId &&
    call.id === callId &&
    call.orgId === run.orgId &&
    (call.assistantId === assistantId || verifiedRunItem)
  );
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
