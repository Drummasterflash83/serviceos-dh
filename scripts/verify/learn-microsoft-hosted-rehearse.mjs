/** Explicit TEST-only full-schema rehearsal. No committed fixtures or activation. */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readPhoneSavedResultsCatalog,
  phoneSavedResultsSourceQuery,
} from "./learn-phone-saved-results-catalog.mjs";
const prefix = ".verification-results/microsoft-full-schema-rehearsal";
const migrations = [
  "20261101180000_learn_microsoft_source_journal.sql",
  "20261101181000_learn_microsoft_job_receipts.sql",
  "20261101182000_learn_microsoft_queue_completion.sql",
  "20261101192000_learn_microsoft_folder_dispatch.sql",
  "20261101260000_learn_microsoft_incremental_queue.sql",
];
const hash = (s) => createHash("sha256").update(s).digest("hex");
const order = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
const absence = `select
 not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'learn_microsoft_%') as tables_absent,
 not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'learn_microsoft_%') as functions_absent,
 not exists(select 1 from tenants where id='eb190660-aaaa-4000-8000-000000000001') as fixture_absent`;
try {
  if (
    process.argv.slice(2).join(" ") !== "--rehearse --existing-cli-login" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
  )
    throw Error("Explicit TEST rehearsal required");
  const token = savedCliToken();
  const catalog = await readPhoneSavedResultsCatalog(token);
  if (catalog.fingerprint !== "968d483ec625195527b5853cba6ecf8d")
    throw Error("Exact TEST release 059 required");
  const verifyAbsent = async () => {
    const rows = await communicationQuery(token, absence);
    if (rows.length !== 1 || !Object.values(rows[0]).every((v) => v === true))
      throw Error("Microsoft objects or fixture already present");
  };
  await verifyAbsent();
  const snapshot = phoneSavedResultsSourceQuery(catalog.catalog.phone),
    before = await communicationQuery(token, snapshot);
  if (before.length !== 113) throw Error("Complete preservation baseline required");
  const files = migrations.map((file) => ({
    file,
    sql: readFileSync("supabase/migrations/" + file, "utf8"),
  }));
  const probe = execFileSync(
    process.execPath,
    ["scripts/verify/learn-microsoft-hosted-probe.mjs"],
    { encoding: "utf8" },
  );
  const journal = {
    projectRef: TEST_PROJECT,
    startedAt: new Date().toISOString(),
    state: "prepared",
    schema: catalog.fingerprint,
    before,
    migrations: files.map((f) => ({ file: f.file, sha256: hash(f.sql) })),
    probeSha256: hash(probe),
  };
  writeFileSync(prefix + "-journal.json", JSON.stringify(journal, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  const body = files
    .map((f) => f.sql.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, ""))
    .join("\n");
  const sql = `begin;set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;${body}\n${probe}\nselect 'microsoft_full_schema_rehearsal_passed' as marker;rollback;`;
  // A lost result is inspected, never retried. Keep journal/error evidence.
  journal.state = "submitted";
  writeFileSync(prefix + "-journal.json", JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
  const result = await communicationQuery(token, sql, {
    readOnly: false,
    fetcher: async (url, options) => {
      const r = await fetch(url, options);
      if (!r.ok)
        writeFileSync(prefix + "-sql-error.txt", (await r.clone().text()).slice(0, 10000), {
          mode: 0o600,
        });
      return r;
    },
  });
  if (!result.some((r) => r.marker === "microsoft_full_schema_rehearsal_passed"))
    throw Error("Rehearsal marker missing");
  await verifyAbsent();
  const after = await communicationQuery(token, snapshot),
    afterCatalog = await readPhoneSavedResultsCatalog(token);
  if (order(before) !== order(after) || afterCatalog.fingerprint !== catalog.fingerprint)
    throw Error("Rollback preservation differs");
  const report = {
    projectRef: TEST_PROJECT,
    state: "full_schema_rehearsed_and_rolled_back",
    observedAt: new Date().toISOString(),
    migrations: journal.migrations,
    preservedDatasets: 113,
    originalCatalogRestored: true,
    fixturesRemoved: true,
    committedUsers: 0,
    newSessions: 0,
    newPlatformGrants: 0,
    providerRequests: 0,
    productionChanged: false,
    limitations: [
      "Synthetic source pages; no real Microsoft mailbox or hosted worker acceptance.",
      "No Microsoft schema, account, credential, queue job or schedule retained.",
    ],
  };
  writeFileSync(prefix + "-result.json", JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error("Microsoft TEST rehearsal unconfirmed: " + (e?.message ?? "unknown failure"));
  process.exitCode = 1;
}
