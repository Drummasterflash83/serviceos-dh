import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { catalog } from "./learn-commusoft-test-fixture.mjs";
import { importBatchesTransport } from "./learn-import-batches-test-fixture.mjs";
import { COMMUSOFT_FUNCTION_QUERY, COMMUSOFT_GRANTS_QUERY } from "./learn-commusoft-catalog.mjs";
import {
  expectedCommusoftRuntime,
  installedCommusoftWithTrigger,
} from "./learn-test-commusoft-runtime.mjs";
import { commusoftEndpointBundle, deployCommusoft } from "./learn-test-commusoft-deploy.mjs";
import { catalogFingerprint } from "./learn-test-launch-rehearsal.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
function refreshed() {
  const c = catalog(true);
  c.base.functions = expectedCommusoftRuntime().afterEndpoints;
  c.readinessCatalogSha256 = catalogFingerprint(c.base);
  return c;
}
const args = { allowProjectRef: TEST_PROJECT, token: "sbp_" + "a".repeat(40) };
function transport(current) {
  const old = importBatchesTransport({ beforeCatalog: current });
  return async (url, o) => {
    const q = o?.body ? JSON.parse(o.body).query : null;
    if (q === COMMUSOFT_FUNCTION_QUERY)
      return Response.json([{ functions: current().commusoftFunctions }]);
    if (q === COMMUSOFT_GRANTS_QUERY) return Response.json([{ grants: current().commusoftGrants }]);
    return old.fetcher(url, o);
  };
}
test("runtime refresh preserves exact prior contracts and rejects any unrelated change", () => {
  const c = refreshed(),
    copy = structuredClone(c);
  assert.equal(installedCommusoftWithTrigger(c), true);
  assert.deepEqual(c, copy);
  for (const change of [
    (c) => (c.base.functions[0].ezbr_sha256 = "other"),
    (c) => c.base.functions[0].version++,
    (c) => (c.tables[0].rls = false),
    (c) => c.commusoftGrants.pop(),
  ]) {
    const c = refreshed();
    change(c);
    assert.equal(installedCommusoftWithTrigger(c), false);
  }
});
test("only the pinned JWT-protected endpoint and all its dependencies are staged; other endpoints persist", async () => {
  let deployed = false,
    calls = 0,
    stage;
  const current = () => {
    const c = refreshed();
    if (deployed)
      c.base.functions.push({
        id: "synthetic-worker",
        slug: "learn-commusoft-worker",
        version: 1,
        status: "ACTIVE",
        verify_jwt: true,
        ezbr_sha256: "synthetic-source",
      });
    return c;
  };
  const runCli = (bin, a, o) => {
    calls++;
    assert.deepEqual(a.slice(0, 3), ["functions", "deploy", "learn-commusoft-worker"]);
    assert.equal(a[a.indexOf("--project-ref") + 1], TEST_PROJECT);
    assert.ok(!a.includes("--prune"));
    stage = a[a.indexOf("--workdir") + 1];
    assert.match(readFileSync(join(stage, "supabase/config.toml"), "utf8"), /verify_jwt = true/);
    const bundle = commusoftEndpointBundle();
    assert.equal(bundle.files.length, 8);
    for (const f of bundle.files)
      assert.equal(readFileSync(join(stage, "supabase/functions", f.path), "utf8"), f.source);
    assert.equal(o.env.SUPABASE_ACCESS_TOKEN, args.token);
    deployed = true;
    return { status: 0 };
  };
  const r = await deployCommusoft({ ...args, fetcher: transport(current), runCli });
  assert.equal(r.state, "deployed_needs_http_acceptance");
  assert.equal(calls, 1);
  assert.equal(existsSync(stage), false);
  await assert.rejects(deployCommusoft({ ...args, fetcher: transport(current), runCli }));
  assert.equal(calls, 1);
  await assert.rejects(
    deployCommusoft({
      ...args,
      allowProjectRef: "production",
      fetcher: transport(refreshed),
      runCli,
    }),
  );
  assert.equal(calls, 1);
});
test("an uncertain deploy acknowledgement never causes resubmission", async () => {
  let calls = 0;
  const r = await deployCommusoft({
    ...args,
    fetcher: transport(refreshed),
    runCli: () => {
      calls++;
      throw Error("Lost acknowledgement");
    },
  });
  assert.equal(calls, 1);
  assert.equal(r.state, "requires_inspection");
});
