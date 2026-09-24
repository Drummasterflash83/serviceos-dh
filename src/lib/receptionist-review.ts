import { callerGroups, record, type ReceptionistCall } from "./receptionist-data.ts";

export type CallSignal = { label: string; evidence: string; source: string; weight: number };
export function reviewCall(call: ReceptionistCall) {
  const signals: CallSignal[] = [];
  const add = (label: string, evidence: string, source: string, weight: number) =>
    signals.push({ label, evidence, source, weight });
  if (call.success === "false")
    add(
      "Outcome needs review",
      "Vapi marked its success assessment as failed.",
      "Provider assessment",
      2,
    );
  if (/fail|error|silence-timed-out/i.test(call.endedReason ?? ""))
    add("Call handling issue", call.endedReason!, "Provider end reason", 3);
  // These are provider assessments, not measured customer satisfaction.
  const sentiment = call.sentiment?.trim().toLowerCase();
  if (
    sentiment &&
    /^(angry|upset|frustrated|unhappy|negative|dissatisfied|distressed)$/.test(sentiment)
  )
    add("Possible caller frustration", call.sentiment!, "Provider AI sentiment", 2);
  for (const output of call.outputs) {
    const data = record(output.result);
    for (const [key, label] of [
      ["requiresFollowUp", "Follow-up suggested"],
      ["callbackRequested", "Callback requested"],
      ["callerConfused", "Possible confusion"],
      ["repeatedQuestions", "Questions repeated"],
      ["unresolved", "Possibly unresolved"],
      ["repeatChaser", "Possible repeat chasing"],
    ]) {
      if (data[key] === true) add(label, `${key}: true`, `Provider assessment · ${output.name}`, 2);
    }
  }
  const unique = [...new Map(signals.map((s) => [s.label, s])).values()];
  return {
    signals: unique,
    priority: unique.reduce((max, s) => Math.max(max, s.weight), 0),
    label: unique.some((s) => s.weight === 3)
      ? "Handling issue"
      : unique.length
        ? "Review suggested"
        : "No review signal",
    assessmentAvailable: call.success !== null || call.sentiment !== null || unique.length > 0,
  };
}

export function rankCalls(calls: ReceptionistCall[]) {
  return [...calls].sort(
    (a, b) =>
      reviewCall(b).priority - reviewCall(a).priority ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

export function callOutcome(call: ReceptionistCall) {
  if (/fail|error|silence-timed-out/i.test(call.endedReason ?? "")) return "Handling issue";
  if (call.endedReason === "assistant-forwarded-call") return "Transferred · result not confirmed";
  if (call.success === "false") return "Outcome needs review";
  if (call.success === "true") return "Provider assessment passed";
  return call.status === "ended"
    ? "Call ended · outcome unassessed"
    : "Call in progress or status unconfirmed";
}

export function sameNumberHistory(call: ReceptionistCall, calls: ReceptionistCall[]) {
  return (
    callerGroups(calls).find((group) => group.calls.some((c) => c.id === call.id))?.calls ?? [call]
  );
}
