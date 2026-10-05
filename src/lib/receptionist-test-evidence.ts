export type EvidenceState = "passed" | "failed" | "not_tested";
export type VoiceTestEvidence = {
  status: string;
  passed: boolean;
  outcome?: string;
  evidenceIssue?: string | null;
  recordingUrl?: string | null;
  evaluations?: unknown[];
};
export type EvidenceAssessment = {
  key: "routing" | "wording" | "audio" | "telephone";
  title: string;
  state: EvidenceState;
  label: string;
  detail: string;
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// Provider rubric text explains what was requested, not what happened. Only
// explicit verdicts from the named completed checks can become a pass.
function namedVerdict(item: VoiceTestEvidence, name: RegExp): EvidenceState {
  if (!["passed", "failed"].includes(item.status) || item.outcome === "blocked_funding")
    return "not_tested";
  const matches = (item.evaluations ?? []).map(object).filter((e) => name.test(String(e.name)));
  if (matches.some((e) => e.passed === false || e.extractedValue === false)) return "failed";
  return matches.length && matches.every((e) => e.passed === true && e.extractedValue !== false)
    ? "passed"
    : "not_tested";
}

export function testEvidence(item: VoiceTestEvidence): EvidenceAssessment[] {
  const routing =
    item.outcome === "repeated_transfer"
      ? "failed"
      : namedVerdict(item, /^openfolk_(?:route_|closed_refusal$)/);
  const wording =
    item.outcome === "repeated_announcement"
      ? "failed"
      : namedVerdict(item, /^openfolk_(?:conversation_quality|quality)_/);
  return [
    {
      key: "routing",
      title: "Routing decision",
      state: routing,
      label:
        routing === "passed"
          ? "Correct test action"
          : routing === "failed"
            ? "Needs attention"
            : "Not verified",
      detail:
        routing === "passed"
          ? "The scenario’s route or no-transfer decision passed. No real phone was called."
          : item.outcome === "repeated_transfer"
            ? "More than one ordinary transfer was attempted. Review the actions below."
            : routing === "failed"
              ? "The intended route or consent rule did not pass. Review the transcript and actions."
              : "No completed, named routing assessment is available.",
    },
    {
      key: "wording",
      title: "Words and promises",
      state: wording,
      label:
        wording === "passed"
          ? "Transcript checks passed"
          : wording === "failed"
            ? "Needs attention"
            : "Not verified",
      detail:
        wording === "passed"
          ? "The wording rubric passed. This does not prove pronunciation or audio quality."
          : item.outcome === "repeated_announcement"
            ? "Emma repeats a handover statement within one reply. Check the recording before diagnosing a stutter."
            : wording === "failed"
              ? "Check for repetition, unsupported promises or unclear wording in the transcript."
              : "No completed, named conversation-quality assessment is available.",
    },
    {
      key: "audio",
      title: "Audio clarity",
      state: "not_tested",
      label: item.recordingUrl ? "Recording ready to review" : "No recording available",
      detail: item.recordingUrl
        ? "Listen to compare speech with the transcript. Audio clarity has not been signed off."
        : "A transcript cannot prove what the caller heard.",
    },
    {
      key: "telephone",
      title: "Real phone and delivery",
      state: "not_tested",
      label: "Separate live check needed",
      detail:
        "Ringing, two-way audio, voicemail receipt and email delivery are not tested by this simulation.",
    },
  ];
}

export function testNextAction(item: VoiceTestEvidence): string {
  if (item.outcome === "blocked_funding")
    return "Check the provider balance, then start a new run. This scenario produced no quality result.";
  if (["queued", "running", "preparing"].includes(item.status))
    return "Wait for this scenario to finish. No result has been signed off.";
  if (item.outcome === "repeated_transfer")
    return "Review the duplicate transfer instructions, correct the test candidate, then rerun this scenario.";
  if (item.outcome === "repeated_announcement")
    return "Compare the recording with the repeated wording, correct the test candidate, then rerun.";
  const assessments = testEvidence(item);
  if (assessments.some((a) => a.key === "routing" && a.state === "failed"))
    return "Check the requested destination and consent against the attempted action before changing Emma.";
  if (assessments.some((a) => a.key === "wording" && a.state === "failed"))
    return "Read the transcript and compare it with the recording. Correct the wording without changing the approved route.";
  if (item.passed && assessments.slice(0, 2).every((a) => a.state === "passed"))
    return "Review the audio, then complete the separate real-phone and delivery checks. This is not launch approval.";
  return "Inspect the missing or incomplete evidence before treating this scenario as verified.";
}
