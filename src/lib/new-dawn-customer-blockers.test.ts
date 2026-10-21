import assert from "node:assert/strict";
import { test } from "node:test";
import { customerBlockedJobDetailKey, readCustomerBlockers } from "./new-dawn-customer-blockers.ts";

const tenant = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000002";
const customer = "00000000-0000-4000-8000-000000000003";
const connection = "00000000-0000-4000-8000-000000000004";
const version = "00000000-0000-4000-8000-000000000005";
const audit = "00000000-0000-4000-8000-000000000006";
const snapshot = new Date(Date.now() - 30_000).toISOString();
const payload = () => ({
  version: "new-dawn-customer-blockers/1", tenant_id: tenant, actor_id: actor,
  audit_id: audit, observed_at: new Date().toISOString(), snapshot_at: snapshot,
  linked_blocked_jobs: 1,
  groups: [{ customer_kind: "company", customer_id: customer,
    customer_name: "Example Company", on_hold: 1, pending: 0,
    jobs: [{ connection_id: connection, external_id: "123", source_version_id: version,
      source_observed_at: snapshot, status: "on_hold" }] }],
});

test("a confirmed customer job retains exact source keys for audited detail", () => {
  const result = readCustomerBlockers(payload(), tenant, actor);
  assert.equal(result.groups[0].name, "Example Company");
  const row = customerBlockedJobDetailKey(result.groups[0].jobs[0]);
  assert.equal(row.external_id, "123");
  assert.equal(row.source_version_id, version);
  assert.equal(row.identity_state, "reviewed_link");
  assert.equal(result.groups[0].jobs[0].sourceDescription, undefined);
});

test("the current reader carries bounded saved work descriptions without classifying them", () => {
  const described: any = payload();
  described.version = "new-dawn-customer-blockers/2";
  described.groups[0].jobs[0].source_description = "For Invoicing";
  const result = readCustomerBlockers(described, tenant, actor);
  assert.equal(result.groups[0].jobs[0].sourceDescription, "For Invoicing");
  assert.equal(result.groups[0].jobs[0].status, "on_hold");
  described.groups[0].jobs[0].source_description = null;
  assert.equal(readCustomerBlockers(described, tenant, actor).groups[0].jobs[0].sourceDescription, null);
  described.groups[0].jobs[0].source_description = "🔧".repeat(160);
  assert.equal(readCustomerBlockers(described, tenant, actor).groups[0].jobs[0].sourceDescription,
    "🔧".repeat(160));
  const tooLong: any = payload();
  tooLong.version = "new-dawn-customer-blockers/2";
  tooLong.groups[0].jobs[0].source_description = "x".repeat(161);
  assert.throws(() => readCustomerBlockers(tooLong, tenant, actor));
  const invented: any = payload();
  invented.version = "new-dawn-customer-blockers/2";
  assert.throws(() => readCustomerBlockers(invented, tenant, actor));
});

test("a different tenant, stale read, or inconsistent job count is rejected", () => {
  assert.throws(() => readCustomerBlockers(payload(), actor, actor));
  const stale = payload();
  stale.observed_at = new Date(Date.now() - 360_000).toISOString();
  assert.throws(() => readCustomerBlockers(stale, tenant, actor));
  const incorrect = payload();
  incorrect.linked_blocked_jobs = 2;
  assert.throws(() => readCustomerBlockers(incorrect, tenant, actor));
});

test("duplicate jobs and statuses outside the held/pending scope are rejected", () => {
  const duplicated = payload();
  duplicated.groups[0].jobs.push({ ...duplicated.groups[0].jobs[0] });
  duplicated.groups[0].on_hold = 2;
  duplicated.linked_blocked_jobs = 2;
  assert.throws(() => readCustomerBlockers(duplicated, tenant, actor));

  const wrongStatus = payload();
  wrongStatus.groups[0].jobs[0].status = "open";
  assert.throws(() => readCustomerBlockers(wrongStatus, tenant, actor));
});
