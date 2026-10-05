/** Production sender eligibility — pure policy tests, no I/O. */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  senderCanLaunchCampaign,
  senderCanRunSequence,
  type LaunchEligibleSender,
} from "./sender-eligibility.ts";

function sender(overrides: Partial<LaunchEligibleSender> = {}): LaunchEligibleSender {
  return {
    enabled: true,
    source_kind: "resend",
    readiness: { ready: true, state: "ready" },
    ...overrides,
  };
}

test("production-verified Resend senders are eligible", () => {
  const verified = sender();
  assert.equal(senderCanLaunchCampaign(verified), true);
  assert.equal(senderCanRunSequence(verified), true);
});

test("sandbox senders never appear in campaign or sequence builders", () => {
  const sandbox = sender({
    readiness: {
      ready: true,
      state: "sandbox_ready",
      sandbox: true,
      campaigns_blocked: true,
      sequences_blocked: true,
    },
  });
  assert.equal(senderCanLaunchCampaign(sandbox), false);
  assert.equal(senderCanRunSequence(sandbox), false);
});

test("channel-specific server blocks are honoured", () => {
  assert.equal(
    senderCanLaunchCampaign(
      sender({ readiness: { ready: true, state: "ready", campaigns_blocked: true } }),
    ),
    false,
  );
  assert.equal(
    senderCanRunSequence(
      sender({ readiness: { ready: true, state: "ready", sequences_blocked: true } }),
    ),
    false,
  );
});

test("disabled and unavailable senders are ineligible", () => {
  assert.equal(senderCanLaunchCampaign(sender({ enabled: false })), false);
  assert.equal(
    senderCanLaunchCampaign(sender({ readiness: { ready: true, state: "revoked" } })),
    false,
  );
  assert.equal(
    senderCanRunSequence(
      sender({ readiness: { ready: false, state: "revoked", authority_state: "revoked" } }),
    ),
    false,
  );
});

test("ready Gmail and Workspace senders remain eligible", () => {
  for (const source_kind of ["gmail_oauth", "workspace_dwd"] as const) {
    const verified = sender({ source_kind, readiness: { ready: true, state: "ready" } });
    assert.equal(senderCanLaunchCampaign(verified), true);
    assert.equal(senderCanRunSequence(verified), true);
  }
});
