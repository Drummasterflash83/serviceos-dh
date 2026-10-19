import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PROJECT } from "./new-dawn-m2-live-preflight.mjs";
import { SOURCE_SHA256, VERSION, NAME, reviewedSource, assessStage, releaseSql, installLive } from
  "./new-dawn-m2-operational-facts-release.mjs";

const file = reviewedSource();
const trialSource = readFileSync(new URL("../../supabase/migrations/20261107010000_new_dawn_commusoft_one_job_trial_permit.sql", import.meta.url), "utf8");
const base = [
  { version: "20261107010000", name: "new_dawn_commusoft_one_job_trial_permit", statements: [trialSource] },
];
const snapshot = installed => ({
  project: { id: PROJECT, status: "ACTIVE_HEALTHY" },
  ledger: installed ? [...base, { version: VERSION, name: NAME, statements: [file.source] }] : base,
  catalog: [{ finish_present: true, finish_v1: !installed, finish_v2: installed,
    permit_table: true, active_permits: 0, enabled_flags: 0 }],
});

test("only the reviewed one-file hash and transaction fences are released", () => {
  assert.equal(file.hash, SOURCE_SHA256);
  const sql = releaseSql(file);
  assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
  assert.match(sql, /operational_install_preflight_changed/);
  assert.match(sql, /insert into supabase_migrations\.schema_migrations/);
  assert.match(sql, /commusoft-exact-job-detail\/2/);
  assert.match(sql, /commit;$/);
  assert.match(releaseSql(file, true), /rollback;$/);
  assert.doesNotMatch(sql, /https?:\/\/|\/api\/v2\/|alter\s+role/i);
});

test("preflight and readback require exact ledger, function marker, no active permit and flags off", () => {
  assert.equal(assessStage(snapshot(false), false).state, "exact_operational_sql_ready");
  assert.equal(assessStage(snapshot(true), true).state, "installed_default_off_readback");
  for (const mutate of [
    s => { s.catalog[0].active_permits = 1; },
    s => { s.catalog[0].enabled_flags = 1; },
    s => { s.catalog[0].finish_v1 = false; },
    s => { s.project.id = "other"; },
    s => { s.ledger.pop(); },
  ]) {
    const s = structuredClone(snapshot(false)); mutate(s);
    assert.throws(() => assessStage(s, false));
  }
  const changed = snapshot(true);
  changed.ledger[1].statements[0] = "changed";
  assert.throws(() => assessStage(changed, true), /receipt_changed/);
});

test("install writes once and verifies an exact post-write receipt", async () => {
  let reads = 0, writes = 0;
  const result = await installLive({ token: "fixture", read: async () => snapshot(++reads === 2),
    write: async sql => { writes++; assert.match(sql, /commit;$/); return [{ installed_operational_version: VERSION }]; } });
  assert.equal(result.state, "installed_default_off_readback");
  assert.equal(result.ledgerReadbackVerified, true);
  assert.equal(reads, 2); assert.equal(writes, 1);
});

test("uncertain write never retries and cannot be claimed without exact readback", async () => {
  let reads = 0, writes = 0;
  const result = await installLive({ token: "fixture", read: async () => snapshot(++reads === 2),
    write: async () => { writes++; throw Error("network_lost_after_commit"); } });
  assert.equal(result.writeAcknowledged, false);
  assert.equal(reads, 2); assert.equal(writes, 1);
  reads = 0; writes = 0;
  await assert.rejects(() => installLive({ token: "fixture", read: async () => snapshot(false),
    write: async () => { writes++; throw Error("network_lost_after_commit"); } }),
  /outcome_unverified_no_replay/);
  assert.equal(writes, 1);
});
