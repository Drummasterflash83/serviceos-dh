import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PROJECT } from "./new-dawn-m2-live-preflight.mjs";
import { EDGE, SOURCE_SHA256, VERSION, NAME, reviewedSource, assessStage,
  releaseSql, installLive } from "./new-dawn-m2-source-quote-release.mjs";

const file = reviewedSource();
const prior = readFileSync(new URL("../../supabase/migrations/20261107110000_new_dawn_commusoft_job_operational_facts.sql", import.meta.url), "utf8");
const snapshot = installed => ({
  project: { id: PROJECT, status: "ACTIVE_HEALTHY" },
  functions: [{ ...EDGE }],
  ledger: [
    { version: "20261107110000", name: "new_dawn_commusoft_job_operational_facts", statements: [prior] },
    ...(installed ? [{ version: VERSION, name: NAME, statements: [file.source] }] : []),
  ],
  catalog: [{
    function_sha256: installed
      ? "7652d2e4f669338cb75e9ccbc05f6322ee3dba1c3c783dca268fd640e2108853"
      : "a94b52567fc4d1a6e0109cf77ae832d8cabcd94a34a2c9408d13d7dea164b03f",
    permit_table: true, active_permits: 0, enabled_flags: 0,
  }],
});

test("reviewed quote source is exact and nested in one guarded ledger transaction", () => {
  assert.equal(file.hash, SOURCE_SHA256);
  const sql = releaseSql(file);
  assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
  assert.match(sql, /quote_install_preflight_changed/);
  assert.match(sql, /insert into supabase_migrations\.schema_migrations/);
  assert.match(sql, /source_quoted_amount/);
  assert.match(sql, /commit;$/);
  assert.match(releaseSql(file, true), /rollback;$/);
  assert.doesNotMatch(sql, /https?:\/\/|\/api\/v2\/|(?:insert into|update) public\.feature_flags/i);
});

test("LIVE preflight and readback pin Edge, predecessor, function and default-off state", () => {
  assert.equal(assessStage(snapshot(false), false).state, "exact_quote_sql_ready");
  assert.equal(assessStage(snapshot(true), true).state, "installed_default_off_readback");
  for (const change of [
    s => { s.project.id = "foreign"; },
    s => { s.functions[0].ezbr_sha256 = "0".repeat(64); },
    s => { s.functions[0].verify_jwt = true; },
    s => { s.functions.push({ ...EDGE }); },
    s => { s.ledger[0].statements[0] = "different v2"; },
    s => { s.ledger.push({ version: VERSION, name: NAME, statements: [file.source] }); },
    s => { s.catalog[0].function_sha256 = "0".repeat(64); },
    s => { s.catalog[0].active_permits = 1; },
    s => { s.catalog[0].enabled_flags = 1; },
  ]) {
    const state = structuredClone(snapshot(false));
    change(state);
    assert.throws(() => assessStage(state, false));
  }
  const changed = snapshot(true);
  changed.ledger[1].statements[0] = "changed quote";
  assert.throws(() => assessStage(changed, true), /receipt_changed/);
});

test("one acknowledged install needs exact post-write ledger and function readback", async () => {
  let reads = 0, writes = 0;
  const result = await installLive({ token: "fixture", read: async () => snapshot(++reads === 2),
    write: async sql => {
      writes++;
      assert.match(sql, /commit;$/);
      return [{ installed_quote_version: VERSION }];
    } });
  assert.equal(result.state, "installed_default_off_readback");
  assert.equal(result.ledgerReadbackVerified, true);
  assert.equal(result.writeAcknowledged, true);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
});

test("uncertain write is never replayed or accepted without exact readback", async () => {
  let reads = 0, writes = 0;
  const result = await installLive({ token: "fixture", read: async () => snapshot(++reads === 2),
    write: async () => { writes++; throw Error("connection_lost_after_commit"); } });
  assert.equal(result.writeAcknowledged, false);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
  writes = 0;
  await assert.rejects(() => installLive({ token: "fixture", read: async () => snapshot(false),
    write: async () => { writes++; throw Error("connection_lost_after_commit"); } }),
  /outcome_unverified_no_replay/);
  assert.equal(writes, 1);
});
