import assert from "node:assert/strict";
import test from "node:test";
import {
  assess,
  installLive,
  PROJECT,
  releaseSql,
  reviewedSource,
  SOURCE_SHA256,
  VERSION,
} from "./new-dawn-m3-foc-closure-release.mjs";

const before = {
  project: { id: PROJECT, status: "ACTIVE_HEALTHY" },
  ledger: [],
  catalog: [
    {
      installed: false,
      security_definer: false,
      installed_function_sha256: null,
      authenticated_grant: false,
      anon_grant: false,
      service_grant: false,
      actor_sha256: "c219bb0b06c71235a999e7656504f3eb2b74739dadbd5de47c6a5f21789a2a6d",
      latest_sha256: "9c23056d83cf6e11557317db80a252277a723ff926066aab0ab7f4e1218fb3d4",
      detail_finish_sha256: "7c4bb1e4baf72f56935ed40dd441ea1cbd25412d205576583152677d7f4ce36c",
      tenant_active: true,
      detail_rls: true,
      detail_authenticated_select: false,
      foc_flags_on: 0,
      client_money_on: 0,
    },
  ],
  counts: [{ detail_receipts: 6, review_audits: 0 }],
};
const after = structuredClone(before);
after.ledger = [
  {
    version: VERSION,
    name: "new_dawn_foc_closure_review",
    statement_count: 1,
    source_sha256: SOURCE_SHA256,
  },
];
Object.assign(after.catalog[0], {
  installed: true,
  security_definer: true,
  authenticated_grant: true,
  installed_function_sha256: "f3a8d3bc8e708c35feb2f819fc89037a446a97fc5051d92ef4d30c1fe4550697",
});

test("reviewed SQL and release transaction remain exact, additive and rollbackable", () => {
  const file = reviewedSource();
  assert.equal(file.hash, SOURCE_SHA256);
  assert.equal(assess(before, false).state, "exact_foc_review_ready");
  assert.equal(assess(after, true).state, "installed_default_off_readback");
  const sql = releaseSql(file, true);
  assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
  assert.match(sql, /lock table public\.feature_flags/);
  assert.match(sql, /insert into supabase_migrations\.schema_migrations/);
  assert.match(sql, /rollback;$/);
  assert.doesNotMatch(sql, /insert into public\.feature_flags/);
  assert.throws(
    () => assess({ ...before, catalog: [{ ...before.catalog[0], foc_flags_on: 1 }] }, false),
    /foc_access_or_flag_boundary_changed/,
  );
});

test("uncertain write is read back once and never replayed", async () => {
  let reads = 0,
    writes = 0;
  const result = await installLive({
    project: PROJECT,
    token: "synthetic",
    read: async () => (++reads === 1 ? structuredClone(before) : structuredClone(after)),
    write: async () => {
      writes++;
      throw Error("uncertain transport");
    },
  });
  assert.equal(result.state, "installed_default_off_readback");
  assert.equal(result.writeAcknowledged, false);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
  reads = 0;
  writes = 0;
  await assert.rejects(
    () =>
      installLive({
        project: PROJECT,
        token: "synthetic",
        read: async () => {
          reads++;
          return structuredClone(before);
        },
        write: async () => {
          writes++;
          throw Error("uncertain transport");
        },
      }),
    /foc_install_outcome_unverified_no_replay/,
  );
  assert.equal(reads, 2);
  assert.equal(writes, 1);
});
