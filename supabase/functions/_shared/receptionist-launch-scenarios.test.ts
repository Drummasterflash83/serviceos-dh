import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { clockOverrides, testClocks } from "./receptionist-test-clock.ts";
import { assertSafeScenario } from "./receptionist-testing.ts";
import {
  scenarioPayload,
  launchScenarios,
  launchScenarioPayloads,
  prepareLaunchSuite,
  LAUNCH_SCENARIO_REVISION,
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
test("caller-consistency revision keeps the 180-second window and required success criteria", () => {
  const source = readFileSync(new URL("./receptionist-launch-scenarios.ts", import.meta.url), "utf8");
  assert.equal(LAUNCH_SCENARIO_REVISION, "fixed-clock-routing-v10");
  assert.match(source, /const key = `\$\{LAUNCH_SCENARIO_REVISION\}-/);
  assert.doesNotMatch(source, /const key = `fixed-clock-routing-v9-/);
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
    assert.match(p.instructions, kind === "domestic" ? /OpenFolk Test Home/ : /OpenFolk Test Care Home/);
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
test("emergency callers retain fixed categories and correct false premises without coaching a route", () => {
  const payloads = launchScenarioPayloads(tools, assistant);
  const domestic = payloads.find(p => p.evaluations[1].structuredOutput.name === "openfolk_route_emergency_domestic")!;
  const commercial = payloads.find(p => p.evaluations[1].structuredOutput.name === "openfolk_route_emergency_commercial")!;
  assert.match(domestic.instructions, /Begin by saying: I am at my own home/);
  assert.match(domestic.instructions, /If asked domestic or commercial, answer: Domestic, my own private home/);
  assert.match(domestic.instructions, /correct that premise: No, this is my own private home/);
  assert.doesNotMatch(domestic.instructions, /OpenFolk Test Site|OpenFolk Test Care Home/);
  assert.match(commercial.instructions, /Begin by saying: I am calling from a commercial care home/);
  assert.match(commercial.instructions, /If asked domestic or commercial, answer: Commercial, a care-home business/);
  assert.match(commercial.instructions, /correct that premise: No, this is a commercial care home/);
  for (const p of [domestic, commercial]) {
    assert.match(p.instructions, /you may question why a detail is needed/);
    assert.match(p.instructions, /scepticism must not change the facts, caller identity, property category or incident/);
    assert.match(p.instructions, /Do not agree with an incorrect category/);
    assert.doesNotMatch(p.instructions, /Tony|Rob|Route-Emergency|\+441794/);
    assert.deepEqual(p.targetOverrides, clockOverrides(assistant, testClocks.closed));
    assert.equal(p.toolMocks.length, tools.length);
  }
});
test("all twelve v9 judge definitions remain byte-for-byte unchanged in the new caller revision", () => {
  // Captured before the v10 caller-only edit. This pins names, descriptions,
  // schemas, comparators and mandatory true results, not merely rubric count.
  const unchangedJudges = launchScenarioPayloads(tools, assistant).map(p => ({ name: p.name, evaluations: p.evaluations }));
  assert.equal(createHash("sha256").update(JSON.stringify(unchangedJudges)).digest("hex"),
    "4a493d8c5165501540697489ba276b6607046e3c1d253d29e5bd98dff098f840");
});
test("v10 preparation creates separate resources, preserves v9 evidence and reuses the same personality", async () => {
  const historical = { setup_key: "fixed-clock-routing-v9-candidate-revision", state: "ready", resources: { suiteId: "old-suite", result: "11/12, domestic failed" } };
  const preserved = structuredClone(historical), actions: any[] = [], reads: any[] = [], posts: any[] = [];
  const personalityId = "a0000000-0000-4000-8000-000000000004";
  let selectedSuite = "old-suite";
  const db = { from(table: string) {
    const filters: Record<string, string> = {};
    const chain: any = {
      op: "select", data: null,
      select() { return this; },
      eq(key: string, value: string) { filters[key] = value; return this; },
      insert(data: any) { this.op = "insert"; this.data = data; return this; },
      update(data: any) { this.op = "update"; this.data = data; return this; },
      async maybeSingle() {
        reads.push({ table, ...filters });
        return { error: null, data: filters.setup_key === historical.setup_key ? structuredClone(historical) : null };
      },
      then(resolve: any) {
        actions.push({ table, op: this.op, data: structuredClone(this.data), filters: { ...filters } });
        if (table === "receptionist_test_settings") selectedSuite = this.data.suite_id;
        return Promise.resolve({ error: null }).then(resolve);
      },
    };
    return chain;
  } };
  const api = async (path: string, method = "GET", payload?: any) => {
    if (method === "GET") {
      if (path === "eval/simulation/suite/old-suite") return { simulationIds: ["old-simulation"] };
      if (path === "eval/simulation/old-simulation") return { personalityId };
      assert.fail("Unexpected GET");
    }
    assert.equal(method, "POST", "Existing provider resources must never be overwritten");
    assert.ok(["eval/simulation/scenario", "eval/simulation", "eval/simulation/suite"].includes(path));
    posts.push({ path, payload: structuredClone(payload) });
    return { id: `new-resource-${posts.length}` };
  };
  const result = await prepareLaunchSuite(db, api, { tenant_id: "tenant", suite_id: "old-suite" }, tools, "operator", { ...assistant, id: "candidate", updatedAt: "revision" });
  assert.equal(result.state, "ready");
  assert.deepEqual(historical, preserved);
  assert.equal(reads[0].setup_key, "fixed-clock-routing-v10-candidate-revision");
  assert.equal(posts.filter(p => p.path === "eval/simulation/scenario").length, 12);
  const simulations = posts.filter(p => p.path === "eval/simulation");
  assert.equal(simulations.length, 12);
  assert.ok(simulations.every(p => p.payload.personalityId === personalityId));
  assert.equal(posts.filter(p => p.path === "eval/simulation/suite").length, 1);
  assert.notEqual(selectedSuite, "old-suite");
  assert.equal(result.resources.scenarioRevision, LAUNCH_SCENARIO_REVISION);
  assert.equal(result.resources.sourceSuiteId, "old-suite");
  for (const action of actions.filter(a => a.table === "receptionist_test_suite_setups"))
    assert.equal(action.op === "insert" ? action.data.setup_key : action.filters.setup_key, "fixed-clock-routing-v10-candidate-revision");
  assert.ok(actions.every(a => ["receptionist_test_suite_setups", "receptionist_test_settings"].includes(a.table)), "Saved test runs/history must not be rewritten");
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
