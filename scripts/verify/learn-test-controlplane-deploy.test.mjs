import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { deployControlPlane, controlPlaneBundle, CONTROLPLANE_SHA } from "./learn-test-controlplane-deploy.mjs";
import { EMAIL_RUNTIME_DATABASE } from "./learn-test-email-runtime-deploy.mjs";
import { RUNTIME_PRESERVED } from "./learn-email-runtime-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
const token = "sbp_" + "0".repeat(40);

test("control-plane closure pins all 17 source files and actual server authorization", () => {
  const bundle = controlPlaneBundle();
  assert.equal(bundle.sha256, CONTROLPLANE_SHA);
  assert.equal(bundle.files.length, 17);
  for (const name of ["openfolk-control-plane/index.ts", "_shared/controlplane/authz.ts", "_shared/controlplane/store.ts"])
    assert.ok(bundle.files.some(f => f.path === name));
  assert.deepEqual(bundle.external, ["https://esm.sh/@supabase/supabase-js@2.45.4"]);
});
test("first installation stages exact closure, journals before CLI and preserves other endpoints", async () => {
  let submitted = false, journaled = false, stage;
  const existing = { slug: "existing-worker", status: "ACTIVE", version: 4, verify_jwt: true };
  const created = { slug: "openfolk-control-plane", status: "ACTIVE", version: 1, verify_jwt: false };
  const args = { allowProjectRef: TEST_PROJECT, token,
    persistJournal: async () => { journaled = true; },
    fetcher: async (url, options) => {
      assert.ok(String(url).startsWith(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/`));
      if (url.endsWith("/functions")) return Response.json(submitted ? [existing, created] : [existing]);
      assert.ok(url.endsWith("/read-only"));
      if (JSON.parse(options.body).query.includes(" as catalog,")) return Response.json([{ catalog: { functions: [] }, fingerprint: EMAIL_RUNTIME_DATABASE }]);
      return Response.json(RUNTIME_PRESERVED.map(name => ({ name, count: 0, fingerprint: "0".repeat(32) })));
    },
    runCli: (_binary, args, options) => {
      assert.ok(journaled);
      assert.equal(submitted, false);
      submitted = true;
      assert.equal(args[2], "openfolk-control-plane");
      assert.equal(args[args.indexOf("--project-ref") + 1], TEST_PROJECT);
      stage = args[args.indexOf("--workdir") + 1];
      assert.equal(options.env.SUPABASE_ACCESS_TOKEN, token);
      for (const file of controlPlaneBundle().files)
        assert.equal(readFileSync(join(stage, "supabase/functions", file.path), "utf8"), file.source);
      assert.match(readFileSync(join(stage, "supabase/config.toml"), "utf8"), /verify_jwt = false/);
      assert.equal(existsSync(join(stage, ".env")), false);
      return { status: 0, stdout: "PRIVATE_DIAGNOSTIC" };
    },
  };
  const result = await deployControlPlane(args);
  assert.equal(result.state, "deployed_needs_http_acceptance");
  assert.equal(result.priorSchemaAndEndpointsPreserved, true);
  assert.equal(existsSync(stage), false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|sbp_/);
  await assert.rejects(deployControlPlane(args), /Exact installed/);
  assert.throws(() => deployControlPlane({ ...args, replaceVersions: { "openfolk-control-plane": 1 } }), /First installation only/);
});
