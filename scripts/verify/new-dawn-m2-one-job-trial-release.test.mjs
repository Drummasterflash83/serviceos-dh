import assert from "node:assert/strict";
import test from "node:test";
import { assessStage, installLive, NAME, releaseSql, reviewedSource, SOURCE_SHA256, VERSION } from
  "./new-dawn-m2-one-job-trial-release.mjs";

const catalog = installed => ({ permit_table: installed, arm: installed,
  disarm: installed, offer: installed, current: installed, auth_offer: installed,
  anon_offer: false, auth_arm: false, service_arm: false, permit_count: 0, broad_flags: 0 });
const snapshot = installed => ({ runtime: { state: "installed_default_off_readback",
  flagsPresent: [], activeImport: true },
  catalog: [catalog(installed)], ledger: installed ? [{ version: VERSION, name: NAME,
    statements: [reviewedSource().source] }] : [] });

test("source is SHA-pinned and release SQL installs one full-source ledger receipt", () => {
  const source = reviewedSource();
  assert.equal(source.hash, SOURCE_SHA256);
  const sql = releaseSql(source);
  assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
  assert.match(sql, /trial_install_preflight_changed/);
  assert.match(sql, /insert into supabase_migrations\.schema_migrations\(version,name,statements\)/);
  assert.match(sql, /commit;$/);
  assert.match(releaseSql(source, true), /rollback;$/);
});
test("installer stages require exact ledger, grants, absent broad flags and no permits", () => {
  assert.equal(assessStage(snapshot(false), false).state, "exact_trial_sql_ready");
  assert.equal(assessStage(snapshot(true), true).state, "installed_default_off_no_permit");
  const wrongLedger = snapshot(true); wrongLedger.ledger[0].statements = ["different"];
  assert.throws(() => assessStage(wrongLedger, true), /receipt_changed/);
  const armed = snapshot(true); armed.catalog[0].permit_count = 1;
  assert.throws(() => assessStage(armed, true), /catalog_unverified/);
  const broad = snapshot(false); broad.catalog[0].broad_flags = 1;
  assert.throws(() => assessStage(broad, false), /catalog_unverified/);
  const access = snapshot(true); access.catalog[0].service_arm = true;
  assert.throws(() => assessStage(access, true), /grant_changed/);
});
test("unknown install response is read back once and never replayed", async () => {
  let reads = 0; let writes = 0;
  const installed = await installLive({ token: "synthetic", read: async () => {
    reads += 1; return snapshot(reads === 2);
  }, write: async () => { writes += 1; throw Error("response_lost"); } });
  assert.equal(installed.ledgerReadbackVerified, true);
  assert.equal(installed.writeAcknowledged, false);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
  reads = 0; writes = 0;
  await assert.rejects(installLive({ token: "synthetic", read: async () => {
    reads += 1; return snapshot(false);
  }, write: async () => { writes += 1; throw Error("response_lost"); } }),
  /trial_install_outcome_unverified_no_replay/);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
});
