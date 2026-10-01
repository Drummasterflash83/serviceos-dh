import { test } from "node:test";
import assert from "node:assert/strict";
import {
  configurationChecks,
  assertSafeScenario,
  itemReport,
  runState,
  safeRecording,
} from "./receptionist-testing.ts";
const tool = {
  type: "transferCall",
  function: { name: "transfer" },
  destinations: [{ number: "+441794341600", extension: "601" }],
};
test("rejects duplicate transfer configuration and does not trust an extension to bypass the main line", () => {
  const checks = configurationChecks({ voice: {}, transcriber: {} }, [tool, tool], "+441794341600");
  assert.equal(checks.find((c) => c.key === "transfer_count")?.state, "failed");
  assert.equal(checks.find((c) => c.key === "main_loop")?.state, "failed");
  assert.equal(checks.find((c) => c.key === "delivery")?.state, "not_tested");
});
test("requires criteria, interceptions and no webhook or model overrides", () => {
  const s = {
    evaluations: [{}],
    toolMocks: [{ toolName: "transfer", enabled: true, result: "intercepted" }],
  };
  assert.doesNotThrow(() => assertSafeScenario(s, [tool]));
  assert.throws(() => assertSafeScenario({ ...s, evaluations: [] }, [tool]));
  assert.throws(() => assertSafeScenario({ ...s, toolMocks: [] }, [tool]));
  assert.throws(() => assertSafeScenario({ ...s, hooks: [{}] }, [tool]));
  assert.throws(() => assertSafeScenario({ ...s, targetOverrides: { model: {} } }, [tool]));
  assert.throws(() =>
    assertSafeScenario({ ...s, toolMocks: [{ toolName: "transfer", enabled: false }] }, [tool]),
  );
});
test("all evidence must pass; missing and partial results never turn green", () => {
  const item = itemReport({
    id: "x",
    status: "passed",
    results: { passed: true, evaluations: [{}] },
  });
  assert.equal(runState({ status: "ended", itemCounts: { total: 1 } }, [item]), "passed");
  assert.equal(runState({ status: "ended", itemCounts: { total: 2 } }, [item]), "failed");
  assert.equal(runState({ status: "ended" }, []), "failed");
  assert.equal(
    runState({ status: "ended" }, [itemReport({ status: "passed", results: { passed: true } })]),
    "failed",
  );
  assert.equal(runState({ status: "ended" }, [itemReport({ status: "canceled" })]), "cancelled");
  assert.equal(runState({ status: "queued" }, []), "running");
});
test("recording URLs reject arbitrary and non-HTTPS locations", () => {
  assert.equal(
    safeRecording("https://storage.vapi.ai/test.wav"),
    "https://storage.vapi.ai/test.wav",
  );
  for (const u of [
    "http://storage.vapi.ai/a",
    "https://vapi.ai.attacker.com/a",
    "javascript:alert(1)",
    "https://u:p@storage.vapi.ai/a",
  ])
    assert.equal(safeRecording(u), null);
});
