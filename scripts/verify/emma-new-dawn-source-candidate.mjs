// Reproducible local preflight for the twelve agreed Emma scenario definitions.
// It does not invoke an assistant, Vapi, Birchills, a phone or a notification.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { launchScenarioPayloads, LAUNCH_SCENARIO_REVISION } from "../../supabase/functions/_shared/receptionist-launch-scenarios.ts";
import { assertSafeScenario } from "../../supabase/functions/_shared/receptionist-testing.ts";
import { clockOverrides, testClocks } from "../../supabase/functions/_shared/receptionist-test-clock.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceCommit = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? ""))
  throw Error("Pass one immutable 40-character source commit SHA.");
const files = [
  "supabase/functions/_shared/receptionist-emergency-603-receiver.ts",
  "supabase/functions/_shared/receptionist-emergency-fallback-proof.ts",
  "supabase/functions/_shared/receptionist-emergency-intake-gate.ts",
  "supabase/functions/_shared/receptionist-launch-candidate.ts",
  "supabase/functions/_shared/receptionist-launch-clear-contract.ts",
  "supabase/functions/_shared/receptionist-launch-consistency.ts",
  "supabase/functions/_shared/receptionist-launch-destinations.ts",
  "supabase/functions/_shared/receptionist-launch-intake-contract.ts",
  "supabase/functions/_shared/receptionist-launch-promotion.ts",
  "supabase/functions/_shared/receptionist-launch-scenarios.ts",
  "supabase/functions/_shared/receptionist-launch-wording.ts",
  "supabase/functions/_shared/receptionist-test-clock.ts",
  "supabase/functions/_shared/receptionist-testing.ts",
];
const sha256 = value => createHash("sha256").update(value).digest("hex");
const sourceFiles = files.map(path => {
  const current = readFileSync(resolve(root, path));
  const committed = execFileSync("git", ["show", `${sourceCommit}:${path}`], { cwd: root });
  assert.equal(sha256(current), sha256(committed), `Source drift: ${path}`);
  return { path, sha256: sha256(current) };
});
const candidateSourceSha256 = sha256(JSON.stringify({ sourceCommit, sourceFiles }));

// This fixture tests the suite's clocks, mocks and criteria only. It is not a
// reconstruction of the private provider assistant or a conversation result.
const fixture = {
  firstMessage: '{% assign day = "now" | date: "%w", "Europe/London" %}',
  model: { provider: "openai", model: "gpt-4.1", messages: [
    { role: "system", content: 'Current time {{"now" | date: "%H:%M", "Europe/London"}}.' },
  ] },
};
const tools = [
  { type: "transferCall", function: { name: "Route-Call-to-Drummond-Team-20260929" } },
  { type: "handoff", function: { name: "Route-Emergency-to-Rob-or-Tony" } },
];
const payloads = launchScenarioPayloads(tools, fixture);
assert.equal(payloads.length, 12, "The reviewed suite must have exactly twelve scenarios.");
assert.equal(new Set(payloads.map(p => p.name)).size, 12, "Scenario names must be distinct.");
assert.equal(new Set(payloads.flatMap(p => p.evaluations.map(e => e.structuredOutput.name))).size, 24,
  "Each scenario needs distinct quality and routing criteria.");
const allowedClocks = Object.values(testClocks).map(clock => JSON.stringify(clockOverrides(fixture, clock)));
const scenarios = payloads.map((payload, index) => {
  assertSafeScenario(payload, tools, fixture);
  assert.ok(allowedClocks.includes(JSON.stringify(payload.targetOverrides)), `Unreviewed clock: ${payload.name}`);
  assert.equal(payload.toolMocks.length, tools.length, `Unmocked external action: ${payload.name}`);
  assert.ok(payload.toolMocks.every(mock => mock.enabled === true &&
    /No real person was called and no message or email was delivered/.test(mock.result)),
  `Unbounded mock result: ${payload.name}`);
  assert.equal(payload.evaluations.length, 2, `Incomplete rubric: ${payload.name}`);
  assert.ok(payload.evaluations.every(rule => rule.required === true && rule.value === true &&
    rule.comparator === "=" && rule.structuredOutput.schema.type === "boolean"),
  `Weakened rubric: ${payload.name}`);
  return {
    index: index + 1, name: payload.name, payloadSha256: sha256(JSON.stringify(payload)),
    staticPreflight: "passed", conversationalOutcome: "not_run", realPhoneOutcome: "not_run",
  };
});
const scenarioSuiteSha256 = sha256(JSON.stringify(payloads));
const manifest = {
  version: "emma-source-candidate/1",
  sourceCommit,
  candidateSourceSha256,
  scenarioRevision: LAUNCH_SCENARIO_REVISION,
  scenarioSuiteSha256,
  sourceFiles,
  results: scenarios,
  summary: {
    staticPreflight: "12/12 passed",
    conversationalOutcome: "not_run",
    realPhoneOutcome: "not_run",
    limitation: "The synthetic fixture validates scenario definitions against the unchanged source files. It does not run Emma or establish a provider candidate hash, conversation behavior, handset transfer, mailbox deposit, email or Slack delivery.",
  },
};
process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
