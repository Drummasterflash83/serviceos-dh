import assert from "node:assert/strict";
import test from "node:test";

import { friendlySignInError } from "./auth-errors.ts";

test("quota restrictions explain that credentials are not at fault", () => {
  const result = friendlySignInError(
    "Service for this project is restricted due to the following violations: exceed_egress_quota. The project owner must upgrade their plan or remove spend caps to restore service.",
  );

  assert.match(result ?? "", /temporarily unavailable/i);
  assert.match(result ?? "", /account and password are not the problem/i);
  assert.doesNotMatch(result ?? "", /supabase|egress|spend cap/i);
});

test("invalid credentials receive concise customer-facing copy", () => {
  assert.equal(
    friendlySignInError("Invalid login credentials"),
    "The email address or password is incorrect.",
  );
});

test("unknown provider messages are not exposed", () => {
  const raw = "internal provider detail that should not be shown";
  const result = friendlySignInError(raw);

  assert.ok(result);
  assert.notEqual(result, raw);
});

test("an absent error remains absent", () => {
  assert.equal(friendlySignInError(null), null);
});
