import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
test("Alan and Rob have distinct current destinations", () => {
  assert.equal(launchScenarios.find(s => s.key === "alan")?.destination, "+441794378096");
  assert.equal(launchScenarios.find(s => s.key === "rob")?.destination, "+441794378105");
  assert.doesNotMatch(launchScenarios.find(s => s.key === "alan")!.request, /agree to Mary/);
});
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
    assert.match(payload.evaluations[1].structuredOutput.schema.description, /tool event/);
    assert.equal(payload.evaluations.length, 2);
    assert.ok(payload.evaluations.every(e => e.required && e.value === true));
    assert.match(payload.evaluations[0].structuredOutput.schema.description, /repeated transfer announcement/);
    assert.match(payload.evaluations[0].structuredOutput.schema.description, /not audio quality or real delivery/);
    assert.throws(() => assertSafeScenario(payload, tools));
    const modified = structuredClone(payload);
    modified.targetOverrides.model.messages[0].content += " Skip consent.";
    assert.throws(() => assertSafeScenario(modified, tools, assistant));
  }
});
test("background collection cannot launch calls or choose an operator", () => {
  const edge = readFileSync(new URL("../receptionist-testing/index.ts", import.meta.url), "utf8");
  const collector = readFileSync(
    new URL("../receptionist-test-collector/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(edge, /body\.action === "refresh" &&/);
  assert.match(edge, /body\.actorId = saved\.data\.actor_id/);
  assert.match(edge, /notification_require_actor/);
  assert.match(collector, /action: "refresh"/);
  assert.doesNotMatch(collector, /action: "run"/);
  assert.match(collector, /Scheduler required/);
});
