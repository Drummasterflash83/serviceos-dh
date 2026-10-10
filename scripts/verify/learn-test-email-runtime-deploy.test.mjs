import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  deployEmailRuntime,
  EMAIL_RUNTIME_DATABASE,
  EMAIL_RUNTIME_EDGE_SHA,
} from "./learn-test-email-runtime-deploy.mjs";
import { emailRuntimeBundle, EMAIL_RUNTIME_ENDPOINTS } from "./learn-email-runtime-edge-bundle.mjs";
import { RUNTIME_PRESERVED } from "./learn-email-runtime-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
const token = "sbp_" + "0".repeat(40);
function fixture({
  exit = 0,
  schemaChanged = false,
  existing = false,
  sourceChanged = false,
  replacement = false,
} = {}) {
  let journal,
    stage,
    calls = 0;
  const before = [{ slug: "existing-worker", version: 1, verify_jwt: true, status: "ACTIVE" }],
    created = [];
  if (existing)
    before.push({ slug: "platform-worker", version: 1, verify_jwt: false, status: "ACTIVE" });
  if (replacement)
    for (const e of EMAIL_RUNTIME_ENDPOINTS)
      before.push({ slug: e.name, version: 1, verify_jwt: e.verifyJwt, status: "ACTIVE" });
  return {
    get calls() {
      return calls;
    },
    get stage() {
      return stage;
    },
    get journal() {
      return journal;
    },
    persistJournal: async (j) => {
      journal = j;
    },
    fetcher: async (url, options) => {
      assert.ok(String(url).startsWith(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/`));
      if (String(url).endsWith("/functions"))
        return Response.json([
          ...before.filter((b) => !created.some((c) => c.slug === b.slug)),
          ...created,
        ]);
      assert.ok(String(url).endsWith("/read-only"));
      const sql = JSON.parse(options.body).query;
      if (sql.includes(" as catalog,"))
        return Response.json([
          {
            catalog: { functions: [] },
            fingerprint: schemaChanged ? "0".repeat(32) : EMAIL_RUNTIME_DATABASE,
          },
        ]);
      return Response.json(
        RUNTIME_PRESERVED.map((name) => ({
          name,
          count: sourceChanged && calls ? 1 : 0,
          fingerprint: "0".repeat(32),
        })),
      );
    },
    runCli: (_binary, args, opts) => {
      assert.ok(journal);
      calls++;
      stage = args[args.indexOf("--workdir") + 1];
      assert.deepEqual(args.slice(0, 2), ["functions", "deploy"]);
      assert.equal(args[args.indexOf("--project-ref") + 1], TEST_PROJECT);
      assert.ok(args.includes("--use-api"));
      assert.ok(!args.includes("--prune"));
      assert.equal(opts.env.SUPABASE_ACCESS_TOKEN, token);
      const bundle = emailRuntimeBundle();
      for (const f of bundle.files)
        assert.equal(readFileSync(join(stage, "supabase/functions", f.path), "utf8"), f.source);
      assert.equal(existsSync(join(stage, ".env")), false);
      const config = readFileSync(join(stage, "supabase/config.toml"), "utf8");
      for (const e of EMAIL_RUNTIME_ENDPOINTS)
        assert.ok(config.includes(`[functions.${e.name}]\nverify_jwt = ${e.verifyJwt}`));
      const target = EMAIL_RUNTIME_ENDPOINTS.find((e) => e.name === args[2]);
      created.push({
        slug: target.name,
        version: replacement ? 2 : 1,
        verify_jwt: target.verifyJwt,
        status: "ACTIVE",
      });
      return { status: exit, stdout: "PRIVATE_KEY", stderr: "PRIVATE_DIAGNOSTIC" };
    },
  };
}
const args = { allowProjectRef: TEST_PROJECT, token };
test("pinned closure includes email engine, credentials and all generic-worker dependencies", () => {
  const b = emailRuntimeBundle();
  assert.equal(b.sha256, EMAIL_RUNTIME_EDGE_SHA);
  assert.equal(b.files.length, 100);
  assert.deepEqual(b.external, ["https://esm.sh/@supabase/supabase-js@2.45.4"]);
  for (const path of [
    "_shared/email_capture_engine.ts",
    "_shared/email_capture_ports.ts",
    "_shared/email_enqueue.ts",
    "_shared/worker_handlers/index.ts",
  ])
    assert.ok(b.files.some((f) => f.path === path));
});
test("deployment stages exact files/auth settings and preserves other endpoints, schema and sources", async () => {
  const f = fixture();
  const r = await deployEmailRuntime({ ...args, ...f });
  assert.equal(r.state, "deployed_needs_http_acceptance");
  assert.equal(f.calls, 4);
  assert.equal(r.preservedDataSets, 52);
  assert.equal(existsSync(f.stage), false);
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_|sbp_/);
});
test("wrong project, schema drift, existing targets and journal failure prevent CLI writes", async () => {
  for (const config of [{ schemaChanged: true }, { existing: true }]) {
    const f = fixture(config);
    await assert.rejects(deployEmailRuntime({ ...args, ...f }), /Exact installed/);
    assert.equal(f.calls, 0);
  }
  const f = fixture();
  await assert.rejects(
    deployEmailRuntime({ ...args, ...f, allowProjectRef: "production" }),
    /Explicit TEST/,
  );
  await assert.rejects(
    deployEmailRuntime({
      ...args,
      ...f,
      persistJournal: async () => {
        throw Error("disk full");
      },
    }),
    /disk full/,
  );
  assert.equal(f.calls, 0);
});
test("uncertain CLI result stops deployment, inspects once and never resubmits", async () => {
  const f = fixture({ exit: null });
  const r = await deployEmailRuntime({ ...args, ...f });
  assert.equal(r.state, "requires_inspection");
  assert.equal(f.calls, 1);
  assert.equal(r.endpoints.length, 1);
  assert.equal(existsSync(f.stage), false);
});
test("changed retained sources prevent a successful deployment verdict", async () => {
  const f = fixture({ sourceChanged: true });
  const r = await deployEmailRuntime({ ...args, ...f });
  assert.equal(r.state, "requires_inspection");
  assert.equal(r.priorSchemaAndEndpointsPreserved, false);
});
test("replacement requires exact existing versions and verifies their single version advance", async () => {
  const versions = Object.fromEntries(EMAIL_RUNTIME_ENDPOINTS.map((e) => [e.name, 1]));
  const wrong = fixture({ replacement: true });
  await assert.rejects(
    deployEmailRuntime({
      ...args,
      ...wrong,
      replaceVersions: { ...versions, "platform-worker": 2 },
    }),
    /Exact installed/,
  );
  assert.equal(wrong.calls, 0);
  const f = fixture({ replacement: true });
  const r = await deployEmailRuntime({ ...args, ...f, replaceVersions: versions });
  assert.equal(r.state, "deployed_needs_http_acceptance");
  assert.equal(
    r.endpoints.every((e) => e.version === 2),
    true,
  );
});
