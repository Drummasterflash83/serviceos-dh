import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deployPhonePageGuards,
  phonePageGuardsBundle,
  PHONE_PAGE_GUARDS_SHA,
  PHONE_PAGE_GUARDS_DATABASE,
} from "./learn-test-phone-page-guards-deploy.mjs";
import { RUNTIME_PRESERVED } from "./learn-email-runtime-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
test("phone replacement pins both complete handler closures and only TEST v3 endpoints", async () => {
  const bundle = phonePageGuardsBundle();
  assert.equal(bundle.sha256, PHONE_PAGE_GUARDS_SHA);
  assert.ok(bundle.files.some((f) => f.path === "_shared/phone-capture-guard.ts"));
  const names = ["simwood-sync-calls", "simwood-sync-recordings"];
  let journaled = false;
  const sent = [];
  const args = {
    allowProjectRef: TEST_PROJECT,
    token: "sbp_" + "0".repeat(40),
    persistJournal: async () => {
      journaled = true;
    },
    fetcher: async (url, opts) => {
      assert.ok(String(url).startsWith(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/`));
      if (url.endsWith("/functions"))
        return Response.json(
          names.map((slug) => ({
            slug,
            status: "ACTIVE",
            version: sent.includes(slug) ? 4 : 3,
            verify_jwt: true,
          })),
        );
      if (JSON.parse(opts.body).query.includes(" as catalog,"))
        return Response.json([
          { catalog: { functions: [] }, fingerprint: PHONE_PAGE_GUARDS_DATABASE },
        ]);
      return Response.json(
        RUNTIME_PRESERVED.map((name) => ({ name, count: 0, fingerprint: "0".repeat(32) })),
      );
    },
    runCli: (_cmd, args) => {
      assert.ok(journaled);
      assert.ok(names.includes(args[2]));
      assert.ok(!sent.includes(args[2]));
      const stage = args[args.indexOf("--workdir") + 1];
      for (const f of bundle.files)
        assert.equal(readFileSync(join(stage, "supabase/functions", f.path), "utf8"), f.source);
      sent.push(args[2]);
      return { status: 0 };
    },
  };
  const result = await deployPhonePageGuards(args);
  assert.equal(result.state, "deployed_needs_http_acceptance");
  assert.deepEqual(sent, names);
  await assert.rejects(deployPhonePageGuards(args), /Exact installed/);
  assert.throws(
    () => deployPhonePageGuards({ ...args, replaceVersions: { "simwood-sync-calls": 4 } }),
    /Replacement versions/,
  );
});
