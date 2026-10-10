/** Verify installed TEST SQL with the reviewed rollback probe; no provider calls. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readTraversalCatalog,
  TRAVERSAL_SNAPSHOT,
  traversalSnapshot,
} from "./learn-commusoft-contact-traversal-catalog.mjs";
import { readRuntimeCatalog } from "./learn-email-runtime-catalog.mjs";
import { edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
import { contactTraversalPackage } from "./learn-commusoft-contact-traversal-release.mjs";
try {
  assert.equal(process.argv.slice(2).join(" "), "--verify --existing-cli-login");
  assert.equal(process.env.LEARN_TEST_ALLOW_PROJECT_REF, TEST_PROJECT);
  contactTraversalPackage();
  const token = savedCliToken();
  const before = await readTraversalCatalog(token);
  assert.equal(before.fingerprint, "195ca207f0d8a7a95b0fb30580e093fd");
  const preserved = traversalSnapshot(await communicationQuery(token, TRAVERSAL_SNAPSHOT)),
    endpoints = await edgeInventory(token);
  assert.deepEqual(
    await communicationQuery(
      token,
      "select (select count(*)::int from public.learn_commusoft_contact_targets) as targets,(select count(*)::int from public.platform_jobs where job_type='commusoft.source_sync' and status in ('queued','running','retrying')) as active_jobs",
    ),
    [{ targets: 0, active_jobs: 0 }],
  );
  const sql =
    "begin;set local search_path=public,pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';\n" +
    readFileSync("scripts/verify/learn-commusoft-contact-traversal-hosted.assert.sql", "utf8") +
    "\nrollback;select 'contact-traversal-acceptance' as marker";
  assert.deepEqual(await communicationQuery(token, sql, { readOnly: false }), [
    { marker: "contact-traversal-acceptance" },
  ]);
  assert.deepEqual(
    traversalSnapshot(await communicationQuery(token, TRAVERSAL_SNAPSHOT)),
    preserved,
  );
  assert.equal((await readTraversalCatalog(token)).fingerprint, before.fingerprint);
  assert.deepEqual(await edgeInventory(token), endpoints);
  assert.deepEqual(
    await communicationQuery(
      token,
      "select count(*)::int as targets from public.learn_commusoft_contact_targets",
    ),
    [{ targets: 0 }],
  );
  const runtime = await readRuntimeCatalog(token);
  const report = {
    version: "contact-traversal-hosted/1",
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    state: "service_sql_verified",
    schemaFingerprint: before.fingerprint,
    runtimeFingerprint: runtime.fingerprint,
    preservedDataSets: preserved.length,
    newTargetRows: 0,
    endpointsUnchanged: true,
    limits: [
      "Reviewed synthetic service-path rollback probe only; no real provider call, credential, login or operator grant.",
      "Signed-in operator plan creation and hosted real import still need acceptance.",
    ],
  };
  writeFileSync(
    ".verification-results/contact-traversal-hosted.json",
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
} catch {
  console.error(
    "Hosted traversal check unconfirmed; inspect schema and retained evidence before further action.",
  );
  process.exitCode = 1;
}
