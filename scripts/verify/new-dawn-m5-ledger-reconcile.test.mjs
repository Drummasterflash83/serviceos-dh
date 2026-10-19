import assert from "node:assert/strict";
import test from "node:test";
import {
  assessCatalog,
  exactLedger,
  FUNCTION_HASHES,
  LIVE_PROJECT,
  NAME,
  reconciliationSql,
  reconcileLive,
  SCHEMA_SHA256,
  SOURCE_SHA256,
  source,
  testRehearsalSql,
  VERSION,
} from "./new-dawn-m5-ledger-reconcile.mjs";

test("reviewed source and exact single ledger receipt", () => {
  const text = source();
  assert.match(text, /create table public\.new_dawn_commusoft_opportunity_probes/);
  assert.match(text, /\ncommit;\s*$/);
  assert.equal(exactLedger([{ version: VERSION, name: NAME, statements: [text] }]), true);
  assert.equal(exactLedger([{ version: VERSION, name: NAME, statements: ["other"] }]), false);
  assert.equal(exactLedger([{ version: VERSION, name: NAME, statements: [text, text] }]), false);
  assert.equal(exactLedger([]), false);
  assert.match(SOURCE_SHA256, /^[a-f0-9]{64}$/);
});

test("ledger transaction is single-row, exact-catalogue guarded and rehearsal rolls back", () => {
  const sql = reconciliationSql();
  assert.match(sql, /^begin;\n/);
  assert.match(
    sql,
    /lock table supabase_migrations\.schema_migrations in share row exclusive mode/,
  );
  assert.match(sql, /lock table public\.new_dawn_commusoft_opportunity_probes,/);
  assert.match(sql, /from \(values[\s\S]+\) expected\(signature,digest\)/);
  assert.equal(Object.keys(FUNCTION_HASHES).length, 10);
  for (const hash of Object.values(FUNCTION_HASHES)) assert.ok(sql.includes(hash));
  assert.equal(sql.match(/insert into supabase_migrations\.schema_migrations/g)?.length, 1);
  const beforeReceipt = sql.slice(
    0,
    sql.indexOf("insert into supabase_migrations.schema_migrations"),
  );
  assert.doesNotMatch(
    beforeReceipt,
    /\b(?:create|alter|drop|update|delete|truncate)\s+(?:table\s+)?public\./i,
  );
  assert.match(sql, /\ncommit;$/);
  assert.match(reconciliationSql(source(), true), /\nrollback;$/);
  const rehearsal = testRehearsalSql();
  assert.match(rehearsal, /new-dawn-m5-ledger-test\/1/);
  assert.match(rehearsal, /\nrollback;$/);
  assert.throws(() => reconciliationSql("different"), /m5_source_changed/);
});

test("catalog assessment refuses a missing or altered installed contract", () => {
  assert.throws(() => assessCatalog(null), /scope_changed/);
  assert.throws(
    () => assessCatalog({ functions: [], tables: [], flag_count: 0, receipt_count: 0, ledger: [] }),
    /scope_changed/,
  );
  assert.throws(
    () =>
      assessCatalog({
        functions: Object.keys(FUNCTION_HASHES).map((signature) => ({
          signature,
          sha256: "0".repeat(64),
        })),
        tables: [{}, {}],
        flag_count: 0,
        receipt_count: 0,
        ledger: [],
      }),
    /function_hashes_changed/,
  );
});

test("uncertain LIVE write is read back once and never replayed", async () => {
  const text = source();
  let writes = 0,
    afterReads = 0;
  const options = {
    token: "synthetic",
    readBefore: async () => ({ assessment: { schemaHash: SCHEMA_SHA256 }, ledger: [] }),
    readAfter: async () => {
      afterReads++;
      return { catalog: {}, ledger: [{ version: VERSION, name: NAME, statements: [text] }] };
    },
    assessAfter: () => ({ schemaHash: SCHEMA_SHA256 }),
    writer: async () => {
      writes++;
      throw Error("connection_lost_after_commit");
    },
  };
  const result = await reconcileLive(options);
  assert.equal(result.state, "exact_ledger_reconciled");
  assert.equal(result.project, LIVE_PROJECT);
  assert.equal(result.acknowledged, false);
  assert.equal(writes, 1);
  assert.equal(afterReads, 1);
  await assert.rejects(
    reconcileLive({ ...options, readAfter: async () => ({ catalog: {}, ledger: [] }) }),
    /m5_ledger_outcome_unverified_no_replay/,
  );
  assert.equal(writes, 2);
  await assert.rejects(
    reconcileLive({
      ...options,
      readBefore: async () => ({
        assessment: { schemaHash: SCHEMA_SHA256 },
        ledger: [{ version: VERSION, name: NAME, statements: [text] }],
      }),
    }),
    /m5_ledger_preflight_changed/,
  );
  assert.equal(writes, 2);
});
