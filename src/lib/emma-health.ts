import { record, type ReceptionistCall } from "./receptionist-data.ts";
import { reviewCall } from "./receptionist-review.ts";

export type EmmaHealthDialId = "service" | "help" | "understanding" | "experience" | "evidence";

export type EmmaHealthDial = {
  id: EmmaHealthDialId;
  title: string;
  value: string;
  description: string;
  explanation: string;
  affected: number;
  assessed: number;
  unknown: number;
  total: number;
  affectedIds: string[];
  unknownIds: string[];
  tone: "attention" | "observed" | "unknown";
  // This arc is evidence coverage, never an Emma performance or satisfaction score.
  coverage: number | null;
};

const negativeTone = /^(angry|upset|frustrated|unhappy|negative|dissatisfied|distressed)$/i;
const assessedTone =
  /^(positive|neutral|happy|satisfied|calm|angry|upset|frustrated|unhappy|negative|dissatisfied|distressed)$/i;
const handlingFailure = /fail|error|silence-timed-out/i;

function booleanEvidence(call: ReceptionistCall, keys: string[]) {
  const values = keys.map((key) => call.outputs.flatMap((output) => [record(output.result)[key]]));
  if (values.some((items) => items.some((value) => value === true))) return "affected";
  if (values.every((items) => items.some((value) => value === false))) return "clear";
  return "unknown";
}

function makeDial(
  id: EmmaHealthDialId,
  title: string,
  calls: ReceptionistCall[],
  classify: (call: ReceptionistCall) => "affected" | "clear" | "unknown",
  description: (affected: number, assessed: number) => string,
  explanation: string,
  value: (affected: number, assessed: number, total: number) => string,
): EmmaHealthDial {
  const affectedIds: string[] = [];
  const unknownIds: string[] = [];
  let assessed = 0;
  for (const call of calls) {
    const result = classify(call);
    if (result === "affected") affectedIds.push(call.id);
    if (result === "unknown") unknownIds.push(call.id);
    else assessed++;
  }
  const affected = affectedIds.length;
  return {
    id,
    title,
    value: value(affected, assessed, calls.length),
    description: description(affected, assessed),
    explanation,
    affected,
    assessed,
    unknown: unknownIds.length,
    total: calls.length,
    affectedIds,
    unknownIds,
    tone: affected ? "attention" : assessed ? "observed" : "unknown",
    coverage: calls.length ? assessed / calls.length : null,
  };
}

export function emmaHealthDials(calls: ReceptionistCall[], connected: boolean): EmmaHealthDial[] {
  const service = makeDial(
    "service",
    "Emma working",
    calls,
    (call) => (handlingFailure.test(call.endedReason ?? "") ? "affected" : "clear"),
    (affected) =>
      affected
        ? `${affected} call handling issue${affected === 1 ? "" : "s"} to review`
        : "No handling errors in loaded calls",
    "Call-data access and recorded call endings do not verify that the main phone line, transfer recipient or voicemail worked.",
    (affected) => (!connected ? "Unavailable" : affected ? `${affected} issues` : "Connected"),
  );
  service.tone = !connected ? "unknown" : service.affected ? "attention" : "observed";
  service.coverage = null;
  if (!connected) service.description = "Call data could not be confirmed";

  const help = makeDial(
    "help",
    "People needing help",
    calls,
    (call) => {
      if (handlingFailure.test(call.endedReason ?? "")) return "affected";
      return booleanEvidence(call, [
        "unresolved",
        "requiresFollowUp",
        "callbackRequested",
        "humanRequestedAfterDifficulty",
      ]);
    },
    (affected) =>
      affected
        ? "Possible follow-up · review before acting"
        : "No follow-up flagged in assessed calls",
    "An ordinary request for a named person is not a failure. A flag is not proof that follow-up is still open or has been completed.",
    (affected, assessed) => (assessed ? `${affected} to review` : "Not assessed"),
  );
  const understanding = makeDial(
    "understanding",
    "Callers understood",
    calls,
    (call) => booleanEvidence(call, ["callerConfused", "repeatedQuestions"]),
    (affected) =>
      affected ? "Possible confusion or repetition" : "No difficulty flagged in assessed calls",
    "Only explicit structured assessments count. A repeated phone number or a short call does not establish that Emma misunderstood someone.",
    (affected, assessed) => (assessed ? `${affected} flagged` : "Not assessed"),
  );
  const experience = makeDial(
    "experience",
    "Caller experience",
    calls,
    (call) => {
      const tone = call.sentiment?.trim() ?? "";
      if (
        negativeTone.test(tone) ||
        booleanEvidence(call, ["humanRequestedAfterDifficulty"]) === "affected"
      )
        return "affected";
      return assessedTone.test(tone) ? "clear" : "unknown";
    },
    (affected) =>
      affected
        ? "Possible frustration · review conversations"
        : "No frustration flagged in assessed calls",
    "Provider AI estimates are not measured customer satisfaction. Asking for a person without difficulty is normal receptionist work.",
    (affected, assessed) => (assessed ? `${affected} flagged` : "Not assessed"),
  );
  const evidence = makeDial(
    "evidence",
    "Review conversations",
    calls,
    (call) => (call.transcript || call.summary ? "clear" : "unknown"),
    (_affected, assessed) => `${assessed} with a transcript or summary`,
    "A transcript or provider summary helps review a call. Recording availability is checked securely when a call is opened; a listed duration does not prove audio can play.",
    (_affected, assessed, total) => (total ? `${assessed}/${total}` : "No calls"),
  );
  return [service, help, understanding, experience, evidence];
}

export function healthDialCalls(dial: EmmaHealthDial, calls: ReceptionistCall[]) {
  const ids = new Set([...dial.affectedIds, ...dial.unknownIds]);
  return calls
    .filter((call) => ids.has(call.id))
    .sort(
      (a, b) =>
        Number(dial.affectedIds.includes(b.id)) - Number(dial.affectedIds.includes(a.id)) ||
        reviewCall(b).priority - reviewCall(a).priority ||
        b.createdAt.localeCompare(a.createdAt),
    );
}
