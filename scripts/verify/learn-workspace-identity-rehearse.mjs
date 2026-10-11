/** TEST 066 rollback-only identity migration rehearsal. No accounts/grants/providers. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { readQueueCatalog, queueInstalledSnapshot } from "./learn-processing-queue-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
const prefix = ".verification-results/workspace-identity-rehearsal-v1";
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
  if (catalog.fingerprint !== "e7897de65753b003869960b6b054215d")
    throw Error("Exact TEST release 066 required");
  const absence =
    "select not exists(select 1 from information_schema.columns where table_schema='public' and table_name='google_workspace_mailboxes' and column_name in ('directory_primary_email','directory_identity_conflict')) as columns_absent, to_regprocedure('public.learn_workspace_identity_guard()') is null as guard_absent, not exists(select 1 from tenants where id='eb190660-cccc-4000-8000-000000000001') as fixture_absent";
  async function absent() {
    const r = await communicationQuery(token, absence);
    if (r.length !== 1 || !Object.values(r[0]).every((v) => v === true))
      throw Error("Identity candidate or fixture already present");
  }
  await absent();
  const snapshot = queueInstalledSnapshot(catalog.catalog.phone),
    before = await communicationQuery(token, snapshot);
  if (before.length !== 121) throw Error("Complete preservation baseline required");
  const migration = readFileSync(
      "supabase/migrations/20261101360000_learn_workspace_mailbox_identity.sql",
      "utf8",
    ),
    probe = readFileSync("scripts/verify/learn-workspace-identity-probe.sql", "utf8");
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
    `begin;set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;${body}\n${probe}\nselect 'workspace_identity_passed' as marker;rollback;`,
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
  if (!r.some((r) => r.marker === "workspace_identity_passed"))
    throw Error("Rehearsal marker missing");
  await absent();
  const after = await communicationQuery(token, snapshot),
    afterCatalog = await readQueueCatalog(token);
  if (canonical(before) !== canonical(after) || catalog.fingerprint !== afterCatalog.fingerprint)
    throw Error("Rollback preservation differs");
  const report = {
    version: "learn-workspace-identity-rehearsal/1",
    state: "full_schema_rehearsed_and_rolled_back",
    observedAt: new Date().toISOString(),
    projectRef: TEST_PROJECT,
    migrationSha256: journal.migrationSha256,
    probeSha256: journal.probeSha256,
    preservedDatasets: 121,
    schemaRestored: true,
    fixturesRemoved: true,
    usersCreated: 0,
    grantsCreated: 0,
    providerRequests: 0,
    productionChanged: false,
    limitations: [
      "Synthetic SQL assertions; no persistent migration or positive hosted capture.",
      "An identity conflict remains held for explicit operator recovery; the migration never rewrites old email/account identities.",
    ],
  };
  writeFileSync(prefix + "-result.json", JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error("Workspace identity rehearsal unconfirmed: " + e.message);
  process.exitCode = 1;
}
