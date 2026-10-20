import assert from "node:assert/strict";
import test from "node:test";
import { PROJECT, TENANT, VERSION, NAME, SHA256 } from "./new-dawn-invoice-job-pair-release.mjs";
import { FLAG, assess, assessAudit, flagSql, switchLive } from "./new-dawn-m3-pair-flag.mjs";

const auditId = "00000000-0000-4000-8000-000000000778";
const functionHash = "1576eae7e70a474c99eb4641250474af58a31a6f8600db002de265a5793e183a";
const snapshot = (on = false, existing = on) => ({
  project: { id: PROJECT, status: "ACTIVE_HEALTHY" },
  rows: [{ installed: true, anon_execute: false, operator_execute: true,
    service_execute: false, function_sha256: functionHash, ledger_count: 1,
    ledger_name: NAME, ledger_hash: SHA256, target_rows: Number(existing),
    target_on: Number(on), other_rows: 0, client_money_on: 0,
    active_tenant: 1, confirmed_realms: 1, audit_triggers: 2 }],
  audit: [],
});
const audit = on => ({ id: auditId, tenant_id: TENANT,
  actor: "codex:delegated-openfolk-operator",
  action: `new_dawn.invoice_job_pair_source_preview.${on ? "enable" : "disable"}`,
  resource_type: "feature_flag", resource_id: FLAG,
  before: { enabled: !on }, after: { enabled: on },
  source: "codex-release", view_as_active: false, correlation_id: auditId,
  reason: "Reviewed exact invoice/job source comparison for OpenFolk operator only" });

test("exact installed source, operator grant, tenant, and off client money gate", () => {
  assert.equal(assess(snapshot(), false).operatorFlagEnabled, false);
  assert.equal(assess(snapshot(true), true).operatorFlagEnabled, true);
  for (const change of [
    s => { s.project.id = "different"; },
    s => { s.rows[0].function_sha256 = "0".repeat(64); },
    s => { s.rows[0].anon_execute = true; },
    s => { s.rows[0].client_money_on = 1; },
    s => { s.rows[0].other_rows = 1; },
    s => { s.rows[0].audit_triggers = 1; },
    s => { s.rows[0].confirmed_realms = 2; },
  ]) { const s = structuredClone(snapshot()); change(s); assert.throws(() => assess(s, false)); }
});

test("both exact transactions constrain scope and audit the change", () => {
  const enable = flagSql(true, auditId), disable = flagSql(false, auditId);
  for (const sql of [enable, disable]) {
    assert.match(sql, /^begin;/);
    assert.match(sql, /lock table public\.feature_flags/);
    assert.match(sql, /lock table public\.controlplane_change_log/);
    assert.ok(sql.includes(TENANT));
    assert.equal(sql.match(/insert into public\.controlplane_change_log/g)?.length, 1);
    assert.match(sql, /\ncommit;$/);
    assert.doesNotMatch(sql, /update public\.learn_quickbooks|insert into public\.learn_quickbooks/);
  }
  assert.match(enable, /m3-pair-flag-enabled\/1/);
  assert.ok(enable.includes(VERSION));
  assert.match(disable, /m3-pair-flag-disabled\/1/);
  assert.match(disable, /flag='new_dawn\.invoice_job_pair_source_preview'\)<>1/);
  assert.doesNotMatch(disable, /schema_migrations|pg_get_functiondef/);
});

test("withdrawal remains possible after a source or connection change", () => {
  const s = snapshot(true);
  s.rows[0].function_sha256 = "0".repeat(64);
  s.rows[0].confirmed_realms = 0;
  s.rows[0].client_money_on = 1;
  assert.equal(assess(s, true, { withdrawal: true }).operatorFlagEnabled, true);
  assert.equal(assess(snapshot(false, true), false, { withdrawal: true }).operatorFlagEnabled, false);
});

test("independent audit readback binds actor, tenant and before/after", () => {
  const s = { ...snapshot(true), audit: [audit(true)] };
  assert.doesNotThrow(() => assessAudit(s, auditId, true));
  for (const change of [ { tenant_id: "different" }, { actor: "different" },
    { after: { enabled: false } }, { view_as_active: true } ])
    assert.throws(() => assessAudit({ ...s, audit: [{ ...audit(true), ...change }] }, auditId, true));
});

test("uncertain write is independently read back once and never replayed", async () => {
  let reads = 0, writes = 0;
  const result = await switchLive(true, { token: "synthetic", auditId,
    read: async () => ++reads === 1 ? snapshot() : { ...snapshot(true), audit: [audit(true)] },
    write: async () => { writes++; throw Error("uncertain"); } });
  assert.equal(result.readbackVerified, true);
  assert.equal(result.acknowledged, false);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
});
