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
      ["humanRequestedAfterDifficulty", "Human requested after difficulty"],
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
    assessmentAvailable:
      call.success !== null ||
      call.sentiment !== null ||
      unique.length > 0 ||
      call.outputs.some((o) =>
        [
          "callerConfused",
          "repeatedQuestions",
          "humanRequested",
          "requiresFollowUp",
          "callbackRequested",
          "unresolved",
          "repeatChaser",
        ].some((key) => typeof record(o.result)[key] === "boolean"),
      ),
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

export function callBrief(call: ReceptionistCall) {
  if (call.summary) return { text: call.summary, source: "Provider summary" };
  const firstCaller = call.transcript
    ?.split(/\n/)
    .find((line) => /^\s*(user|customer|caller)\s*:/i.test(line));
  if (firstCaller)
    return {
      text: firstCaller.replace(/^\s*(user|customer|caller)\s*:\s*/i, "").slice(0, 220),
      source: "Caller excerpt · not an AI summary",
    };
  return {
    text: `${durationLabelForBrief(call.duration)} · ${callOutcome(call)}. ${call.transcript ? "Transcript available to review." : "No transcript or summary supplied."}`,
    source: "Call record",
  };
}
function durationLabelForBrief(seconds: number | null) {
  return seconds === null ? "Duration unknown" : `${seconds}s`;
}

export function experienceCards(calls: ReceptionistCall[]) {
  const flag = (keys: string[]) => {
    let assessed = 0,
      flagged = 0;
    for (const call of calls) {
      const values = call.outputs.flatMap((o) => keys.map((key) => record(o.result)[key]));
      if (
        values.some((v) => v === true) ||
        keys.every((key) => call.outputs.some((o) => typeof record(o.result)[key] === "boolean"))
      )
        assessed++;
      if (values.some((v) => v === true)) flagged++;
    }
    return { assessed, flagged, unknown: calls.length - assessed };
  };
  const tones = calls.filter((c) =>
    /^(positive|neutral|happy|satisfied|calm|angry|upset|frustrated|unhappy|negative|dissatisfied|distressed)$/i.test(
      c.sentiment?.trim() ?? "",
    ),
  );
  return [
    {
      id: "tone",
      title: "How callers are feeling",
      ...{
        assessed: tones.length,
        flagged: tones.filter((c) =>
          /^(angry|upset|frustrated|unhappy|negative|dissatisfied|distressed)$/i.test(
            c.sentiment!.trim(),
          ),
        ).length,
        unknown: calls.length - tones.length,
      },
      detail: "Possible frustration · provider AI estimate, not customer feedback",
    },
    {
      id: "confusion",
      title: "Were callers understood?",
      ...flag(["callerConfused"]),
      detail: "Calls flagged for possible confusion",
    },
    {
      id: "repetition",
      title: "Did they have to repeat themselves?",
      ...flag(["repeatedQuestions"]),
      detail: "Calls flagged for repeated questions",
    },
    {
      id: "human",
      title: "Did they ask for a person?",
      ...flag(["humanRequested"]),
      detail: "Explicit human requests · not inferred from transfers",
    },
    {
      id: "followup",
      title: "Who still needs help?",
      ...flag(["unresolved", "requiresFollowUp", "callbackRequested"]),
      detail: "Unresolved or follow-up flags · review before action",
    },
  ];
}
