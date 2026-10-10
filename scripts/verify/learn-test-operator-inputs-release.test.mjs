import test from "node:test";
import assert from "node:assert/strict";
import { catalog as commusoftCatalog } from "./learn-commusoft-test-fixture.mjs";
import { importBatchesTransport } from "./learn-import-batches-test-fixture.mjs";
import { COMMUSOFT_FUNCTION_QUERY, COMMUSOFT_GRANTS_QUERY } from "./learn-commusoft-catalog.mjs";
import {
  expectedCommusoftRuntime,
  expectedCommusoftEndpoint,
} from "./learn-test-commusoft-runtime.mjs";
import {
  OPERATOR_INPUT_FUNCTION_QUERY,
  OPERATOR_INPUT_GRANTS_QUERY,
  OPERATOR_INPUT_AUTHORITY_QUERY,
} from "./learn-operator-inputs-catalog.mjs";
import {
  operatorInputPrior,
  expectedOperatorInputs,
  operatorInputPrerequisites,
  installedOperatorInputs,
  withoutOperatorInputs,
  operatorInputSql,
  releaseOperatorInputs,
  OPERATOR_INPUT_RELEASE,
  OPERATOR_INPUT_SHA,
} from "./learn-test-operator-inputs-release.mjs";
import { catalogFingerprint } from "./learn-test-launch-rehearsal.mjs";
import { compactImportTable } from "./learn-test-import-release.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
const args = { allowProjectRef: TEST_PROJECT, token: "sbp_" + "a".repeat(40) };
function catalog(installed = false) {
  const c = commusoftCatalog(true),
    p = operatorInputPrior();
  c.base.functions = [
    ...expectedCommusoftRuntime().afterEndpoints,
    expectedCommusoftEndpoint().endpoint,
  ];
  c.operatorInputFunctions = p.functions;
  c.operatorInputGrants = p.grants;
  c.operatorInputAuthority = p.authority;
  if (installed) {
    const e = expectedOperatorInputs();
    c.operatorInputFunctions.push(...e.functions);
    c.operatorInputGrants.push(...e.grants);
    c.operatorInputAuthority.permissions = e.permissions;
    c.actionRegistries.permissions.push(...structuredClone(e.permissions));
    c.tables.push(...e.tables);
    c.base.inventory.tables.push(...e.tables.map(compactImportTable));
    c.base.inventory.functions.push(
      ...e.functions.map(
        ({ name, arguments: args, securityDefiner, authenticatedExecute, anonExecute }) => ({
          name,
          arguments: args,
          securityDefiner,
          authenticatedExecute,
          anonExecute,
        }),
      ),
    );
    const receipt = {
      migration_name: OPERATOR_INPUT_RELEASE,
      source_sha256: OPERATOR_INPUT_SHA,
      project_ref: TEST_PROJECT,
      applied_at: "2026-10-10T10:00:00Z",
    };
    c.readiness.customMigrationEntries.push(receipt);
    if (c.base.report.customMigrationEntries !== c.readiness.customMigrationEntries)
      c.base.report.customMigrationEntries.push(receipt);
  }
  c.readinessCatalogSha256 = catalogFingerprint(c.base);
  return c;
}
function transport({ rehearse = false, unknown = false, committed = false, already = false } = {}) {
  let writes = 0;
  const cached = new Map();
  const current = () => {
    const installed = already || (writes > 0 && !rehearse && (!unknown || committed));
    if (!cached.has(installed)) cached.set(installed, catalog(installed));
    return cached.get(installed);
  };
  const base = importBatchesTransport({ beforeCatalog: current });
  return {
    get writes() {
      return writes;
    },
    fetcher: async (url, o) => {
      const query = o?.body ? JSON.parse(o.body).query : null,
        c = current();
      if (url.endsWith("/database/query")) {
        writes++;
        if (unknown) throw Error("Lost reply");
        return Response.json([{ marker: "learn-test-operator-inputs/1", receipt_expected: true }]);
      }
      for (const [q, key, field] of [
        [COMMUSOFT_FUNCTION_QUERY, "functions", "commusoftFunctions"],
        [COMMUSOFT_GRANTS_QUERY, "grants", "commusoftGrants"],
        [OPERATOR_INPUT_FUNCTION_QUERY, "functions", "operatorInputFunctions"],
        [OPERATOR_INPUT_GRANTS_QUERY, "grants", "operatorInputGrants"],
        [OPERATOR_INPUT_AUTHORITY_QUERY, "authority", "operatorInputAuthority"],
      ])
        if (query === q) return Response.json([{ [key]: c[field] }]);
      return base.fetcher(url, o);
    },
  };
}
test("exact operator package preserves prior contracts and rejects permission, function and endpoint drift", () => {
  assert.equal(operatorInputPrerequisites(catalog()), true);
  const c = catalog(true),
    before = structuredClone(c);
  assert.equal(installedOperatorInputs(c), true);
  assert.deepEqual(c, before);
  assert.equal(operatorInputPrerequisites(withoutOperatorInputs(c)), true);
  for (const change of [
    (c) =>
      (c.operatorInputFunctions.find((f) => f.name === "learn_operator_input_request").anonExecute =
        true),
    (c) =>
      (c.operatorInputFunctions.find(
        (f) => f.name === "current_user_is_openfolk_operator",
      ).definition += " drift"),
    (c) => (c.operatorInputAuthority.permissions[0].description = "different"),
    (c) =>
      (c.actionRegistries.permissions.find(
        (p) => p.permission === "platform.controlplane.admin",
      ).description = "different"),
    (c) => c.operatorInputGrants.pop(),
    (c) => (c.tables.find((t) => t.name === "platform_authority_grants").rls = false),
    (c) => c.base.functions[0].version++,
    (c) => (c.commusoftFunctions[0].definition += " drift"),
  ]) {
    const v = catalog(true);
    change(v);
    assert.equal(installedOperatorInputs(v), false);
  }
  assert.match(operatorInputSql(true), /\nrollback;\n/);
  assert.doesNotMatch(operatorInputSql(true), /\ncommit;\n/);
  assert.ok(
    operatorInputSql(false).includes("create function public.learn_operator_input_request("),
  );
});
test("fresh rollback permits one install; uncertain outcomes are inspected without resubmitting", async () => {
  const m = transport({ rehearse: true }),
    rehearsal = await releaseOperatorInputs({ ...args, rehearse: true, fetcher: m.fetcher });
  assert.equal(rehearsal.state, "rehearsed_and_rolled_back");
  assert.equal(m.writes, 1);
  for (const options of [{}, { unknown: true }, { unknown: true, committed: true }]) {
    const n = transport(options),
      r = await releaseOperatorInputs({ ...args, rehearsal, fetcher: n.fetcher });
    assert.equal(n.writes, 1);
    assert.equal(
      r.state,
      options.unknown ? "requires_inspection" : "installed_needs_authenticated_acceptance",
    );
  }
  for (const change of [
    { observedAt: "2020-01-01" },
    { afterFingerprint: "changed" },
    { acknowledged: false },
    { sourceSha256: "wrong" },
  ]) {
    const n = transport();
    await assert.rejects(
      releaseOperatorInputs({
        ...args,
        rehearsal: { ...rehearsal, ...change },
        fetcher: n.fetcher,
      }),
    );
    assert.equal(n.writes, 0);
  }
  const n = transport();
  await assert.rejects(
    releaseOperatorInputs({
      ...args,
      allowProjectRef: "production",
      rehearse: true,
      fetcher: n.fetcher,
    }),
  );
  assert.equal(n.writes, 0);
  const done = transport({ already: true });
  assert.equal(
    (await releaseOperatorInputs({ ...args, fetcher: done.fetcher })).state,
    "already_installed",
  );
  assert.equal(done.writes, 0);
});
