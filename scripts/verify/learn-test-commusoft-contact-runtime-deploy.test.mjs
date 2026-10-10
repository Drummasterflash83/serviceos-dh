import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deployContactRuntime,
  contactRuntimeBundle,
  CONTACT_RUNTIME_SHA,
  CONTACT_RUNTIME_DATABASE,
  CONTACT_RUNTIME_SNAPSHOT,
  CONTACT_RUNTIME_IDLE,
  CONTACT_RUNTIME_PRESERVED,
} from "./learn-test-commusoft-contact-runtime-deploy.mjs";
import { TRAVERSAL_CATALOG } from "./learn-commusoft-contact-traversal-catalog.mjs";
import { RUNTIME_PRESERVED } from "./learn-email-runtime-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
function fixture({ active = false, drift = false, version = 3, exit = 0 } = {}) {
  const sent = [];
  let journal;
  return {
    sent,
    args: {
      allowProjectRef: TEST_PROJECT,
      token: "sbp_" + "0".repeat(40),
      persistJournal: async (j) => {
        journal = j;
      },
      fetcher: async (url, init) => {
        assert.ok(url.startsWith(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/`));
        if (url.endsWith("/functions"))
          return Response.json(
            ["learn-commusoft-worker", "learn-commusoft-verify"].map((slug) => ({
              slug,
              status: "ACTIVE",
              verify_jwt: true,
              version: sent.includes(slug) ? 4 : version,
            })),
          );
        const query = JSON.parse(init.body).query;
        if (query === CONTACT_RUNTIME_IDLE)
          return Response.json([
            { active_jobs: active ? 1 : 0, unrevoked_connections: 0, unfinished_checks: 0 },
          ]);
        if (query.includes(TRAVERSAL_CATALOG))
          return Response.json([
            {
              catalog: { contacts: { functions: [] } },
              fingerprint: "195ca207f0d8a7a95b0fb30580e093fd",
            },
          ]);
        if (query.includes(" as catalog,"))
          return Response.json([
            { catalog: { functions: [] }, fingerprint: CONTACT_RUNTIME_DATABASE },
          ]);
        return Response.json(
          (query === CONTACT_RUNTIME_SNAPSHOT ? CONTACT_RUNTIME_PRESERVED : RUNTIME_PRESERVED).map(
            (name) => ({
              name,
              count: drift && sent.length && query === CONTACT_RUNTIME_SNAPSHOT ? 1 : 0,
              fingerprint: "0".repeat(32),
            }),
          ),
        );
      },
      runCli: (_cmd, args) => {
        assert.ok(journal.extendedPreserved.length === 78);
        assert.ok(!args.includes("--prune"));
        const stage = args[args.indexOf("--workdir") + 1];
        for (const f of contactRuntimeBundle().files)
          assert.equal(readFileSync(join(stage, "supabase/functions", f.path), "utf8"), f.source);
        sent.push(args[2]);
        return { status: exit };
      },
    },
  };
}
test("pins both complete corrected source closures and existing JWT-enabled versions", async () => {
  const b = contactRuntimeBundle();
  assert.equal(b.sha256, CONTACT_RUNTIME_SHA);
  assert.equal(b.files.length, 12);
  const f = fixture();
  const r = await deployContactRuntime(f.args);
  assert.equal(r.state, "deployed_needs_http_acceptance");
  assert.equal(r.extendedPreservedDataSets, 78);
  assert.deepEqual(f.sent, ["learn-commusoft-worker", "learn-commusoft-verify"]);
});
test("active work, wrong target and stale endpoint versions refuse submission", async () => {
  for (const options of [{ active: true }, { version: 4 }]) {
    const f = fixture(options);
    await assert.rejects(deployContactRuntime(f.args));
    assert.equal(f.sent.length, 0);
  }
  const f = fixture();
  await assert.rejects(deployContactRuntime({ ...f.args, allowProjectRef: "production" }));
  assert.equal(f.sent.length, 0);
});
test("data drift and ambiguous deployment cannot look verified or trigger a retry", async () => {
  const f = fixture({ drift: true });
  assert.equal((await deployContactRuntime(f.args)).state, "requires_inspection");
  const g = fixture({ exit: null });
  assert.equal((await deployContactRuntime(g.args)).state, "requires_inspection");
  assert.equal(g.sent.length, 1);
});
