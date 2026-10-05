import { stableJson } from "./receptionist-release.ts";
// Test-only clock substitution. Never persist these messages to a live assistant.
export const testClocks = {
  open: "2026-10-01T10:00:00Z",
  closed: "2026-10-01T19:00:00Z",
  holiday: "2026-12-25T10:00:00Z",
} as const;
export function clockOverrides(assistant: any, clock: string) {
  if (!Object.values(testClocks).includes(clock as any)) throw Error("Unsupported test clock");
  const replace = (s: string) => s.replace(/(["'])now\1(?=\s*\|\s*date\s*:)/g, `"${clock}"`);
  return {
    firstMessage: replace(assistant.firstMessage ?? ""),
    // Allow adversarial callers time to finish intake. This is not a latency
    // pass and does not change any live assistant's duration or success rubric.
    maxDurationSeconds: 180,
    model: {
      provider: assistant.model.provider,
      model: assistant.model.model,
      // Match the reviewed assistant rather than leave its configured sampling
      // setting ambiguous in a model override. Zero is meaningful. Do not
      // invent a default or coerce absent/invalid provider values.
      ...(typeof assistant.model.temperature === "number" && Number.isFinite(assistant.model.temperature)
        ? { temperature: assistant.model.temperature }
        : {}),
      messages: assistant.model.messages.map((m: any) => ({
        ...m,
        content: typeof m.content === "string" ? replace(m.content) : m.content,
      })),
    },
  };
}
export function approvedClockOverride(overrides: unknown, assistant: any) {
  return (
    !!assistant &&
    Object.values(testClocks).some(
      (clock) => stableJson(overrides) === stableJson(clockOverrides(assistant, clock)),
    )
  );
}
