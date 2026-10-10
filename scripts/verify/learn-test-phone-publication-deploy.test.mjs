import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deployPhonePublication,
  phonePublicationBundle,
  PHONE_PUBLICATION_SHA,
  PHONE_PUBLICATION_DATABASE,
  PHONE_PUBLICATION_SCHEMA,
} from "./learn-test-phone-publication-deploy.mjs";
import { RUNTIME_PRESERVED } from "./learn-email-runtime-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
test("phone replacement pins both complete handler closures and only TEST v4 endpoints", async () => {
  const bundle = phonePublicationBundle();
  assert.equal(bundle.sha256, PHONE_PUBLICATION_SHA);
  assert.ok(bundle.files.some((f) => f.path === "_shared/phone-page-publication.ts"));
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
            version: sent.includes(slug) ? 5 : 4,
            verify_jwt: true,
          })),
        );
      if (JSON.parse(opts.body).query.includes("learn_phone_publish_page"))
        return Response.json([
          { catalog: { phone: { functions: [] } }, fingerprint: PHONE_PUBLICATION_SCHEMA },
        ]);
      if (JSON.parse(opts.body).query.includes(" as catalog,"))
        return Response.json([
          { catalog: { functions: [] }, fingerprint: PHONE_PUBLICATION_DATABASE },
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
  const result = await deployPhonePublication(args);
  assert.equal(result.state, "deployed_needs_http_acceptance");
  assert.deepEqual(sent, names);
  await assert.rejects(deployPhonePublication(args), /Exact installed/);
  await assert.rejects(
    () => deployPhonePublication({ ...args, replaceVersions: { "simwood-sync-calls": 4 } }),
    /Replacement versions/,
  );
});

test("missing or changed Phone publication schema prevents a handler replacement", async () => {
  let writes = 0;
  await assert.rejects(
    deployPhonePublication({
      allowProjectRef: TEST_PROJECT,
      token: "sbp_" + "0".repeat(40),
      persistJournal: async () => {
        writes++;
      },
      runCli: () => {
        writes++;
      },
      fetcher: async () =>
        Response.json([{ catalog: { phone: { functions: [] } }, fingerprint: "0".repeat(32) }]),
    }),
    /Exact phone publication schema/,
  );
  assert.equal(writes, 0);
});
