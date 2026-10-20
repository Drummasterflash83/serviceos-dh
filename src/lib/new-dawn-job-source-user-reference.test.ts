import assert from "node:assert/strict";
import test from "node:test";
import { parseJobSourceUserReference, readJobSourceUserReference } from "./new-dawn-job-source-user-reference.ts";

const scope = {
  tenant: "00000000-0000-4000-8000-000000000001",
  job: "00000000-0000-4000-8000-000000000002",
  actor: "00000000-0000-4000-8000-000000000003",
  sourceVersion: "00000000-0000-4000-8000-000000000004",
};
const row = {
  source_user_id: "7", name_on_job_receipt: "Source person",
  state: "source_record_retained", source_user_version_id: "00000000-0000-4000-8000-000000000008",
  source_user_captured_at: "2026-10-19T10:00:00Z", identity: "unverified", appointment: "unverified",
};
const receipt = {
  version: "new-dawn-job-source-user-reference/1", tenant_id: scope.tenant,
  job_id: scope.job, actor_id: scope.actor, job_source_version_id: scope.sourceVersion,
  connection_id: "00000000-0000-4000-8000-000000000005",
  job_detail_request_id: "00000000-0000-4000-8000-000000000006",
  job_detail_checked_at: "2026-10-19T09:00:00Z", audit_id: "00000000-0000-4000-8000-000000000007",
  scope: "source_identity_only", users: [row],
};

test("retained source user is only a source ID reference", () => {
  const result = parseJobSourceUserReference(receipt, scope);
  assert.equal(result.users[0].sourceId, "7");
  assert.equal(result.users[0].state, "source_record_retained");
  assert.equal(result.users[0].capturedAt, "2026-10-19T10:00:00Z");
  assert.equal("engineer" in result.users[0], false);
});

test("uncaptured and empty source users remain explicit, never become no-attendance claims", () => {
  const uncaptured = { ...row, state: "source_record_not_captured",
    source_user_version_id: null, source_user_captured_at: null };
  assert.equal(parseJobSourceUserReference({ ...receipt, users: [uncaptured] }, scope).users[0].state,
    "source_record_not_captured");
  assert.deepEqual(parseJobSourceUserReference({ ...receipt, users: [] }, scope).users, []);
});

test("foreign scope, duplicate identities and promoted attendance fail closed", () => {
  for (const value of [
    { ...receipt, tenant_id: "00000000-0000-4000-8000-000000000099" },
    { ...receipt, actor_id: "00000000-0000-4000-8000-000000000099" },
    { ...receipt, job_source_version_id: "00000000-0000-4000-8000-000000000099" },
    { ...receipt, users: [row, row] },
    { ...receipt, users: [{ ...row, appointment: "confirmed" }] },
    { ...receipt, users: [{ ...row, source_user_id: "7a" }] },
    { ...receipt, users: [{ ...row, state: "source_record_not_captured" }] },
  ]) assert.throws(() => parseJobSourceUserReference(value, scope), /could not be verified/);
});

test("read requests one audited job and validates the response", async () => {
  const calls: unknown[] = [];
  const result = await readJobSourceUserReference({ rpc: async (name, args) => {
    calls.push({ name, args }); return { data: receipt, error: null };
  } }, scope, "  Investigate source identity  ");
  assert.equal(result.auditId, receipt.audit_id);
  assert.deepEqual(calls, [{ name: "new_dawn_job_source_user_reference", args: {
    p_tenant: scope.tenant, p_job: scope.job, p_reason: "Investigate source identity",
  } }]);
});
