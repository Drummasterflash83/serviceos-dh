import assert from "node:assert/strict";
import test from "node:test";
import { assess, releaseSql, reviewedSource, SOURCE_SHA256, VERSION } from
  "./new-dawn-m3-aged-invoice-release.mjs";

test("release pins the exact source and records one tracked migration receipt", () => {
  const file = reviewedSource();
  assert.equal(file.hash, SOURCE_SHA256);
  const sql = releaseSql(file);
  assert.match(sql, /lock table supabase_migrations\.schema_migrations in share row exclusive mode/);
  assert.match(sql, /20261110100000/);
  assert.equal(sql.match(/insert into supabase_migrations\.schema_migrations/g)?.length, 1);
  assert.match(sql, new RegExp(VERSION));
  assert.match(sql, /aged_invoice_install_preflight_changed/);
});

test("readback refuses a missing prior ledger receipt or exposed anon function", () => {
  const project = { id: "tgbnakbxwcqjeimygroz", status: "ACTIVE_HEALTHY" };
  const prior = { version: "20261110100000", name: "new_dawn_client_job_record",
    statement_count: 1,
    source_sha256: "927b0791219dfdcc2e0a7977d9ba78c195cbadef87961562a59c7b789c38298e" };
  const catalog = { rpc_installed: false, rpc_sha256: null, security_definer: null,
    authenticated_grant: null, anon_grant: null, confirmed_connections: 1,
    review_flag_on: 1 };
  assert.equal(assess({ project, ledger: [prior], catalog: [catalog] }, false).state,
    "aged_invoice_read_ready");
  assert.throws(() => assess({ project, ledger: [], catalog: [catalog] }, false));
  assert.throws(() => assess({ project, ledger: [prior],
    catalog: [{ ...catalog, anon_grant: true }] }, false));
});
