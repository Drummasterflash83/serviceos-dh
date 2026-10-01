import { test } from "node:test";
import assert from "node:assert/strict";
import { clockOverrides, testClocks } from "./receptionist-test-clock.ts";
import { assertSafeScenario } from "./receptionist-testing.ts";
import { scenarioPayload, launchScenarios } from "./receptionist-launch-scenarios.ts";
const assistant = {
  firstMessage: '{% assign day = "now" | date: "%w", "Europe/London" %}',
  model: {
    provider: "openai",
    model: "gpt-4.1",
    messages: [
      {
        role: "system",
        content: 'Current time {{"now" | date: "%H:%M", "Europe/London"}}. Keep consent.',
      },
    ],
  },
};
const tools = [
  { type: "transferCall", function: { name: "route" } },
  { type: "handoff", function: { name: "emergency" } },
];
test("test clock replaces only Liquid date inputs and does not mutate assistant", () => {
  const before = JSON.stringify(assistant);
  const overrides = clockOverrides(assistant, testClocks.closed);
  assert.match(overrides.firstMessage, /2026-10-01T19:00:00Z/);
  assert.match(overrides.model.messages[0].content, /Keep consent/);
  assert.equal(JSON.stringify(assistant), before);
  assert.throws(() => clockOverrides(assistant, "caller-supplied"));
});
test("all reviewed routes intercept transfer and emergency handoff", () => {
  for (const s of launchScenarios) {
    const payload = scenarioPayload(s, tools, assistant);
    assert.doesNotThrow(() => assertSafeScenario(payload, tools, assistant));
    assert.equal(payload.toolMocks.length, 2);
    assert.match(payload.evaluations[0].structuredOutput.schema.description, /tool event/);
    assert.throws(() => assertSafeScenario(payload, tools));
    const modified = structuredClone(payload);
    modified.targetOverrides.model.messages[0].content += " Skip consent.";
    assert.throws(() => assertSafeScenario(modified, tools, assistant));
  }
});
