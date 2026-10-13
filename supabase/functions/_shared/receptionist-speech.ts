import { record } from "./receptionist-data.ts";

const pick = (value: unknown, keys: string[]) => {
  const source = record(value);
  return Object.fromEntries(
    keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
  );
};

// Preserve the published timing in isolated practice, without forwarding custom
// endpointing servers, credentials or callbacks. This does not tune the live agent.
export function practiceSpeakingPlans(value: unknown) {
  const source = record(value),
    start = record(source.startSpeakingPlan);
  const startSpeakingPlan = pick(start, ["waitSeconds", "smartEndpointingEnabled"]);
  if (start.smartEndpointingPlan != null) {
    const smart = record(start.smartEndpointingPlan);
    if (!["vapi", "livekit"].includes(String(smart.provider)))
      throw Error("Custom speech endpointing requires review");
    startSpeakingPlan.smartEndpointingPlan = pick(
      smart,
      smart.provider === "livekit" ? ["provider", "waitFunction"] : ["provider"],
    );
  }
  if (start.transcriptionEndpointingPlan != null)
    startSpeakingPlan.transcriptionEndpointingPlan = pick(start.transcriptionEndpointingPlan, [
      "onPunctuationSeconds",
      "onNoPunctuationSeconds",
      "onNumberSeconds",
    ]);
  if (start.customEndpointingRules != null) {
    if (!Array.isArray(start.customEndpointingRules))
      throw Error("Invalid speech endpointing rules");
    startSpeakingPlan.customEndpointingRules = start.customEndpointingRules.map((value) => {
      const rule = record(value);
      if (!["assistant", "customer", "both"].includes(String(rule.type)))
        throw Error("Unsupported speech endpointing rule");
      const projected = pick(
        rule,
        rule.type === "both"
          ? [
              "type",
              "assistantRegex",
              "assistantRegexOptions",
              "customerRegex",
              "customerRegexOptions",
              "timeoutSeconds",
            ]
          : ["type", "regex", "regexOptions", "timeoutSeconds"],
      );
      for (const key of ["regexOptions", "assistantRegexOptions", "customerRegexOptions"]) {
        if (projected[key] === undefined) continue;
        if (!Array.isArray(projected[key])) throw Error("Invalid speech regex options");
        projected[key] = projected[key].map((option: unknown) => pick(option, ["type", "enabled"]));
      }
      return projected;
    });
  }
  return {
    startSpeakingPlan,
    stopSpeakingPlan: pick(source.stopSpeakingPlan, [
      "numWords",
      "voiceSeconds",
      "backoffSeconds",
      "acknowledgementPhrases",
      "interruptionPhrases",
    ]),
  };
}
