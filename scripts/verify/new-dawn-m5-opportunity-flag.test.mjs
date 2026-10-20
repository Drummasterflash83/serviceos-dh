import assert from "node:assert/strict";
import test from "node:test";
import { source, VERSION, NAME, LIVE_PROJECT } from "./new-dawn-m5-ledger-reconcile.mjs";
import {
  assessAudit,
  assessScope,
  assessWithdrawalScope,
  FLAG,
  flagSql,
  rehearseLiveRollback,
  switchLive,
  TENANT,
} from "./new-dawn-m5-opportunity-flag.mjs";

const auditId = "4a000000-0000-4000-8000-000000000001";
const edge = {
  slug: "learn-commusoft-opportunity-probe",
  id: "cf8d9ce2-0e45-4d8c-a795-4ee4793ab143",
  version: 2,
  ezbr_sha256: "ee6249254a0af98820bb44135641ae4735965e2b9779ac4ea27325ab1b748c09",
  verify_jwt: false,
  status: "ACTIVE",
};
const fixture = (on, receiptCount = 0, audit = []) => ({
  project: { id: LIVE_PROJECT, status: "ACTIVE_HEALTHY" },
  functions: [{ ...edge }],
  flags: [
    {
      flag_rows: on ? 1 : 0,
      enabled_global: Number(on),
      enabled_tenant: Number(on),
      other_rows: 0,
      receipt_count: receiptCount,
      active_probe: false,
      active_import: false,
      active_tenant: true,
      connection_count: 1,
      audit_guards: 2,
    },
  ],
  ledger: [{ version: VERSION, name: NAME, statements: [source()] }],
  audit,
});

test("exact enable rehearsal rolls back the flag and audit without provider work", async () => {
  let writes = 0;
  const result = await rehearseLiveRollback({
    token: "synthetic",
    auditId,
    read: async () => fixture(false),
    verifyCatalog: async () => ({ schemaHash: "synthetic" }),
    write: async (sql) => {
      writes++;
      assert.match(sql, /\nrollback;$/);
      assert.doesNotMatch(sql, /\ncommit;/);
      return [{ marker: "m5-opportunity-source-enabled/1" }];
    },
  });
  assert.equal(result.state, "exact_flag_enable_rolled_back");
  assert.equal(writes, 1);
  await assert.rejects(
    rehearseLiveRollback({
      token: "synthetic",
      auditId,
      read: async (_token, id) => (id ? fixture(true) : fixture(false)),
      verifyCatalog: async () => ({}),
      write: async () => {
        throw Error("network unknown");
      },
    }),
    /rollback_outcome_unverified_no_replay/,
  );
});
const audit = (on) => ({
  id: auditId,
  tenant_id: TENANT,
  actor: "codex:delegated-openfolk-operator",
  action: `new_dawn.m5_opportunities_probe.${on ? "enable" : "disable"}`,
  resource_type: "feature_flag",
  resource_id: FLAG,
  before: { enabled: !on },
  after: { enabled: on },
  reason: "Reviewed Drummonds one-page opportunity source trial",
  source: "codex-release",
  view_as_active: false,
  correlation_id: auditId,
});

test("only the exact Drummonds runtime, receipt and default-off state pass", () => {
  assert.equal(assessScope(fixture(false), false, { beforeFirst: true }).flagEnabled, false);
  assert.equal(assessScope(fixture(true), true, { beforeFirst: true }).flagEnabled, true);
  assert.equal(assessScope(fixture(false, 1), false).receiptCount, 1);
  for (const change of [
    (s) => {
      s.functions[0].version = 3;
    },
    (s) => {
      s.functions[0].ezbr_sha256 = "0".repeat(64);
    },
    (s) => {
      s.flags[0].active_import = true;
    },
    (s) => {
      s.flags[0].active_probe = true;
    },
    (s) => {
      s.flags[0].other_rows = 1;
    },
    (s) => {
      s.ledger[0].statements = ["changed"];
    },
  ]) {
    const sample = fixture(false);
    change(sample);
    assert.throws(() => assessScope(sample, false, { beforeFirst: true }));
  }
  assert.throws(() => assessScope(fixture(false, 1), false, { beforeFirst: true }));
});

test("flag transaction is a one-row audited change and no source or provider request", () => {
  for (const on of [true, false]) {
    const sql = flagSql(on, auditId);
    assert.match(sql, /^begin;\n/);
    assert.match(sql, /lock table public\.feature_flags/);
    assert.match(sql, /lock table public\.controlplane_change_log/);
    assert.match(sql, /insert into public\.controlplane_change_log/);
    assert.equal(sql.match(/insert into public\.controlplane_change_log/g)?.length, 1);
    assert.match(sql, /\ncommit;$/);
    assert.doesNotMatch(sql, /insert into public\.new_dawn_commusoft_opportunity_probes/);
    assert.doesNotMatch(sql, /https:\/\/|GET \/|POST \//i);
  }
  assert.match(flagSql(true, auditId), /m5_flag_enable_preflight_changed/);
  assert.match(flagSql(false, auditId), /m5_flag_disable_preflight_changed/);
});

test("unknown enable outcome is read once, never replayed", async () => {
  let writes = 0,
    reads = 0;
  const result = await switchLive(true, {
    token: "synthetic",
    auditId,
    verifyCatalog: async () => ({ schemaHash: "synthetic" }),
    read: async (_token, id) => {
      reads++;
      return id ? fixture(true, 0, [audit(true)]) : fixture(false);
    },
    write: async () => {
      writes++;
      throw Error("network outcome unknown");
    },
  });
  assert.equal(result.flagEnabled, true);
  assert.equal(result.acknowledged, false);
  assert.equal(writes, 1);
  assert.equal(reads, 2);
  reads = 0;
  writes = 0;
  await assert.rejects(
    switchLive(true, {
      token: "synthetic",
      auditId,
      verifyCatalog: async () => ({ schemaHash: "synthetic" }),
      read: async () => {
        reads++;
        return fixture(false);
      },
      write: async () => {
        writes++;
        throw Error("network outcome unknown");
      },
    }),
    /outcome_unverified_no_replay/,
  );
  assert.equal(writes, 1);
  assert.equal(reads, 2);
});

test("disable allows one retained receipt but validates exact audit", async () => {
  let calls = 0;
  const result = await switchLive(false, {
    token: "synthetic",
    auditId,
    read: async (_token, id) => {
      calls++;
      return id
        ? {
            ...fixture(false, 1, [audit(false)]),
            flags: [{ ...fixture(false, 1).flags[0], flag_rows: 1 }],
          }
        : fixture(true, 1);
    },
    write: async () => [{ marker: "m5-opportunity-source-disabled/1" }],
  });
  assert.equal(result.receiptCount, 1);
  assert.equal(calls, 2);
  assert.equal(assessAudit({ audit: [audit(false)] }, auditId, false), auditId);
  assert.throws(() =>
    assessAudit({ audit: [{ ...audit(false), actor: "other" }] }, auditId, false),
  );
  const drifted = fixture(true, 1);
  drifted.functions[0].version = 999;
  drifted.flags[0].active_import = true;
  drifted.flags[0].active_probe = true;
  assert.equal(assessWithdrawalScope(drifted, true).flagEnabled, true);
});
