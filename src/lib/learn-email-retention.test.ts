import test from "node:test";
import assert from "node:assert/strict";
import {
  validEmailRetention,
  emailRetentionAction,
  type EmailRetention,
} from "./learn-email-retention.ts";
import { readCaptureHealth } from "./learn-operator-capture-health.ts";
const tenant = "00000000-0000-4000-8000-000000000001";
const evidence: EmailRetention = {
  version: "learn-email-retention/1",
  tenant_id: tenant,
  scope: "company",
  total: 6,
  available: 1,
  unavailable: 1,
  unverified: 4,
  unbound: 2,
  archived_versions: 8,
};
const page = {
  version: "learn-operator-capture-health/1",
  tenant_id: tenant,
  checked_at: "2026-10-11T20:00:00Z",
  rows: [],
  next_cursor: null,
};
test("retention evidence binds counts to one tenant without confusing prior versions with messages", async () => {
  assert.equal(validEmailRetention(evidence, tenant), true);
  const result = await readCaptureHealth(
    { rpc: async () => ({ data: { ...page, email_retention: evidence }, error: null }) },
    tenant,
  );
  assert.equal(result.email_retention?.archived_versions, 8);
  assert.equal(
    (await readCaptureHealth({ rpc: async () => ({ data: page, error: null }) }, tenant))
      .email_retention,
    undefined,
  );
});
test("cross-tenant, malformed, extra-field and inconsistent evidence cannot reach the operator", async () => {
  for (const change of [
    { tenant_id: "other" },
    { scope: "mailbox" },
    { version: "wrong" },
    { total: 7 },
    { available: -1 },
    { unbound: 5 },
    { archived_versions: 0.5 },
    { archived_versions: Number.MAX_SAFE_INTEGER + 1 },
    { unverified: undefined },
    { body: "PRIVATE" },
    { unbound: "2" },
  ]) {
    const wrong = { ...evidence, ...change };
    assert.equal(validEmailRetention(wrong, tenant), false);
    await assert.rejects(
      readCaptureHealth(
        { rpc: async () => ({ data: { ...page, email_retention: wrong }, error: null }) },
        tenant,
      ),
      /could not be verified/,
    );
  }
});
test("operator guidance distinguishes absence, missing observations, empty inventory and observed availability", () => {
  assert.match(emailRetentionAction(evidence), /remain retained/);
  assert.match(
    emailRetentionAction({ ...evidence, unavailable: 0 }),
    /Missing availability evidence/,
  );
  const empty = { ...evidence, total: 0, available: 0, unavailable: 0, unverified: 0, unbound: 0 };
  assert.match(emailRetentionAction(empty), /does not prove the provider mailbox is empty/);
  assert.match(
    emailRetentionAction({ ...empty, total: 1, available: 1 }),
    /last recorded observations/,
  );
});
