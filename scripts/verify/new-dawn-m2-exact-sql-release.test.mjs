import test from "node:test";
import assert from "node:assert/strict";
import { ENDPOINTS, PROJECT, TENANT } from "./new-dawn-m2-live-preflight.mjs";
import { applyNext, assessStage, releaseSql, sources, testRollbackSql } from
  "./new-dawn-m2-exact-sql-release.mjs";

const files = sources();
const now = Date.now();
function snapshot(stage = 0) {
  return {
    project: { id: PROJECT, status: "ACTIVE_HEALTHY" },
    functions: ENDPOINTS.map((pin, i) => ({ slug: pin.name, id: pin.id,
      version: i === 0 ? pin.version + 1 : pin.version,
      ezbr_sha256: i === 0 ? "a".repeat(64) : pin.hash,
      verify_jwt: pin.jwt, status: "ACTIVE", updated_at: now - 181000 })),
    ledger: files.slice(0, stage).map(file => ({ version: file.version,
      name: file.name, statements: [file.source] })),
    flags: [], queue: [{ active_import: true }],
    schema: [{ lease_columns: stage >= 1, lease_acquire: stage >= 1,
      manual_release: stage >= 2, yield_job: stage >= 3 }],
    health: [{ pre_activation_running: 0, recent_retrying: 0,
      recent_dead_letter: 0, completed_since: 2 }],
  };
}

test("only exact ordered receipts and absent flags pass each stage", () => {
  for (let stage = 0; stage <= 3; stage++)
    assert.equal(assessStage(snapshot(stage), stage, files, now).stage, stage);
  const wrongReceipt = snapshot(1);
  wrongReceipt.ledger[0].statements = ["same name, different SQL"];
  assert.throws(() => assessStage(wrongReceipt, 1, files, now), /receipt_changed/);
  const wrongSchema = snapshot(2); wrongSchema.schema[0].manual_release = false;
  assert.throws(() => assessStage(wrongSchema, 2, files, now), /schema_stage_changed/);
  const flagged = snapshot(0); flagged.flags = [{ flag: "new_dawn.m2_commusoft_coexistence" }];
  assert.throws(() => assessStage(flagged, 0, files, now), /flags_not_absent/);
  const workerFailed = snapshot(0); workerFailed.health[0].recent_retrying = 1;
  assert.throws(() => assessStage(workerFailed, 0, files, now), /worker_first_gate_not_ready/);
});

test("one file per release transaction, exact ledger receipt and no broad migration command", () => {
  for (let stage = 0; stage < 3; stage++) {
    const sql = releaseSql(files[stage], stage, files);
    assert.match(sql, /^begin;\n/);
    assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
    assert.match(sql, /insert into supabase_migrations\.schema_migrations\(version,name,statements\)/);
    assert.match(sql, /\ncommit;$/);
    assert.equal(sql.match(/insert into supabase_migrations\.schema_migrations/g)?.length, 1);
    assert.ok(sql.includes(files[stage].source.replaceAll("'", "''")));
    assert.ok(!sql.includes("db push"));
  }
  assert.throws(() => releaseSql(files[2], 0, files), /out_of_order/);
  const rollback = testRollbackSql(files);
  assert.match(rollback, /\nrollback;$/);
  assert.equal(rollback.match(/insert into supabase_migrations\.schema_migrations/g)?.length, 3);
  assert.ok(rollback.includes(TENANT));
});

test("unknown write result is read back once and never replayed", async () => {
  let reads = 0, writes = 0;
  const result = await applyNext({ project: PROJECT, version: files[0].version, token: "synthetic",
    read: async () => snapshot(reads++),
    write: async () => { writes++; throw Error("connection_lost_after_commit"); } });
  assert.equal(result.state, "exact_migration_installed");
  assert.equal(result.writeAcknowledged, false);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
  reads = 0; writes = 0;
  await assert.rejects(applyNext({ project: PROJECT, version: files[0].version, token: "synthetic",
    read: async () => snapshot(0),
    write: async () => { writes++; throw Error("connection_lost"); } }),
  /write_outcome_unverified_no_replay/);
  assert.equal(writes, 1);
  await assert.rejects(applyNext({ project: PROJECT, version: files[1].version, token: "synthetic",
    read: async () => snapshot(0), write: async () => { writes++; } }),
  /migration_ledger_prefix_changed/);
  assert.equal(writes, 1);
});
