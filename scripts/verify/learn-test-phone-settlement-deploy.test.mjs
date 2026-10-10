import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deployPhoneSettlementRuntime,
  phoneSettlementRuntimeBundle,
  PHONE_SETTLEMENT_RUNTIME_SHA,
  PHONE_SETTLEMENT_RUNTIME_SCHEMA,
  PHONE_SETTLEMENT_RUNTIME_DATABASE,
} from "./learn-test-phone-settlement-deploy.mjs";
import { SETTLEMENT_SNAPSHOT, SETTLEMENT_PRESERVED } from "./learn-phone-settlement-catalog.mjs";
import { RUNTIME_PRESERVED } from "./learn-email-runtime-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
const names = ["simwood-sync-calls", "simwood-sync-recordings", "phone-scheduled-sync"];
const rows = (names) => names.map((name) => ({ name, count: 0, fingerprint: "0".repeat(32) }));
function fixture({
  schema = PHONE_SETTLEMENT_RUNTIME_SCHEMA,
  activeSchedule = false,
  providerCredentials = false,
  changedSources = false,
} = {}) {
  let journaled = false;
  const sent = [];
  const bundle = phoneSettlementRuntimeBundle();
  return {
    sent,
    args: {
      allowProjectRef: TEST_PROJECT,
      token: "sbp_" + "0".repeat(40),
      persistJournal: async () => {
        journaled = true;
      },
      fetcher: async (url, opts) => {
        assert.ok(String(url).startsWith(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/`));
        if (url.endsWith("/secrets"))
          return Response.json(providerCredentials ? [{ name: "SIMWOOD_PASSWORD" }] : []);
        if (url.endsWith("/functions"))
          return Response.json(
            names
              .filter((slug) => slug !== "phone-scheduled-sync" || sent.includes(slug))
              .map((slug) => ({
                slug,
                status: "ACTIVE",
                version: slug === "phone-scheduled-sync" ? 1 : sent.includes(slug) ? 6 : 5,
                verify_jwt: slug !== "phone-scheduled-sync",
              })),
          );
        const query = JSON.parse(opts.body).query;
        if (query.includes("to_regclass('cron.job')"))
          return Response.json([{ present: activeSchedule }]);
        if (query.includes("from cron.job")) return Response.json([{ count: 1 }]);
        if (query.includes(" as catalog,"))
          return Response.json([
            {
              catalog: { phone: { functions: [] }, functions: [] },
              fingerprint: query.includes("learn_phone_settle_schedule")
                ? schema
                : PHONE_SETTLEMENT_RUNTIME_DATABASE,
            },
          ]);
        const preserved = rows(
          query === SETTLEMENT_SNAPSHOT ? SETTLEMENT_PRESERVED : RUNTIME_PRESERVED,
        );
        if (changedSources && sent.length === 3 && query === SETTLEMENT_SNAPSHOT)
          preserved[0].count = 1;
        return Response.json(preserved);
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
    },
  };
}
test("deployment pins complete import/scheduler source closures, versions, auth gates and preserved datasets", async () => {
  const b = phoneSettlementRuntimeBundle();
  assert.equal(b.sha256, PHONE_SETTLEMENT_RUNTIME_SHA);
  assert.equal(b.files.length, 14);
  for (const file of ["_shared/phone-import-completion.ts", "_shared/phone-schedule-settlement.ts"])
    assert.ok(b.files.some((f) => f.path === file));
  const f = fixture();
  const result = await deployPhoneSettlementRuntime(f.args);
  assert.equal(result.state, "deployed_needs_http_acceptance");
  assert.equal(result.phonePreservedDataSets, 75);
  assert.deepEqual(f.sent, names);
  await assert.rejects(deployPhoneSettlementRuntime(f.args), /Exact installed/);
  await assert.rejects(
    deployPhoneSettlementRuntime({ ...f.args, replaceVersions: { "simwood-sync-calls": 5 } }),
    /Replacement versions/,
  );
});
test("schema drift, provider credentials or active scheduler prevent deployment", async () => {
  for (const opts of [
    { schema: "0".repeat(32) },
    { activeSchedule: true },
    { providerCredentials: true },
  ]) {
    const f = fixture(opts);
    await assert.rejects(deployPhoneSettlementRuntime(f.args));
    assert.deepEqual(f.sent, []);
  }
});
test("post-deployment Phone data drift cannot report a verified release", async () => {
  const f = fixture({ changedSources: true });
  const result = await deployPhoneSettlementRuntime(f.args);
  assert.equal(result.state, "requires_inspection");
  assert.equal(f.sent.length, 3);
});
