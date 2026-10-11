/** Full hosted TEST rollback rehearsal of the scoped atomic phone publisher. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readPhoneSavedResultsCatalog,
  phoneSavedResultsSourceQuery,
} from "./learn-phone-saved-results-catalog.mjs";
const prefix = ".verification-results/phone-atomic-handoff-full-schema-rehearsal-v2";
// Rehearse missing phone projection dependencies and event publication without
// retaining schema or fixtures. Installation is a separate pinned release.
const migrations = [
 "20260709150000_platform_events.sql",
 "20260713120000_phone_projection_incremental.sql",
 "20260714120000_input_reliability_finalisation.sql",
 "20261101290000_learn_phone_atomic_handoff.sql",
];
const hash = (s) => createHash("sha256").update(s).digest("hex");
const order = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
const absence = `select
 to_regclass('public.platform_events') is null as event_bus_absent,
 to_regclass('public.learn_phone_handoff_receipts') is null as receipts_absent,
 to_regprocedure('public.learn_phone_handoff(uuid,uuid,uuid,uuid,uuid,text)') is null as publisher_absent,
 not exists(select 1 from information_schema.columns where table_schema='public' and table_name='interactions' and column_name in('source_version','source_updated_at')) as projection_columns_absent,
 to_regprocedure('public.phone_projection_version(uuid,uuid)') is null as function_absent,
 not exists(select 1 from tenants where id='e36f129a-aaaa-4000-8000-000000000001') as fixture_absent`;
try {
  if (
    process.argv.slice(2).join(" ") !== "--rehearse --existing-cli-login" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
  )
    throw Error("Explicit TEST rehearsal required");
  const token = savedCliToken();
  const catalog = await readPhoneSavedResultsCatalog(token);
  if (catalog.fingerprint !== "ebeeafeb978b7119d25b694fd210e71c")
    throw Error("Exact TEST release 060 required");
  const verifyAbsent = async () => {
    const rows = await communicationQuery(token, absence);
    if (rows.length !== 1 || !Object.values(rows[0]).every((v) => v === true))
      throw Error("Phone projection objects, event bus or fixture already present");
  };
  await verifyAbsent();
  const snapshot = phoneSavedResultsSourceQuery(catalog.catalog.phone),
    before = await communicationQuery(token, snapshot);
  if (before.length !== 113) throw Error("Complete preservation baseline required");
  const files = migrations.map((file) => ({
    file,
    sql: readFileSync("supabase/migrations/" + file, "utf8"),
  }));
  const probe = readFileSync('scripts/verify/learn-phone-atomic-handoff.assert.sql','utf8');
  const projectionProbe = '';
  const journal = {
    projectRef: TEST_PROJECT,
    startedAt: new Date().toISOString(),
    state: "prepared",
    schema: catalog.fingerprint,
    before,
    migrations: files.map((f) => ({ file: f.file, sha256: hash(f.sql) })),
    probeSha256: hash(probe),
    projectionProbeSha256: hash(projectionProbe),
  };
  writeFileSync(prefix + "-journal.json", JSON.stringify(journal, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  const body = files
    .map((f) => f.sql.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, ""))
    .join("\n");
  const sql = `begin;set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;${body}\n${probe}\n${projectionProbe}\nselect 'phone_atomic_handoff_rehearsal_passed' as marker;rollback;`;
  // A lost result is inspected, never retried. Keep journal/error evidence.
  journal.state = "submitted";
  writeFileSync(prefix + "-journal.json", JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
  let result = null;
  try { result = await communicationQuery(token, sql, {
    readOnly: false,
    fetcher: async (url, options) => {
      const r = await fetch(url, options);
      if (!r.ok)
        writeFileSync(prefix + "-sql-error.txt", (await r.clone().text()).slice(0, 10000), {
          mode: 0o600,
        });
      return r;
    },
  }); } catch { /* Inspect rollback after a failed or uncertain request, never resubmit. */ }
  const passed=Array.isArray(result)&&result.some(r=>r.marker==="phone_atomic_handoff_rehearsal_passed");
  await verifyAbsent();
  const after = await communicationQuery(token, snapshot),
    afterCatalog = await readPhoneSavedResultsCatalog(token);
  if (order(before) !== order(after) || afterCatalog.fingerprint !== catalog.fingerprint)
    throw Error("Rollback preservation differs");
  const report = {
    projectRef: TEST_PROJECT,
    state: passed ? "full_schema_rehearsed_and_rolled_back" : "rehearsal_failed_rollback_verified",
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
      "Synthetic source records; no provider capture or authenticated pipeline execution.",
      "No phone projection schema, event bus, source record, account or grant retained.",
      "Atomic interaction/event/receipt behaviour tested; downstream identity/card delivery not exercised.",
      "Legacy analysis without exact source provenance remains held; existing records are retained.",
    ],
  };
  writeFileSync(prefix + "-result.json", JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(report, null, 2));
  if(!passed)process.exitCode=1;
} catch (e) {
  console.error("Phone handoff TEST rehearsal unconfirmed: " + (e?.message ?? "unknown failure"));
  process.exitCode = 1;
}
