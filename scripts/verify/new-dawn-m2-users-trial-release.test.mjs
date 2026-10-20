import assert from "node:assert/strict";
import test from "node:test";
import {
  FILES, POST, assessStage, installLive, releaseSql, reviewedFiles,
} from "./new-dawn-m2-users-trial-release.mjs";
import {
  RELEASE_WORKER, VERSION as BACKEND_VERSION, NAME as BACKEND_NAME,
  SOURCE_SHA256 as BACKEND_SHA, RESUME_VERSION as BACKEND_RESUME_VERSION,
  RESUME_NAME as BACKEND_RESUME_NAME, RESUME_SOURCE_SHA256 as BACKEND_RESUME_SHA,
} from "./new-dawn-m2-users-backend-release.mjs";

const BASE = {
  control: "a07f6f4ad60bde24b207935a65fb06c192d86d11c4926b969a38685d015a2a32",
  input: "cf69a0e32538fc0e025350e523b6309527ab4a4db416a5caff770047e3988f65",
  resume: "026cd89cc1e83a16419d5a1453e7c2e780599762a0371c1ce822e71cc6a3682e",
};
function snapshot(installed = false) {
  const catalog = {
    ledger: [
      { version: BACKEND_VERSION, name: BACKEND_NAME, hash: BACKEND_SHA, statements: 1 },
      { version: BACKEND_RESUME_VERSION, name: BACKEND_RESUME_NAME,
        hash: BACKEND_RESUME_SHA, statements: 1 },
      ...(installed ? FILES.map(file => ({ version: file.version, name: file.name,
        hash: file.sha256, statements: 1 })) : []),
    ],
    base_flags: 2, users_flag_bad: 0, users_versions: 0, active_jobs: 1,
    unsafe_jobs: 0, open_arms: 0,
    recurring: [{ enabled: true, phase: 3, current_request: "00000000-0000-4000-8000-000000000009",
      last_state: "window_active", connection_ok: true }],
  };
  for (const key of Object.keys(POST)) {
    catalog[`${key}_hash`] = installed ? POST[key] : BASE[key] ?? null;
    catalog[`${key}_anon`] = false;
    catalog[`${key}_auth`] = installed ? !["active", "allowed"].includes(key) : key in BASE;
    catalog[`${key}_service`] = false;
  }
  return { project: { id: "tgbnakbxwcqjeimygroz", status: "ACTIVE_HEALTHY" },
    functions: [{ ...RELEASE_WORKER, ezbr_sha256: RELEASE_WORKER.hash,
      status: "ACTIVE", verify_jwt: true }], catalog: [catalog] };
}

test("pinned source and default-Off LIVE stages", () => {
  assert.equal(reviewedFiles().length, 2);
  assert.equal(assessStage(snapshot()).state, "exact_trial_sql_ready");
  assert.equal(assessStage(snapshot(true), true).state, "installed_default_off_readback");
  for (const mutate of [
    s => { s.catalog[0].unsafe_jobs = 1; },
    s => { s.catalog[0].users_flag_bad = 1; },
    s => { s.catalog[0].open_arms = 1; },
    s => { s.catalog[0].recurring[0].last_state = "source_user_trial_paused"; },
    s => { s.catalog[0].recurring[0].current_request = null; },
    s => { s.catalog[0].input_hash = "0".repeat(64); },
    s => { s.catalog[0].control_auth = false; },
    s => { s.catalog[0].ledger[1].hash = "0".repeat(64); },
    s => { s.functions[0].version++; },
  ]) {
    const changed = snapshot(); mutate(changed);
    assert.throws(() => assessStage(changed));
  }
});

test("single transaction rechecks exact ledger, function, grant and job gates", () => {
  const sql = releaseSql();
  assert.match(sql, /^begin;\n/);
  assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
  assert.match(sql, /learn-input-setup:00000000-0000-0000-0000-000000000001/);
  assert.match(sql, /users_trial_release_preflight_changed/);
  assert.match(sql, /users_trial_release_postflight_changed/);
  assert.match(sql, /c\.unsafe_jobs<>0/);
  assert.match(sql, /c\.restore_auth is distinct from false/);
  assert.match(sql, /or not c\.restore_auth/);
  assert.match(sql, /or c\.allowed_auth/);
  assert.match(sql, /insert into supabase_migrations\.schema_migrations\(version,name,statements\) values/);
  for (const file of FILES) assert.ok(sql.includes(file.version));
  assert.match(sql, /\ncommit;$/);
  assert.match(releaseSql(reviewedFiles(), true), /\nrollback;$/);
  assert.doesNotMatch(sql, /\/api\/v2\/users/);
});

test("unknown LIVE install response is read once and never replayed", async () => {
  let reads = 0, writes = 0;
  const result = await installLive({ token: "synthetic",
    rehearse: async () => ({ state: "test_rollback_verified" }),
    read: async () => (++reads === 1 ? snapshot() : snapshot(true)),
    write: async () => { writes++; throw Error("transport_unknown"); } });
  assert.equal(result.state, "installed_default_off_readback");
  assert.equal(result.acknowledged, false);
  assert.equal(reads, 2); assert.equal(writes, 1);
  reads = 0; writes = 0;
  await assert.rejects(installLive({ token: "synthetic",
    rehearse: async () => ({ state: "test_rollback_verified" }),
    read: async () => { reads++; return snapshot(); },
    write: async () => { writes++; throw Error("transport_unknown"); } }),
  /trial_release_outcome_unverified_no_replay/);
  assert.equal(reads, 2); assert.equal(writes, 1);
});
