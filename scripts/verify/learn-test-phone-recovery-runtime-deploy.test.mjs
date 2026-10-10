import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deployPhoneRecoveryRuntime,
  phoneRecoveryRuntimeBundle,
  PHONE_RECOVERY_RUNTIME_SHA,
  PHONE_RECOVERY_RUNTIME_DATABASE,
  PHONE_RECOVERY_RUNTIME_SCHEMA,
} from "./learn-test-phone-recovery-runtime-deploy.mjs";
import { RUNTIME_PRESERVED } from "./learn-email-runtime-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
test("phone replacement pins both complete handler closures and TEST worker v4 and missing manual endpoint", async () => {
  const bundle = phoneRecoveryRuntimeBundle();
  assert.equal(bundle.sha256, PHONE_RECOVERY_RUNTIME_SHA);
  assert.ok(bundle.files.some((f) => f.path === "_shared/phone-recovery-job.ts"));
  const names = ["platform-worker", "phone-process-pending"];
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
          names
            .filter((slug) => slug === "platform-worker" || sent.includes(slug))
            .map((slug) => ({
              slug,
              status: "ACTIVE",
              version: slug === "platform-worker" ? (sent.includes(slug) ? 5 : 4) : 1,
              verify_jwt: slug !== "platform-worker",
            })),
        );
      if (JSON.parse(opts.body).query.includes("learn_phone_publish_page"))
        return Response.json([
          { catalog: { phone: { functions: [] } }, fingerprint: PHONE_RECOVERY_RUNTIME_SCHEMA },
        ]);
      if (JSON.parse(opts.body).query.includes(" as catalog,"))
        return Response.json([
          { catalog: { functions: [] }, fingerprint: PHONE_RECOVERY_RUNTIME_DATABASE },
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
  const result = await deployPhoneRecoveryRuntime(args);
  assert.equal(result.state, "deployed_needs_http_acceptance");
  assert.deepEqual(sent, names);
  await assert.rejects(deployPhoneRecoveryRuntime(args), /Exact installed/);
  await assert.rejects(
    () => deployPhoneRecoveryRuntime({ ...args, replaceVersions: { "platform-worker": 4 } }),
    /Replacement versions/,
  );
});

test("missing or changed Phone publication schema prevents a handler replacement", async () => {
  let writes = 0;
  await assert.rejects(
    deployPhoneRecoveryRuntime({
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
