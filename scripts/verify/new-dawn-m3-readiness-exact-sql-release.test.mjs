import test from "node:test";
import assert from "node:assert/strict";
import {
  applyExact,
  assess,
  NAME,
  PROJECT,
  releaseSql,
  source,
  SOURCE_SHA256,
  TENANT,
  VERSION,
} from "./new-dawn-m3-readiness-exact-sql-release.mjs";

const absent = () => ({
  project: { id: PROJECT, status: "ACTIVE_HEALTHY" },
  ledger: [],
  flags: [],
  scope: [{ active_tenant: true, confirmed_production_realms: 1 }],
  schema: [
    {
      readiness_rpc: false,
      security_definer: false,
      bounded_statement: false,
      authenticated_grant: false,
      anon_grant: false,
      service_grant: false,
      owner_review_rpc: false,
      owner_read_rpc: false,
      owner_publication_table: false,
    },
  ],
});
const installed = () => {
  const state = absent();
  state.ledger = [{ version: VERSION, name: NAME, statements: [source().sql] }];
  for (const key of [
    "readiness_rpc",
    "security_definer",
    "bounded_statement",
    "authenticated_grant",
  ])
    state.schema[0][key] = true;
  return state;
};

test("one pinned migration and tenant/realm/flag boundary", () => {
  assert.match(SOURCE_SHA256, /^[a-f0-9]{64}$/);
  assert.equal(assess(absent(), false).state, "exact_readiness_absent");
  assert.equal(assess(installed(), true).state, "exact_readiness_installed");
  const sql = releaseSql();
  assert.match(sql, /^begin;\n/);
  assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
  assert.match(
    sql,
    /insert into supabase_migrations\.schema_migrations\(version,name,statements\)/,
  );
  assert.equal(sql.match(/insert into supabase_migrations\.schema_migrations/g)?.length, 1);
  assert.ok(sql.includes(TENANT));
  assert.match(sql, /\ncommit;$/);
  assert.doesNotMatch(sql, /insert into public\.feature_flags/i);
  assert.doesNotMatch(sql, /new_dawn_owner_report_publications/i);
});

test("wrong realm, publication, grant, flag or exact ledger denies release", () => {
  const cases = [
    (s) => {
      s.scope[0].confirmed_production_realms = 2;
    },
    (s) => {
      s.schema[0].owner_publication_table = true;
    },
    (s) => {
      s.schema[0].anon_grant = true;
    },
    (s) => {
      s.flags = [{ flag: "new_dawn.money_source_readiness", value: true }];
    },
  ];
  for (const change of cases) {
    const s = absent();
    change(s);
    assert.throws(() => assess(s, false));
  }
  const wrong = installed();
  wrong.ledger[0].statements = ["changed"];
  assert.throws(() => assess(wrong, true), /receipt_changed/);
});

test("one uncertain write gets one readback, no replay", async () => {
  let reads = 0,
    writes = 0;
  const success = await applyExact({
    project: PROJECT,
    token: "synthetic",
    read: async () => (reads++ === 0 ? absent() : installed()),
    write: async () => {
      writes++;
      throw Error("connection_lost_after_commit");
    },
  });
  assert.equal(success.state, "exact_readiness_installed");
  assert.equal(success.writeAcknowledged, false);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
  reads = 0;
  writes = 0;
  await assert.rejects(
    applyExact({
      project: PROJECT,
      token: "synthetic",
      read: async () => {
        reads++;
        return absent();
      },
      write: async () => {
        writes++;
        throw Error("connection_lost");
      },
    }),
    /m3_write_outcome_unverified_no_replay/,
  );
  assert.equal(reads, 2);
  assert.equal(writes, 1);
  await assert.rejects(
    applyExact({
      project: "wrong",
      token: "synthetic",
      read: async () => absent(),
      write: async () => {
        writes++;
      },
    }),
    /exact_m3_live_project_required/,
  );
  assert.equal(writes, 1);
});
