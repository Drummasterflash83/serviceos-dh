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
    maxDurationSeconds: 120,
    model: {
      provider: assistant.model.provider,
      model: assistant.model.model,
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
