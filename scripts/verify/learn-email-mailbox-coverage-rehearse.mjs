/** TEST 067 rollback-only mailbox coverage migration rehearsal. No accounts/grants/providers. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { readQueueCatalog, queueInstalledSnapshot } from "./learn-processing-queue-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  emailMigrationAccessBegin,
  emailMigrationAccessEnd,
  emailMigrationAccessSnapshot,
} from "./learn-email-migration-access.mjs";
const prefix = ".verification-results/email-mailbox-coverage-rehearsal-v2";
const canonical = (r) => JSON.stringify([...r].sort((a, b) => a.name.localeCompare(b.name)));
const hash = (s) => createHash("sha256").update(s).digest("hex");
try {
  if (
    process.argv.slice(2).join(" ") !== "--rehearse --existing-cli-login" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
  )
    throw Error("Explicit TEST rehearsal required");
  const token = savedCliToken(),
    catalog = await readQueueCatalog(token);
  if (catalog.fingerprint !== "2eec67c4d0bb0841283d17f7961a88f0")
    throw Error("Exact TEST release 067 required");
  const absence =
    "select md5(pg_get_functiondef('public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)'::regprocedure))='f3ec156589e8509cc6dceac9ceb0b291' as original_transition, not exists(select 1 from tenants where id='ec370670-cccc-4000-8000-000000000001') as fixture_absent";
  async function absent() {
    const r = await communicationQuery(token, absence);
    if (r.length !== 1 || !Object.values(r[0]).every((v) => v === true))
      throw Error("Coverage candidate or fixture already present");
  }
  await absent();
  const authorityBefore = await communicationQuery(token, emailMigrationAccessSnapshot);
  const snapshot = queueInstalledSnapshot(catalog.catalog.phone),
    before = await communicationQuery(token, snapshot);
  if (before.length !== 121) throw Error("Complete preservation baseline required");
  const migration = readFileSync(
      "supabase/migrations/20261101370000_learn_email_mailbox_coverage.sql",
      "utf8",
    ),
    probe = readFileSync("scripts/verify/learn-email-mailbox-coverage-probe.sql", "utf8");
  const journal = {
    state: "prepared",
    projectRef: TEST_PROJECT,
    startedAt: new Date().toISOString(),
    schema: catalog.fingerprint,
    before,
    migrationSha256: hash(migration),
    probeSha256: hash(probe),
  };
  writeFileSync(prefix + "-journal.json", JSON.stringify(journal, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  journal.state = "submitted";
  writeFileSync(prefix + "-journal.json", JSON.stringify(journal, null, 2), { mode: 0o600 });
  const body = migration.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
  const r = await communicationQuery(
    token,
    `begin;set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;${emailMigrationAccessBegin}\n${body}\n${emailMigrationAccessEnd}\n${probe}\nselect 'mailbox_coverage_passed' as marker;rollback;`,
    {
      readOnly: false,
      fetcher: async (url, options) => {
        const result = await fetch(url, options);
        if (!result.ok)
          writeFileSync(prefix + "-sql-error.txt", (await result.clone().text()).slice(0, 10000), {
            mode: 0o600,
          });
        return result;
      },
    },
  );
  if (!r.some((r) => r.marker === "mailbox_coverage_passed"))
    throw Error("Rehearsal marker missing");
  await absent();
  const after = await communicationQuery(token, snapshot),
    afterCatalog = await readQueueCatalog(token);
  if (canonical(before) !== canonical(after) || catalog.fingerprint !== afterCatalog.fingerprint)
    throw Error("Rollback preservation differs");
  const authorityAfter = await communicationQuery(token, emailMigrationAccessSnapshot);
  if (JSON.stringify(authorityBefore) !== JSON.stringify(authorityAfter))
    throw Error("Migration authority was not restored");
  const report = {
    version: "learn-email-mailbox-coverage-rehearsal/1",
    state: "full_schema_rehearsed_and_rolled_back",
    observedAt: new Date().toISOString(),
    projectRef: TEST_PROJECT,
    migrationSha256: journal.migrationSha256,
    probeSha256: journal.probeSha256,
    preservedDatasets: 121,
    schemaRestored: true,
    authorityRestored: true,
    fixturesRemoved: true,
    usersCreated: 0,
    persistentRoleGrantsCreated: 0,
    temporaryMembershipsRevoked: 1,
    providerRequests: 0,
    productionChanged: false,
    limitations: [
      "Synthetic SQL assertions; no persistent migration or positive hosted capture.",
      "Historical backfill still has its legacy scope; the first v3 recent reconciliation fills those gaps.",
    ],
  };
  writeFileSync(prefix + "-result.json", JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error("Mailbox coverage rehearsal unconfirmed: " + e.message);
  process.exitCode = 1;
}
