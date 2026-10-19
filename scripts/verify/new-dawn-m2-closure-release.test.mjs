import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PROJECT } from "./new-dawn-m2-live-preflight.mjs";
import { VERSION, NAME, SOURCE_SHA256, reviewedSource, edgePin,
  assessStage, releaseSql, installLive, REVIEWED_EDGE_EZBR_SHA256 } from
  "./new-dawn-m2-closure-release.mjs";

const file = reviewedSource();
const prior = readFileSync(new URL(
  "../../supabase/migrations/20261107150000_new_dawn_commusoft_job_optional_source_facts.sql",
  import.meta.url), "utf8");
const pin = edgePin(6, REVIEWED_EDGE_EZBR_SHA256);
const snapshot = installed => ({
  project: { id: PROJECT, status: "ACTIVE_HEALTHY" },
  functions: [{ ...pin }],
  ledger: [
    { version: "20261107150000", name: "new_dawn_commusoft_job_optional_source_facts",
      statements: [prior] },
    ...(installed ? [{ version: VERSION, name: NAME, statements: [file.source] }] : []),
  ],
  catalog: [{
    function_sha256: installed
      ? "7c4bb1e4baf72f56935ed40dd441ea1cbd25412d205576583152677d7f4ce36c"
      : "8eb34ddd828420ea84f695b5a893ff9f9e4d1786537f36921aa9408370026090",
    permit_table: true, active_permits: 0, enabled_flags: 0,
  }],
});

test("source, ledger transaction and rollback fence are exact", () => {
  assert.equal(file.hash, SOURCE_SHA256);
  const sql = releaseSql(file);
  assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
  assert.match(sql, /closure_install_preflight_changed/);
  assert.match(sql, /insert into supabase_migrations\.schema_migrations/);
  assert.match(sql, /source_closure_facts/);
  assert.match(sql, /commit;$/);
  assert.match(releaseSql(file, true), /rollback;$/);
  assert.doesNotMatch(sql, /https?:\/\/|\/api\/v2\/|(?:insert into|update) public\.feature_flags/i);
});

test("v4-compatible Edge and malformed release pins cannot install v5 SQL", () => {
  assert.throws(() => edgePin(5, "a".repeat(64)), /compatible_edge_pin_required/);
  assert.throws(() => edgePin(6, "a".repeat(64)), /compatible_edge_pin_required/);
  assert.throws(() => edgePin(6, "eafe6d4310c3e6588c7e89f630890d5b14be2e18b6651062ba6d3d6549957bfa"));
  assert.throws(() => edgePin(6, "bad"));
  const old = snapshot(false);
  old.functions[0].version = 5;
  old.functions[0].ezbr_sha256 = "eafe6d4310c3e6588c7e89f630890d5b14be2e18b6651062ba6d3d6549957bfa";
  assert.throws(() => assessStage(old, false, pin), /edge_runtime_unconfirmed/);
});

test("preflight and installed readback require exact Edge, ledger, function and default-off state", () => {
  assert.equal(assessStage(snapshot(false), false, pin).state, "exact_closure_sql_ready");
  assert.equal(assessStage(snapshot(true), true, pin).state, "installed_default_off_readback");
  for (const change of [
    s => { s.project.id = "foreign"; },
    s => { s.functions[0].ezbr_sha256 = "0".repeat(64); },
    s => { s.functions[0].verify_jwt = true; },
    s => { s.functions.push({ ...pin }); },
    s => { s.ledger[0].statements[0] = "different predecessor"; },
    s => { s.ledger.push({ version: VERSION, name: NAME, statements: [file.source] }); },
    s => { s.catalog[0].function_sha256 = "0".repeat(64); },
    s => { s.catalog[0].active_permits = 1; },
    s => { s.catalog[0].enabled_flags = 1; },
  ]) {
    const state = structuredClone(snapshot(false));
    change(state);
    assert.throws(() => assessStage(state, false, pin));
  }
  const changed = snapshot(true);
  changed.ledger[1].statements[0] = "changed closure fact";
  assert.throws(() => assessStage(changed, true, pin), /receipt_changed/);
});

test("one acknowledged install needs exact post-write ledger and function readback", async () => {
  let reads = 0, writes = 0;
  const result = await installLive({ token: "fixture", pin,
    read: async () => snapshot(++reads === 2),
    write: async sql => {
      writes++;
      assert.match(sql, /commit;$/);
      return [{ installed_closure_version: VERSION }];
    } });
  assert.equal(result.state, "installed_default_off_readback");
  assert.equal(result.ledgerReadbackVerified, true);
  assert.equal(result.writeAcknowledged, true);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
});

test("uncertain write is never replayed or accepted without exact readback", async () => {
  let reads = 0, writes = 0;
  const result = await installLive({ token: "fixture", pin,
    read: async () => snapshot(++reads === 2),
    write: async () => { writes++; throw Error("connection_lost_after_commit"); } });
  assert.equal(result.writeAcknowledged, false);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
  writes = 0;
  await assert.rejects(() => installLive({ token: "fixture", pin,
    read: async () => snapshot(false),
    write: async () => { writes++; throw Error("connection_lost_after_commit"); } }),
  /outcome_unverified_no_replay/);
  assert.equal(writes, 1);
});
