import test from "node:test";
import assert from "node:assert/strict";
import { catalog, transport } from "./learn-commusoft-setup-test-fixture.mjs";
import {
  connectionPrerequisites,
  installedConnectionSetup,
  withoutConnectionSetup,
  connectionSql,
  releaseConnectionSetup,
  CONNECTION_RELEASE,
} from "./learn-test-commusoft-setup-release.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
const args = { allowProjectRef: TEST_PROJECT, token: "sbp_" + "a".repeat(40) };
test("connection release requires exact Vault, broker, privileges, inventory and prior contracts", () => {
  assert.equal(connectionPrerequisites(catalog()), true);
  const c = catalog(true),
    before = structuredClone(c);
  assert.equal(installedConnectionSetup(c), true);
  assert.deepEqual(c, before);
  assert.equal(connectionPrerequisites(withoutConnectionSetup(c)), true);
  for (const change of [
    (c) => (c.connectionVault.relations[0].postgresUpdate = true),
    (c) => (c.connectionVault.functions[0].securityDefiner = false),
    (c) =>
      (c.connectionFunctions.find((f) => f.name === "provider_secret_store").anonExecute = true),
    (c) =>
      (c.connectionFunctions.find((f) => f.name === "learn_commusoft_verify_acquire").definition +=
        " drift"),
    (c) => c.connectionGrants.pop(),
    (c) => (c.tables.find((t) => t.name === "learn_commusoft_verification_results").rls = false),
    (c) =>
      (c.base.inventory.functions.find((f) => f.name === "learn_commusoft_configure").anonExecute =
        true),
    (c) =>
      (c.base.inventory.tables.find((t) => t.name === "learn_commusoft_connection_requests").rls =
        false),
    (c) =>
      (c.readiness.customMigrationEntries.find(
        (r) => r.migration_name === CONNECTION_RELEASE,
      ).source_sha256 = "changed"),
    (c) =>
      (c.base.report.customMigrationEntries.find(
        (r) => r.migration_name === CONNECTION_RELEASE,
      ).source_sha256 = "changed"),
    (c) => (c.operatorInputAuthority.permissions[0].description = "changed"),
    (c) => c.base.functions[0].version++,
  ]) {
    const v = catalog(true);
    v.base.report.customMigrationEntries = structuredClone(v.base.report.customMigrationEntries);
    change(v);
    assert.equal(installedConnectionSetup(v), false);
  }
  assert.match(connectionSql(true), /\nrollback;\n/);
  assert.doesNotMatch(connectionSql(true), /\ncommit;\n/);
  assert.ok(connectionSql(false).includes("create function public.provider_secret_store("));
});
test("single write requires durable journal and fresh rollback; unknown outcomes never resubmit", async () => {
  const m = transport({ rehearse: true });
  let journaled = false;
  const rehearsal = await releaseConnectionSetup({
    ...args,
    rehearse: true,
    fetcher: m.fetcher,
    beforeWrite: async (c) => {
      assert.equal(m.writes, 0);
      assert.equal(connectionPrerequisites(c), true);
      journaled = true;
    },
  });
  assert.equal(journaled, true);
  assert.equal(rehearsal.state, "rehearsed_and_rolled_back");
  assert.equal(m.writes, 1);
  for (const options of [
    {},
    { unknown: true },
    { unknown: true, committed: true },
    { afterUnavailable: true },
  ]) {
    const n = transport(options),
      r = await releaseConnectionSetup({ ...args, rehearsal, fetcher: n.fetcher });
    assert.equal(n.writes, 1);
    assert.equal(
      r.state,
      options.unknown || options.afterUnavailable
        ? "requires_inspection"
        : "installed_needs_authenticated_acceptance",
    );
  }
  for (const change of [
    { observedAt: "2020-01-01" },
    { observedAt: "2999-01-01" },
    { afterFingerprint: "changed" },
    { acknowledged: false },
    { sourceSha256: "wrong" },
  ]) {
    const n = transport();
    await assert.rejects(
      releaseConnectionSetup({
        ...args,
        rehearsal: { ...rehearsal, ...change },
        fetcher: n.fetcher,
      }),
    );
    assert.equal(n.writes, 0);
  }
  const n = transport();
  await assert.rejects(
    releaseConnectionSetup({
      ...args,
      allowProjectRef: "production",
      rehearse: true,
      fetcher: n.fetcher,
    }),
  );
  await assert.rejects(
    releaseConnectionSetup({
      ...args,
      rehearse: true,
      fetcher: n.fetcher,
      beforeWrite: async () => {
        throw Error("Journal unavailable");
      },
    }),
  );
  assert.equal(n.writes, 0);
  const done = transport({ already: true });
  assert.equal(
    (await releaseConnectionSetup({ ...args, fetcher: done.fetcher })).state,
    "already_installed",
  );
  assert.equal(done.writes, 0);
});
