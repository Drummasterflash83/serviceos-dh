import test from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT,
  TENANT,
  VERSION,
  NAME,
  source,
} from "./new-dawn-m3-readiness-exact-sql-release.mjs";
import { assess, flagBody, flagSql, switchLive } from "./new-dawn-m3-operator-readiness-flag.mjs";

function snapshot(enabled = false) {
  return {
    project: { id: PROJECT, status: "ACTIVE_HEALTHY" },
    ledger: [{ version: VERSION, name: NAME, statements: [source().sql] }],
    flags: enabled ? [{ flag: "new_dawn.money_source_readiness", value: true }] : [],
    scope: [{ active_tenant: true, confirmed_production_realms: 1 }],
    schema: [
      {
        readiness_rpc: true,
        security_definer: true,
        bounded_statement: true,
        authenticated_grant: true,
        anon_grant: false,
        service_grant: false,
        owner_review_rpc: false,
        owner_read_rpc: false,
        owner_publication_table: false,
      },
    ],
    global: [
      {
        operator_enabled: Number(enabled),
        drummonds_enabled: Number(enabled),
        client_enabled: 0,
        existing_operator_report_enabled: 1,
        drummonds_operator_report_enabled: 1,
      },
    ],
  };
}

test("Drummonds operator flag is separate from client money and exact migration", () => {
  assert.equal(assess(snapshot(false), false).operatorFlagEnabled, false);
  assert.equal(assess(snapshot(true), true).clientMoneyFlagsEnabled, false);
  const sql = flagSql(true);
  assert.match(sql, /^begin;\n/);
  assert.match(sql, /set local lock_timeout='3s'/);
  assert.match(sql, /lock table public\.feature_flags/);
  assert.match(sql, /statements=array\[/);
  assert.match(sql, /m3-operator-readiness-enabled\/1/);
  assert.match(sql, /new_dawn\.owner_money/);
  assert.match(sql, /new_dawn\.owner_accounts_report/);
  assert.match(sql, /new_dawn\.job_home_accounts_preview/);
  assert.match(sql, /new_dawn\.report_summary_preview/);
  assert.match(sql, /environment='production'/);
  assert.match(sql, /has_function_privilege\('anon'/);
  assert.match(sql, /\ncommit;$/);
  assert.equal(sql.match(/insert into public\.feature_flags\(tenant_id,flag,value\)/g)?.length, 1);
  assert.ok(sql.includes(TENANT));
  assert.match(sql, /learn_quickbooks_owner_report_review\(/);
  assert.match(flagSql(false), /m3-operator-readiness-disabled\/1/);
  assert.match(flagSql(true, TENANT, true), /\nrollback;$/);
  assert.throws(() => flagBody(true, "another tenant"), /invalid_scope/);
});

test("scope, grants, publication and any client money flag fail closed", () => {
  const changes = [
    (s) => {
      s.project.id = "wrong";
    },
    (s) => {
      s.scope[0].confirmed_production_realms = 2;
    },
    (s) => {
      s.ledger[0].statements = ["changed"];
    },
    (s) => {
      s.schema[0].anon_grant = true;
    },
    (s) => {
      s.schema[0].owner_publication_table = true;
    },
    (s) => {
      s.flags = [{ flag: "new_dawn.owner_money", value: true }];
    },
    (s) => {
      s.global[0].client_enabled = 1;
    },
    (s) => {
      s.global[0].existing_operator_report_enabled = 0;
    },
    (s) => {
      s.global[0].drummonds_operator_report_enabled = 0;
    },
    (s) => {
      s.global[0].operator_enabled = 1;
    },
  ];
  for (const change of changes) {
    const state = snapshot();
    change(state);
    assert.throws(() => assess(state, false));
  }
});

test("uncertain LIVE write gets one readback and never replays", async () => {
  let reads = 0,
    writes = 0;
  const result = await switchLive(true, {
    token: "synthetic",
    read: async () => (reads++ === 0 ? snapshot(false) : snapshot(true)),
    write: async () => {
      writes++;
      throw Error("connection lost after commit");
    },
  });
  assert.equal(result.writeAcknowledged, false);
  assert.equal(result.readbackVerified, true);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
  reads = 0;
  writes = 0;
  await assert.rejects(
    switchLive(true, {
      token: "synthetic",
      read: async () => {
        reads++;
        return snapshot(false);
      },
      write: async () => {
        writes++;
        throw Error("connection lost");
      },
    }),
    /outcome_unverified_no_replay/,
  );
  assert.equal(reads, 2);
  assert.equal(writes, 1);
});
