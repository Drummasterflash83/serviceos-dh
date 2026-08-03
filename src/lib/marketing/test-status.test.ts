import assert from "node:assert/strict";
import test from "node:test";

import { canCancelTest, customerTestStatus } from "./test-status.ts";

test("a queued test in a non-sending mode is honestly paused, not lost", () => {
  const st = customerTestStatus({ status: "queued", modePermitsSend: false });
  assert.equal(st.key, "paused_by_mode");
  assert.equal(st.tone, "warn");
  assert.match(st.hint, /nothing leaves the platform/i);
  assert.equal(st.terminal, false);
});

test("a queued test in a sending mode is simply waiting", () => {
  const st = customerTestStatus({ status: "queued", modePermitsSend: true });
  assert.equal(st.key, "requested");
  assert.equal(st.terminal, false);
});

test("submitted means provider acceptance, never inbox delivery", () => {
  const st = customerTestStatus({ status: "submitted", modePermitsSend: true });
  assert.equal(st.key, "submitted");
  assert.equal(st.label, "Submitted to provider");
  assert.match(st.hint, /not inbox proof/i);
  assert.equal(st.terminal, true);
});

test("a cancelled intent reads as withdrawn, wherever it surfaces", () => {
  for (const status of ["queued", "failed"] as const) {
    const st = customerTestStatus({
      status,
      intent_status: "cancelled",
      modePermitsSend: false,
    });
    assert.equal(st.key, "cancelled");
    assert.match(st.hint, /Nothing was sent/);
  }
});

test("failed and unknown keep their honest terminal meanings", () => {
  assert.equal(customerTestStatus({ status: "failed", modePermitsSend: true }).key, "failed");
  const unknown = customerTestStatus({ status: "unknown", modePermitsSend: true });
  assert.equal(unknown.key, "unknown");
  assert.match(unknown.hint, /never be silently re-sent/i);
});

test("executing reads as processing", () => {
  assert.equal(
    customerTestStatus({ status: "executing", modePermitsSend: true }).key,
    "processing",
  );
});

test("cancel is offered ONLY for a queued, never-attempted test", () => {
  assert.equal(
    canCancelTest({ status: "queued", intent_status: "pending", intent_attempts: 0 }),
    true,
  );
  // a freshly recorded delivery may not have joined intent facts yet — treat
  // missing facts as the pending/zero defaults the server will re-prove anyway
  assert.equal(canCancelTest({ status: "queued" }), true);
});

test("cancel is never offered once the engine may own the work", () => {
  // executing / terminal deliveries are out of reach
  for (const status of ["executing", "submitted", "failed", "unknown"] as const) {
    assert.equal(canCancelTest({ status, intent_status: "pending", intent_attempts: 0 }), false);
  }
  // a claimed/executing/cancelled intent bars withdrawal even while queued
  for (const intent of ["claimed", "executing", "succeeded", "cancelled", "failed"]) {
    assert.equal(
      canCancelTest({ status: "queued", intent_status: intent, intent_attempts: 0 }),
      false,
    );
  }
  // attempted work (retrying) can no longer be withdrawn
  assert.equal(
    canCancelTest({ status: "queued", intent_status: "pending", intent_attempts: 1 }),
    false,
  );
});
