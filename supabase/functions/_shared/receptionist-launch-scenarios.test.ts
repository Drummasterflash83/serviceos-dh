import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clockOverrides, testClocks } from "./receptionist-test-clock.ts";
import { assertSafeScenario } from "./receptionist-testing.ts";
import {
  scenarioPayload,
  launchScenarios,
  launchScenarioPayloads,
} from "./receptionist-launch-scenarios.ts";
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
  assert.equal(launchScenarios.find((s) => s.key === "alan")?.destination, "+441794378096");
  assert.equal(launchScenarios.find((s) => s.key === "rob")?.destination, "+441794378105");
  assert.doesNotMatch(launchScenarios.find((s) => s.key === "alan")!.request, /agree to Mary/);
});
test("test clock replaces only Liquid date inputs and does not mutate assistant", () => {
  const before = JSON.stringify(assistant);
  const overrides = clockOverrides(assistant, testClocks.closed);
  assert.match(overrides.firstMessage, /2026-10-01T19:00:00Z/);
  assert.match(overrides.model.messages[0].content, /Keep consent/);
  assert.equal(JSON.stringify(assistant), before);
  assert.equal(overrides.maxDurationSeconds, 180);
  assert.throws(() => clockOverrides(assistant, "caller-supplied"));
});
test("180-second adversarial completion window uses a new suite revision, not weaker success criteria", () => {
  const source = readFileSync(new URL("./receptionist-launch-scenarios.ts", import.meta.url), "utf8");
  assert.match(source, /fixed-clock-routing-v9-/);
  assert.doesNotMatch(source, /fixed-clock-routing-v8-/);
  for (const scenario of launchScenarioPayloads(tools, assistant)) {
    assert.equal(scenario.evaluations.length, 2);
    assert.ok(scenario.evaluations.every(e => e.required && e.value === true));
  }
});
test("all reviewed routes intercept transfer and emergency handoff", () => {
  for (const s of launchScenarios) {
    const payload = scenarioPayload(s, tools, assistant);
    assert.doesNotThrow(() => assertSafeScenario(payload, tools, assistant));
    assert.equal(payload.toolMocks.length, 2);
    assert.match(payload.evaluations[1].structuredOutput.schema.description, /tool event/);
    assert.equal(payload.evaluations.length, 2);
    assert.ok(payload.evaluations.every((e) => e.required && e.value === true));
    assert.match(
      payload.evaluations[0].structuredOutput.schema.description,
      /repeated transfer announcement/,
    );
    assert.match(
      payload.evaluations[0].structuredOutput.schema.description,
      /not audio quality or real delivery/,
    );
    assert.throws(() => assertSafeScenario(payload, tools));
    const modified = structuredClone(payload);
    modified.targetOverrides.model.messages[0].content += " Skip consent.";
    assert.throws(() => assertSafeScenario(modified, tools, assistant));
  }
});
test("twelve bounded scenarios preserve ordinary routes and add explicit launch gaps", () => {
  const payloads = launchScenarioPayloads(tools, assistant);
  assert.equal(payloads.length, 12);
  assert.deepEqual(
    payloads.slice(0, 5),
    launchScenarios.map((s) => scenarioPayload(s, tools, assistant)),
  );
  assert.equal(payloads[5].name, "Closed office: hours and declined Heidi voicemail");
  assert.equal(payloads[5].evaluations[1].structuredOutput.name, "openfolk_closed_refusal");
  assert.equal(
    new Set(payloads.flatMap((p) => p.evaluations.map((e) => e.structuredOutput.name))).size,
    24,
  );
  for (const payload of payloads) {
    assert.doesNotThrow(() => assertSafeScenario(payload, tools, assistant));
    assert.equal(payload.targetOverrides.maxDurationSeconds, 180);
    assert.equal(payload.toolMocks.length, tools.length);
    assert.ok(payload.toolMocks.every((mock) => mock.enabled));
    assert.ok(payload.toolMocks.every((mock) => mock.result.includes("No real person was called")));
    assert.equal(payload.evaluations.length, 2);
    assert.ok(payload.evaluations.every((e) => e.required && e.value === true));
    assert.match(payload.evaluations[0].structuredOutput.name, /^openfolk_quality_/);
    assert.match(
      payload.evaluations[1].structuredOutput.name,
      /^openfolk_(?:route_|closed_refusal$)/,
    );
    for (const evaluation of payload.evaluations) {
      assert.ok(
        evaluation.structuredOutput.name.length <= 40,
        `Provider name limit exceeded: ${evaluation.structuredOutput.name}`,
      );
    }
  }
});
test("Christmas at ordinary Friday opening time still requires closure and refusal evidence", () => {
  const p = launchScenarioPayloads(tools, assistant).find(
    (p) => p.evaluations[1].structuredOutput.name === "openfolk_route_holiday_refusal",
  )!;
  assert.equal(testClocks.holiday, "2026-12-25T10:00:00Z");
  assert.deepEqual(p.targetOverrides, clockOverrides(assistant, testClocks.holiday));
  assert.doesNotThrow(() => assertSafeScenario(p, tools, assistant));
  assert.match(p.instructions, /Do not tell Emma what day or holiday it is/);
  assert.match(
    p.evaluations[1].structuredOutput.schema.description,
    /despite ordinary Friday office hours/,
  );
  assert.match(
    p.evaluations[1].structuredOutput.schema.description,
    /NO transfer or emergency handoff/,
  );
});
test("closed consent and refusal checks require actual evidence, never a promised transfer", () => {
  const payloads = launchScenarioPayloads(tools, assistant);
  const consent = payloads.find(
    (p) => p.evaluations[1].structuredOutput.name === "openfolk_route_closed_heidi_consent",
  )!;
  assert.deepEqual(consent.targetOverrides, clockOverrides(assistant, testClocks.closed));
  assert.match(
    consent.evaluations[1].structuredOutput.schema.description,
    /\+441794840042 AFTER explicit voicemail consent/,
  );
  assert.match(consent.evaluations[1].structuredOutput.schema.description, /not the real mailbox/);
  const declined = payloads.find(
    (p) => p.evaluations[1].structuredOutput.name === "openfolk_route_closed_no_consent",
  )!;
  assert.match(declined.instructions, /not an emergency/);
  assert.match(
    declined.evaluations[1].structuredOutput.schema.description,
    /NO ordinary transfer or emergency handoff/,
  );
  assert.match(
    declined.evaluations[1].structuredOutput.schema.description,
    /undecided reply as consent/,
  );
});
test("emergency tests prove root intent only, with fictional details and no real cross-cover claims", () => {
  const payloads = launchScenarioPayloads(tools, assistant);
  for (const kind of ["domestic", "commercial"]) {
    const p = payloads.find(
      (p) => p.evaluations[1].structuredOutput.name === `openfolk_route_emergency_${kind}`,
    )!;
    assert.deepEqual(p.targetOverrides, clockOverrides(assistant, testClocks.closed));
    assert.match(p.name, /\(mocked\)/);
    assert.match(p.instructions, /Test Caller/);
    assert.match(p.instructions, /01632 960001/);
    assert.match(p.instructions, /OpenFolk Test Site/);
    assert.match(
      p.evaluations[1].structuredOutput.schema.description,
      /exactly one Route-Emergency-to-Rob-or-Tony handoff/,
    );
    assert.match(p.evaluations[1].structuredOutput.schema.description, /BEFORE tool events/);
    assert.match(
      p.evaluations[1].structuredOutput.schema.description,
      /do not infer that the continuation ran/,
    );
    assert.match(
      p.evaluations[1].structuredOutput.schema.description,
      /or that mailbox 603 received anything/,
    );
  }
});
test("daytime gas cannot pass without immediate safety advice and Mary route", () => {
  const p = launchScenarioPayloads(tools, assistant).find(
    (p) => p.evaluations[1].structuredOutput.name === "openfolk_route_open_gas_safety",
  )!;
  assert.deepEqual(p.targetOverrides, clockOverrides(assistant, testClocks.open));
  const rubric = p.evaluations[1].structuredOutput.schema.description;
  assert.match(rubric, /0800 111 999/);
  assert.match(rubric, /999 if anyone is unwell or in immediate danger/);
  assert.match(rubric, /avoiding flames and electrical switches/);
  assert.match(rubric, /\+441794378095/);
  assert.match(rubric, /must not delay immediate daytime gas safety\/transfer for intake/);
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
