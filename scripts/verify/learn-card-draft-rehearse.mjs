/** TEST 069 rollback-only card projection eligibility migration rehearsal. No accounts/grants/providers. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { readQueueCatalog, queueInstalledSnapshot } from "./learn-processing-queue-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
const prefix = ".verification-results/card-draft-rehearsal-v1";
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
  if (catalog.fingerprint !== "db53a9b09d1cf3b70dea70278c1b7338")
    throw Error("Exact TEST release 069 required");
  const absence =
    "select to_regprocedure('public.learn_card_projection_inputs(uuid,uuid)') is null as reader_absent, not exists(select 1 from tenants where id in('ed390000-aaaa-4000-8000-000000000001','ed390000-aaaa-4000-8000-000000000009')) as fixtures_absent";
  async function absent() {
    const r = await communicationQuery(token, absence);
    if (r.length !== 1 || !Object.values(r[0]).every((v) => v === true))
      throw Error("Coverage candidate or fixture already present");
  }
  await absent();

  const snapshot = queueInstalledSnapshot(catalog.catalog.phone),
    before = await communicationQuery(token, snapshot);
  if (before.length !== 121) throw Error("Complete preservation baseline required");
  const migration = readFileSync(
      "supabase/migrations/20261101390000_learn_card_projection_eligibility.sql",
      "utf8",
    ),
    probe = readFileSync("scripts/verify/learn-card-draft-probe.sql", "utf8");
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
    `begin;set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;${body}\n${probe}\nselect 'card_draft_eligibility_passed' as marker;rollback;`,
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
  if (!r.some((r) => r.marker === "card_draft_eligibility_passed"))
    throw Error("Rehearsal marker missing");
  await absent();
  const after = await communicationQuery(token, snapshot),
    afterCatalog = await readQueueCatalog(token);
  if (canonical(before) !== canonical(after) || catalog.fingerprint !== afterCatalog.fingerprint)
    throw Error("Rollback preservation differs");
  const report = {
    version: "learn-card-draft-rehearsal/1",
    state: "full_schema_rehearsed_and_rolled_back",
    observedAt: new Date().toISOString(),
    projectRef: TEST_PROJECT,
    migrationSha256: journal.migrationSha256,
    probeSha256: journal.probeSha256,
    preservedDatasets: 121,
    schemaRestored: true,

    fixturesRemoved: true,
    usersCreated: 0,
    persistentRoleGrantsCreated: 0,
    temporaryMembershipsRevoked: 0,
    providerRequests: 0,
    productionChanged: false,
    limitations: [
      "Synthetic SQL assertions; no persistent migration or positive hosted capture.",
      "Production card refresh and reconciliation require a separately reviewed release; no source or derived data changed.",
    ],
  };
  writeFileSync(prefix + "-result.json", JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error("Draft eligibility rehearsal unconfirmed: " + e.message);
  process.exitCode = 1;
}
