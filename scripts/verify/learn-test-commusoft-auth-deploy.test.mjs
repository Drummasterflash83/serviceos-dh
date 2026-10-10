import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deployCommusoftAuth,
  commusoftAuthBundle,
  COMMUSOFT_AUTH_SHA,
  COMMUSOFT_AUTH_DATABASE,
  COMMUSOFT_AUTH_SNAPSHOT,
  COMMUSOFT_AUTH_IDLE,
  COMMUSOFT_AUTH_PRESERVED,
} from "./learn-test-commusoft-auth-deploy.mjs";
import { RUNTIME_PRESERVED } from "./learn-email-runtime-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
function fixture({ active = false, drift = false, version = 2, exit = 0 } = {}) {
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
              version: sent.includes(slug) ? 3 : version,
            })),
          );
        const query = JSON.parse(init.body).query;
        if (query === COMMUSOFT_AUTH_IDLE)
          return Response.json([
            { active_jobs: active ? 1 : 0, unrevoked_connections: 0, unfinished_checks: 0 },
          ]);
        if (query.includes(" as catalog,"))
          return Response.json([
            { catalog: { functions: [] }, fingerprint: COMMUSOFT_AUTH_DATABASE },
          ]);
        return Response.json(
          (query === COMMUSOFT_AUTH_SNAPSHOT ? COMMUSOFT_AUTH_PRESERVED : RUNTIME_PRESERVED).map(
            (name) => ({
              name,
              count: drift && sent.length && query === COMMUSOFT_AUTH_SNAPSHOT ? 1 : 0,
              fingerprint: "0".repeat(32),
            }),
          ),
        );
      },
      runCli: (_cmd, args) => {
        assert.ok(journal.extendedPreserved.length === 77);
        assert.ok(!args.includes("--prune"));
        const stage = args[args.indexOf("--workdir") + 1];
        for (const f of commusoftAuthBundle().files)
          assert.equal(readFileSync(join(stage, "supabase/functions", f.path), "utf8"), f.source);
        sent.push(args[2]);
        return { status: exit };
      },
    },
  };
}
test("pins both complete corrected source closures and existing JWT-enabled versions", async () => {
  const b = commusoftAuthBundle();
  assert.equal(b.sha256, COMMUSOFT_AUTH_SHA);
  assert.equal(b.files.length, 12);
  const f = fixture();
  const r = await deployCommusoftAuth(f.args);
  assert.equal(r.state, "deployed_needs_http_acceptance");
  assert.equal(r.extendedPreservedDataSets, 77);
  assert.deepEqual(f.sent, ["learn-commusoft-worker", "learn-commusoft-verify"]);
});
test("active work, wrong target and stale endpoint versions refuse submission", async () => {
  for (const options of [{ active: true }, { version: 3 }]) {
    const f = fixture(options);
    await assert.rejects(deployCommusoftAuth(f.args));
    assert.equal(f.sent.length, 0);
  }
  const f = fixture();
  await assert.rejects(deployCommusoftAuth({ ...f.args, allowProjectRef: "production" }));
  assert.equal(f.sent.length, 0);
});
test("data drift and ambiguous deployment cannot look verified or trigger a retry", async () => {
  const f = fixture({ drift: true });
  assert.equal((await deployCommusoftAuth(f.args)).state, "requires_inspection");
  const g = fixture({ exit: null });
  assert.equal((await deployCommusoftAuth(g.args)).state, "requires_inspection");
  assert.equal(g.sent.length, 1);
});
