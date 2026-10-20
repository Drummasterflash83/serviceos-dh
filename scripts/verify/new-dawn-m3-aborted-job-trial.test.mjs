import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECTION,
  EXTERNAL,
  JOB,
  OPERATOR,
  TENANT,
  VERSION,
  armOnce,
  armSql,
  assessDetail,
  assessReceipt,
  assessScope,
  disarmOnce,
  disarmSql,
  readDetail,
  readScope,
} from "./new-dawn-m3-aborted-job-trial.mjs";

const requestId = "decccccc-0000-4000-8000-000000000331";
const reason = "One exact source refresh for saved aborted closure";
const preflight = () => ({
  state: "reviewed_job_preflight_verified_trial_not_enabled",
  sourceObservedAt: "2026-10-13T16:20:19.832Z",
  activeImport: 0,
  activeRequests: 0,
  activeLeases: 0,
  manualWaiters: 0,
  quotaWaits: 0,
  blockers: ["exact_job_detail_flag_off"],
});
const scope = () => ({
  exact_aborted_source: 1,
  operator_grants: 1,
  view_as_active: 0,
  broad_flags_on: 0,
  active_permits: 0,
  request_rows: 0,
  arm_installed: true,
  disarm_installed: true,
  authenticated_offer: true,
  authenticated_arm: false,
  service_arm: false,
});
const receipt = (revoked = false) => ({
  request_id: requestId,
  tenant_id: TENANT,
  job_id: JOB,
  actor_id: OPERATOR,
  connection_id: CONNECTION,
  source_version_id: VERSION,
  external_id: EXTERNAL,
  armed_at: new Date(Date.now() - 15_000).toISOString(),
  expires_at: new Date(Date.now() + 4 * 60_000).toISOString(),
  used: false,
  revoked,
  arm_audits: 1,
  arm_reason: reason,
  disarm_audits: revoked ? 1 : 0,
  disarm_reason: revoked ? "Stop exact trial" : null,
});

test("the arm path is pinned to one job and requires current idle source and actor", () => {
  assert.equal(assessScope(preflight(), [scope()]).job, JOB);
  for (const change of [
    (p) => {
      p.activeImport = 1;
    },
    (p) => {
      p.activeLeases = 1;
    },
    (p) => {
      p.blockers = ["shared_credential_gate_busy"];
    },
  ]) {
    const p = preflight();
    change(p);
    assert.throws(() => assessScope(p, [scope()]), /scope_changed/);
  }
  for (const change of [
    (r) => {
      r.exact_aborted_source = 0;
    },
    (r) => {
      r.operator_grants = 0;
    },
    (r) => {
      r.view_as_active = 1;
    },
    (r) => {
      r.active_permits = 1;
    },
    (r) => {
      r.broad_flags_on = 1;
    },
    (r) => {
      r.authenticated_arm = true;
    },
  ]) {
    const row = scope();
    change(row);
    assert.throws(() => assessScope(preflight(), [row]), /scope_changed/);
  }
});

test("arm/disarm SQL fixes scope, five-minute expiry, reason and no provider request", () => {
  const sql = armSql(requestId, "Chris's exact review");
  for (const value of [TENANT, JOB, OPERATOR, VERSION, requestId]) assert.ok(sql.includes(value));
  assert.match(sql, /interval '5 minutes'/);
  assert.match(sql, /Chris''s exact review/);
  assert.doesNotMatch(sql, /http|fetch|learn_commusoft_job_detail/);
  assert.match(disarmSql(requestId, "Stop exact trial"), /new_dawn_commusoft_job_trial_disarm/);
  assert.throws(() => armSql("bad", reason), /request_id_invalid/);
  assert.throws(() => armSql(requestId, "line\nbreak"), /reason_required/);
});

test("read-only scope detects changing preflight before any permit write", async () => {
  let reads = 0;
  await assert.rejects(
    readScope(requestId, {
      token: "synthetic",
      preflight: async () => (++reads === 1 ? preflight() : { ...preflight(), activeImport: 1 }),
      read: async () => [scope()],
    }),
    /preflight_changed_during_read/,
  );
  assert.equal(reads, 2);
});

test("one uncertain arm is independently read back and never replayed", async () => {
  let writes = 0,
    reads = 0;
  const result = await armOnce(requestId, reason, {
    token: "synthetic",
    scope: async () => assessScope(preflight(), [scope()]),
    write: async () => {
      writes++;
      throw Error("lost acknowledgement");
    },
    read: async () => {
      reads++;
      return [receipt()];
    },
  });
  assert.equal(result.state, "exact_aborted_job_permit_armed");
  assert.equal(result.writeAcknowledged, false);
  assert.equal(writes, 1);
  assert.equal(reads, 1);
  await assert.rejects(
    armOnce(requestId, reason, {
      token: "synthetic",
      scope: async () => assessScope(preflight(), [scope()]),
      write: async () => {
        writes++;
        throw Error("unknown");
      },
      read: async () => {
        reads++;
        return [];
      },
    }),
    /arm_outcome_unverified_no_replay/,
  );
  assert.equal(writes, 2);
  assert.equal(reads, 2);
});

test("disarm requires this exact permit and a new audit readback", async () => {
  let reads = 0,
    writes = 0;
  const result = await disarmOnce(requestId, "Stop exact trial", {
    token: "synthetic",
    read: async () => (++reads === 1 ? [receipt()] : [receipt(true)]),
    write: async () => {
      writes++;
      throw Error("lost acknowledgement");
    },
  });
  assert.equal(result.state, "exact_aborted_job_permit_disarmed");
  assert.equal(result.writeAcknowledged, false);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
  const changed = receipt(true);
  changed.disarm_reason = "Different reason";
  assert.throws(
    () => assessReceipt([changed], requestId, true, "Stop exact trial"),
    /receipt_changed/,
  );
  const expired = receipt();
  expired.armed_at = new Date(Date.now() - 6 * 60_000).toISOString();
  expired.expires_at = new Date(Date.now() - 60_000).toISOString();
  assert.equal(assessReceipt([expired], requestId, false).revoked, false);
  assert.throws(
    () => assessReceipt([expired], requestId, false, null, { requireLive: true }),
    /receipt_changed/,
  );
});

test("receipt readback reveals only a bounded closure class and requires exact audit", async () => {
  const base = {
    request_id: requestId,
    tenant_id: TENANT,
    job_id: JOB,
    actor_id: OPERATOR,
    connection_id: CONNECTION,
    source_version_id: VERSION,
    external_id: EXTERNAL,
    receipt_exists: true,
    receipt_state: "complete",
    receipt_tenant: TENANT,
    receipt_job: JOB,
    receipt_actor: OPERATOR,
    receipt_connection: CONNECTION,
    receipt_version: VERSION,
    receipt_external: EXTERNAL,
    checked_at: new Date().toISOString(),
    raw_sha256: "a".repeat(64),
    result_version: "commusoft-exact-job-detail/5",
    closure_class: "aborted_recorded",
    request_audits: 1,
    complete_audits: 1,
  };
  const outcome = await readDetail(requestId, { token: "synthetic", read: async () => [base] });
  assert.equal(outcome.state, "complete");
  assert.equal(outcome.closureClass, "aborted_recorded");
  assert.equal(outcome.providerResultVerified, true);
  assert.ok(!JSON.stringify(outcome).includes("result_version"));
  assert.throws(
    () => assessDetail([{ ...base, receipt_job: "wrong" }], requestId),
    /detail_state_changed/,
  );
  assert.throws(
    () => assessDetail([{ ...base, complete_audits: 0 }], requestId),
    /detail_state_changed/,
  );
  assert.throws(
    () => assessDetail([{ ...base, result_version: "commusoft-exact-job-detail/4" }], requestId),
    /detail_state_changed/,
  );
  assert.equal(
    assessDetail(
      [
        {
          ...base,
          receipt_exists: false,
          receipt_state: "not_started",
          request_audits: 0,
          complete_audits: 0,
        },
      ],
      requestId,
    ).state,
    "not_started",
  );
});
