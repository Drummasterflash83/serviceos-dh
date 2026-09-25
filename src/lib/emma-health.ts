import { record, type ReceptionistCall } from "./receptionist-data.ts";
import { reviewCall } from "./receptionist-review.ts";

export type EmmaHealthCardId = "service" | "experience" | "help" | "handover";
export type EmmaHealthTone = "good" | "watch" | "waiting";
export type EmmaHealthCard = {
  id: EmmaHealthCardId;
  title: string;
  headline: string;
  summary: string;
  explanation: string;
  tone: EmmaHealthTone;
  observed: number;
  assessed: number;
  flaggedIds: string[];
};

// This is the reviewed launch configuration, not a live Birchills line-health check.
export function mainNumberStatus(launchStage?: string) {
  switch (launchStage) {
    case "Testing":
    case "Ready":
      return "Main number not activated";
    case "Live":
      return "Main number marked active";
    case "Paused":
      return "Main number paused";
    default:
      return "Main number status to confirm";
  }
}

const negativeTone = /^(angry|upset|frustrated|unhappy|negative|dissatisfied|distressed)$/i;
const knownTone =
  /^(positive|neutral|happy|satisfied|calm|angry|upset|frustrated|unhappy|negative|dissatisfied|distressed)$/i;
const handlingFailure = /fail|error|silence-timed-out/i;
const handoverFailure =
  /(?:transfer|forward|handoff).*(?:fail|error)|(?:fail|error).*(?:transfer|forward|handoff)/i;

function evidence(call: ReceptionistCall, key: string) {
  const values = call.outputs.map((output) => record(output.result)[key]);
  if (values.some((value) => value === true)) return true;
  if (values.some((value) => value === false)) return false;
  return null;
}

function explicitFollowUp(call: ReceptionistCall) {
  const keys = [
    "unresolved",
    "requiresFollowUp",
    "callbackRequested",
    "humanRequestedAfterDifficulty",
  ];
  const flags = keys.map((key) => evidence(call, key));
  return {
    flagged: flags.some((flag) => flag === true),
    assessed: flags.every((flag) => flag !== null),
  };
}

function enoughEvidence(assessed: number, observed: number) {
  return assessed >= 3 && observed > 0 && assessed / observed >= 0.6;
}

export function emmaHealthCards(
  calls: ReceptionistCall[],
  state: { connected: boolean; loading: boolean; error: boolean; launchStage?: string },
): EmmaHealthCard[] {
  const serviceIssues = calls.filter(
    (call) => handlingFailure.test(call.endedReason ?? "") || call.success === "false",
  );
  const service: EmmaHealthCard = {
    id: "service",
    title: "Emma's status",
    headline: state.error
      ? "Call data needs a check"
      : state.loading && !state.connected
        ? "Checking Emma's latest calls"
        : !state.connected
          ? "Preparing call insights"
          : serviceIssues.length
            ? `${serviceIssues.length} call${serviceIssues.length === 1 ? "" : "s"} to review`
            : calls.length
              ? "Emma is taking calls"
              : "Call view is ready",
    summary: state.error
      ? "OpenFolk should check why the latest calls could not be loaded."
      : !state.connected
        ? "Call insights will appear here once data is available."
        : serviceIssues.length
          ? "A call ending or provider outcome needs a closer look."
          : calls.length
            ? "Call records are flowing, with no handling issues seen in the loaded history."
            : "New calls will appear here as they arrive.",
    explanation:
      "This reflects Vapi call data and observed call endings. It does not, by itself, verify the main number, whether a transfer was answered, or whether a customer's issue was resolved." +
      (state.launchStage === "Testing" || state.launchStage === "Ready"
        ? " Main-number activation is a separate step."
        : ""),
    tone:
      state.error || (state.connected && serviceIssues.length)
        ? "watch"
        : state.connected && calls.length
          ? "good"
          : "waiting",
    observed: calls.length,
    assessed: state.connected ? calls.length : 0,
    flaggedIds: serviceIssues.map((call) => call.id),
  };

  const experienceFlags = calls.filter(
    (call) =>
      negativeTone.test(call.sentiment?.trim() ?? "") ||
      evidence(call, "callerConfused") === true ||
      evidence(call, "repeatedQuestions") === true ||
      evidence(call, "humanRequestedAfterDifficulty") === true,
  );
  const experienceAssessed = calls.filter(
    (call) =>
      knownTone.test(call.sentiment?.trim() ?? "") ||
      ["callerConfused", "repeatedQuestions", "humanRequestedAfterDifficulty"].every(
        (key) => evidence(call, key) !== null,
      ),
  ).length;
  const experienceReady = enoughEvidence(experienceAssessed, calls.length);
  const experience: EmmaHealthCard = {
    id: "experience",
    title: "Caller experience",
    headline: experienceFlags.length
      ? `${experienceFlags.length} conversation${experienceFlags.length === 1 ? "" : "s"} worth a look`
      : experienceReady
        ? "No concerns surfaced so far"
        : "Learning from conversations",
    summary: experienceFlags.length
      ? "Possible confusion, repetition or frustration was detected."
      : experienceReady
        ? "No experience concerns were flagged in assessed calls."
        : "Emma's insights will build as conversations are assessed.",
    explanation:
      "These are AI-assisted signals from available call evidence, not customer-satisfaction ratings. An ordinary request to speak to a person is not treated as a problem.",
    tone: experienceFlags.length ? "watch" : experienceReady ? "good" : "waiting",
    observed: calls.length,
    assessed: experienceAssessed,
    flaggedIds: experienceFlags.map((call) => call.id),
  };

  const helpFlags = calls.filter(
    (call) => handlingFailure.test(call.endedReason ?? "") || explicitFollowUp(call).flagged,
  );
  const helpAssessed = calls.filter((call) => explicitFollowUp(call).assessed).length;
  const helpReady = enoughEvidence(helpAssessed, calls.length);
  const help: EmmaHealthCard = {
    id: "help",
    title: "People needing help",
    headline: helpFlags.length
      ? `${helpFlags.length} caller${helpFlags.length === 1 ? "" : "s"} may need help`
      : helpReady
        ? "No follow-ups flagged"
        : "Watching for follow-ups",
    summary: helpFlags.length
      ? "Review these specific calls to decide the next step."
      : helpReady
        ? "No follow-up request was flagged in assessed calls."
        : "Follow-up signals will appear as calls are assessed.",
    explanation:
      "A follow-up flag is a prompt for human review, not proof that a task is still open. A transfer or ordinary request for a named person is not counted as an unresolved caller.",
    tone: helpFlags.length ? "watch" : helpReady ? "good" : "waiting",
    observed: calls.length,
    assessed: helpAssessed,
    flaggedIds: helpFlags.map((call) => call.id),
  };

  const failedHandovers = calls.filter((call) => handoverFailure.test(call.endedReason ?? ""));
  const attemptedHandovers = calls.filter(
    (call) =>
      call.endedReason === "assistant-forwarded-call" ||
      handoverFailure.test(call.endedReason ?? ""),
  );
  const handover: EmmaHealthCard = {
    id: "handover",
    title: "Handovers",
    headline: failedHandovers.length
      ? `${failedHandovers.length} handover issue${failedHandovers.length === 1 ? "" : "s"} to review`
      : attemptedHandovers.length
        ? "Emma is routing calls"
        : "No handovers to check yet",
    summary: failedHandovers.length
      ? "A recorded transfer or forwarding attempt appears to have failed."
      : attemptedHandovers.length
        ? "No handover error appears in the observed attempts."
        : "Handover activity will appear here when it occurs.",
    explanation:
      "Emma can show an attempted transfer or a recorded failure. Whether the recipient answered or the customer's issue was resolved needs telephone-system or human evidence.",
    tone: failedHandovers.length ? "watch" : attemptedHandovers.length ? "good" : "waiting",
    observed: attemptedHandovers.length,
    assessed: attemptedHandovers.length,
    flaggedIds: failedHandovers.map((call) => call.id),
  };
  if (!state.connected) {
    return [
      service,
      ...[experience, help, handover].map((card) => ({
        ...card,
        headline: state.error ? "Latest insights being checked" : "Insights arriving",
        summary: state.error
          ? "OpenFolk should check the call-data connection before this status updates."
          : "This view will develop as call data becomes available.",
        tone: "waiting" as const,
        assessed: 0,
        flaggedIds: [],
      })),
    ];
  }
  return [service, experience, help, handover];
}

export function healthCardCalls(card: EmmaHealthCard, calls: ReceptionistCall[]) {
  const ids = new Set(card.flaggedIds);
  return calls
    .filter((call) => ids.has(call.id))
    .sort(
      (a, b) =>
        reviewCall(b).priority - reviewCall(a).priority ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
}
