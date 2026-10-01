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
test("tool evidence keeps distinct invocations, not transcript repetitions or unrelated arguments", () => {
  const item = itemReport({
    metadata: {
      call: {
        transcript: "intercepted\nintercepted",
        messages: [
          {
            role: "assistant",
            tool_calls: [
              {
                id: "one",
                function: {
                  name: "transfer",
                  arguments: '{"destination":"+441794378095","secret":"omit"}',
                },
              },
            ],
          },
          { role: "tool", content: "intercepted" },
          {
            role: "assistant",
            toolCalls: [{ id: "two", function: { name: "transfer", arguments: "invalid" } }],
          },
        ],
      },
    },
  });
  assert.deepEqual(item.toolEvents, [
    { id: "one", name: "transfer", destination: "+441794378095" },
    { id: "two", name: "transfer", destination: null },
  ]);
  assert.deepEqual(itemReport({}).toolEvents, []);
});
test("repeated ordinary transfers override an AI judge pass; funding is not a wording failure", () => {
  const event = (id: string) => ({
    id,
    function: {
      name: "Route-Call-to-Drummond-Team-20260929",
      arguments: '{"destination":"+441794840043"}',
    },
  });
  const report = (ids: string[]) =>
    itemReport({
      status: "passed",
      results: { passed: true, evaluations: [{}] },
      metadata: { call: { messages: [{ tool_calls: ids.map(event) }] } },
    });
  assert.equal(report(["one", "two"]).passed, false);
  assert.equal(report(["one", "two"]).outcome, "repeated_transfer");
  assert.equal(report(["one", "one"]).passed, true);
  assert.equal(
    itemReport({ failureReason: "Your Wallet Balance is -0.07" }).outcome,
    "blocked_funding",
  );
  assert.notEqual(
    itemReport({ callId: "a", failureReason: "wallet balance" }).outcome,
    "blocked_funding",
  );
});
test("repeated handover wording cannot be hidden by a provider pass", () => {
  const report = (transcript: string) =>
    itemReport({
      status: "passed",
      results: { passed: true, evaluations: [{}] },
      metadata: { call: { transcript } },
    });
  const duplicate = report(
    "AI: I'll put you through to the sales mailbox. I'll put you through to the sales voicemail now.",
  );
  assert.equal(duplicate.passed, false);
  assert.equal(duplicate.outcome, "repeated_announcement");
  assert.equal(
    report("AI: I'll try Rob now.\nUser: No answer.\nAI: I'll try Tony now.").passed,
    true,
  );
  assert.equal(report("User: I'll transfer you. I'll transfer you.\nAI: Goodbye.").passed, true);
});
