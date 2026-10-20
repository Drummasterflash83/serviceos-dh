import test from "node:test";
import assert from "node:assert/strict";
import { assessExactTrialPreflight, trialQueries } from "./new-dawn-m2-exact-trial-preflight.mjs";

const job = "31c65c2c-1729-4d2c-abcd-7649c7caa894";
const now = Date.parse("2026-10-19T20:00:00Z");
const snapshot = () => ({
  runtime: { state: "installed_default_off_readback", flagsPresent: [], activeImport: true },
  queue: [{ status: "queued", n: 1 }],
  lease: [{ active_leases: 0, manual_waiters: 0, quota_waits: 0 }],
  receipts: [{ active: 0, total: 0 }],
  permissions: [{ auth_start: true, anon_denied: true, service_acquire: true,
    auth_acquire_denied: true, service_finish: true, service_fail: true, eligible_admins: 1 }],
  baseFlags: [{ n: 2 }],
  job: [{ candidate_rows: 1, exact_scope: true, reviewed_link_count: 1,
    latest_tie_count: 1, selected_latest_count: 1,
    latest_observed_at: "2026-10-19T19:00:00Z" }],
});

test("scope builder accepts only a UUID and bounded numeric source ID", () => {
  const sql = trialQueries(job, "13164");
  assert.match(sql.job, /payload_id_type='number'/);
  assert.match(sql.job, /selected_latest_count/);
  assert.match(sql.job, /31c65c2c-1729-4d2c-abcd-7649c7caa894/);
  for (const id of ["001", "0", "9007199254740992", "1';select 1", "1".repeat(17)])
    assert.throws(() => trialQueries(job, id), /exact_trial_scope_invalid/);
  assert.throws(() => trialQueries("bad", "13164"), /exact_trial_scope_invalid/);
});

test("verified job remains held while queue and flags are off", () => {
  const result = assessExactTrialPreflight(snapshot(), now);
  assert.equal(result.state, "reviewed_job_preflight_verified_trial_not_enabled");
  assert.equal(result.sourceAgeHours, 1);
  assert.deepEqual(result.blockers,
    ["source_queue_active_coexistence_off", "exact_job_detail_flag_off"]);
  assert.equal(result.providerRequests, 0);
  const idle = snapshot(); idle.queue = []; idle.runtime.activeImport = false;
  assert.deepEqual(assessExactTrialPreflight(idle, now).blockers,
    ["exact_job_detail_flag_off"]);
});

test("exactly one disabled M5 opportunity row does not block a one-job read preflight", () => {
  const state = snapshot();
  state.runtime.flagsPresent = [{ flag: "new_dawn.m5_opportunities_probe", value: false }];
  assert.equal(assessExactTrialPreflight(state, now).providerRequests, 0);
  for (const rows of [
    [{ flag: "new_dawn.m5_opportunities_probe", value: true }],
    [{ flag: "new_dawn.exact_job_detail", value: false }],
    [{ flag: "new_dawn.m5_opportunities_probe", value: false },
      { flag: "new_dawn.exact_job_detail", value: false }],
  ]) {
    state.runtime.flagsPresent = rows;
    assert.throws(() => assessExactTrialPreflight(state, now), /runtime_not_default_off/);
  }
});

test("ambiguous source, changed gate, permit and active request fail closed", () => {
  const cases = [
    (s) => { s.job[0].latest_tie_count = 2; },
    (s) => { s.job[0].exact_scope = false; },
    (s) => { s.job[0].selected_latest_count = 0; },
    (s) => { s.job[0].latest_observed_at = "PRIVATE"; },
    (s) => { s.permissions[0].service_finish = false; },
    (s) => { s.runtime.flagsPresent = ["new_dawn.exact_job_detail"]; },
    (s) => { s.runtime.activeImport = false; },
  ];
  for (const change of cases) {
    const s = snapshot(); change(s);
    assert.throws(() => assessExactTrialPreflight(s, now));
  }
  const busy = snapshot(); busy.receipts[0].active = 1;
  busy.lease[0].active_leases = 1;
  assert.deepEqual(assessExactTrialPreflight(busy, now).blockers,
    ["source_queue_active_coexistence_off", "manual_request_already_active",
      "shared_credential_gate_busy", "exact_job_detail_flag_off"]);
});
