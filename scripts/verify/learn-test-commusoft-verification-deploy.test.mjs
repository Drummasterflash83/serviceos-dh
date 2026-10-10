import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { catalog, transport } from "./learn-commusoft-setup-test-fixture.mjs";
import {
  deployVerification,
  verificationEndpointBundle,
  inspectVerificationDeployment,
} from "./learn-test-commusoft-verification-deploy.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
const args = { allowProjectRef: TEST_PROJECT, token: "sbp_" + "a".repeat(40) };
const endpoint = {
  id: "synthetic-verify",
  slug: "learn-commusoft-verify",
  version: 1,
  status: "ACTIVE",
  verify_jwt: true,
  ezbr_sha256: "synthetic-bundle",
};
test("only the pinned verification endpoint is staged with JWT enforcement; preserves installed connection schema and workers", async () => {
  let deployed = false,
    calls = 0,
    stage,
    journaled = false;
  const before = catalog(true),
    after = structuredClone(before);
  after.base.functions.push(endpoint);
  const current = () => (deployed ? after : before);
  const runCli = (bin, a, o) => {
    assert.equal(journaled, true);
    calls++;
    assert.deepEqual(a.slice(0, 3), ["functions", "deploy", "learn-commusoft-verify"]);
    assert.equal(a[a.indexOf("--project-ref") + 1], TEST_PROJECT);
    assert.ok(!a.includes("--prune"));
    stage = a[a.indexOf("--workdir") + 1];
    assert.match(readFileSync(join(stage, "supabase/config.toml"), "utf8"), /verify_jwt = true/);
    const bundle = verificationEndpointBundle();
    assert.equal(bundle.files.length, 5);
    for (const f of bundle.files)
      assert.equal(readFileSync(join(stage, "supabase/functions", f.path), "utf8"), f.source);
    assert.equal(o.env.SUPABASE_ACCESS_TOKEN, args.token);
    deployed = true;
    return { status: 0 };
  };
  const fetcher = transport({ currentCatalog: current }).fetcher;
  const r = await deployVerification({
    ...args,
    fetcher,
    runCli,
    beforeDeploy: async (c) => {
      assert.deepEqual(c.connectionVault, before.connectionVault);
      journaled = true;
    },
  });
  assert.equal(r.state, "deployed_needs_http_acceptance");
  assert.equal(calls, 1);
  assert.equal(existsSync(stage), false);
  await assert.rejects(deployVerification({ ...args, fetcher, runCli }));
  assert.equal(calls, 1);
  for (const change of [
    (c) => (c.base.functions.at(-1).verify_jwt = false),
    (c) => c.base.functions[0].version++,
    (c) => (c.connectionVault.relations[0].postgresUpdate = true),
  ]) {
    const changed = structuredClone(after);
    change(changed);
    assert.equal(
      inspectVerificationDeployment({ before, after: changed, status: 0 }).state,
      "requires_inspection",
    );
  }
});
test("production, failed journal, and uncertain acknowledgement cannot trigger repeat deployments", async () => {
  let calls = 0;
  const before = catalog(true),
    fetcher = transport({ currentCatalog: () => before }).fetcher;
  const runCli = () => {
    calls++;
    throw Error("Lost response");
  };
  await assert.rejects(
    deployVerification({ ...args, allowProjectRef: "production", fetcher, runCli }),
  );
  await assert.rejects(
    deployVerification({
      ...args,
      fetcher,
      runCli,
      beforeDeploy: async () => {
        throw Error("Journal unavailable");
      },
    }),
  );
  assert.equal(calls, 0);
  const r = await deployVerification({ ...args, fetcher, runCli });
  assert.equal(calls, 1);
  assert.equal(r.state, "requires_inspection");
});

test("installed runtime recognizes only the exact recorded endpoint and preserves the underlying release", async () => {
  const { expectedVerificationEndpoint, installedVerificationRuntime } =
    await import("./learn-test-commusoft-verification-runtime.mjs");
  const c = catalog(true);
  c.base.functions.push(expectedVerificationEndpoint().endpoint);
  assert.equal(installedVerificationRuntime(c), true);
  for (const change of [
    (c) => (c.base.functions.at(-1).ezbr_sha256 = "different"),
    (c) => c.base.functions.at(-1).version++,
    (c) => (c.connectionFunctions[0].definition += " drift"),
  ]) {
    const changed = structuredClone(c);
    change(changed);
    assert.equal(installedVerificationRuntime(changed), false);
  }
});
