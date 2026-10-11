/** Full TEST rollback rehearsal; no persistent identities, grants or source writes. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readPhoneSavedResultsCatalog,
  phoneSavedResultsSourceQuery,
} from "./learn-phone-saved-results-catalog.mjs";
import { readSchedulerHealth } from "../../src/lib/scheduler-health-reader.ts";

const prefix = ".verification-results/scheduler-health-rehearsal";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
const absence = `select to_regprocedure('public.learn_scheduler_health_read(uuid)') is null as function_absent,
 to_regclass('public.learn_email_scheduler_latest_idx') is null as email_index_absent,
 to_regclass('public.learn_phone_scheduler_latest_idx') is null as phone_index_absent,
 not exists(select 1 from auth.users where id in ('eb190661-aaaa-4000-8000-000000000010','eb190661-aaaa-4000-8000-000000000011','eb190661-aaaa-4000-8000-000000000012')) as identities_absent,
 not exists(select 1 from tenants where id in ('eb190661-aaaa-4000-8000-000000000001','eb190661-aaaa-4000-8000-000000000002')) as tenants_absent`;
try {
  if (
    process.argv.slice(2).join(" ") !== "--rehearse --existing-cli-login" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
  )
    throw Error("Explicit TEST rollback rehearsal required");
  const token = savedCliToken(),
    catalog = await readPhoneSavedResultsCatalog(token);
  if (catalog.fingerprint !== "968d483ec625195527b5853cba6ecf8d")
    throw Error("Exact TEST 059 catalog required");
  const snapshot = phoneSavedResultsSourceQuery(catalog.catalog.phone);
  const before = await communicationQuery(token, snapshot);
  if (before.length !== 113) throw Error("Complete source snapshot required");
  const prior = await communicationQuery(token, absence);
  if (prior.length !== 1 || Object.values(prior[0]).some((v) => v !== true))
    throw Error("Rehearsal destination already exists");
  const source = readFileSync(
    "supabase/migrations/20261101270000_learn_scheduler_health.sql",
    "utf8",
  );
  const probe = readFileSync("scripts/verify/learn-scheduler-health.assert.sql", "utf8");
  const journal = {
    projectRef: TEST_PROJECT,
    startedAt: new Date().toISOString(),
    before,
    catalogFingerprint: catalog.fingerprint,
    sourceSha256: hash(source),
    probeSha256: hash(probe),
  };
  writeFileSync(prefix + "-journal.json", JSON.stringify(journal, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  let result = null,
    submission = "unconfirmed";
  try {
    result = await communicationQuery(
      token,
      `begin;set local search_path=public,pg_catalog;
   ${source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "")}
   ${probe}
   set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='eb190661-aaaa-4000-8000-000000000010';set local role authenticated;
   select 'scheduler-health-rehearsed/1' as marker,public.learn_scheduler_health_read('eb190661-aaaa-4000-8000-000000000001') as synthetic_summary;
   reset role;rollback;`,
      {
        readOnly: false,
        fetcher: async (url, options) => {
          const r = await fetch(url, options);
          if (!r.ok)
            writeFileSync(prefix + "-private-error.txt", (await r.clone().text()).slice(0, 16000), {
              mode: 0o600,
            });
          return r;
        },
      },
    );
    submission = "returned";
  } catch {
    /* Verify terminal rollback state even after an uncertain response. */
  }
  const after = await communicationQuery(token, snapshot),
    afterCatalog = await readPhoneSavedResultsCatalog(token),
    absent = await communicationQuery(token, absence);
  const row = result?.find((r) => r.marker === "scheduler-health-rehearsed/1");
  const parsed = row
    ? await readSchedulerHealth(
        { rpc: async () => ({ data: row.synthetic_summary, error: null }) },
        "eb190661-aaaa-4000-8000-000000000001",
      )
    : null;
  const verified =
    submission === "returned" &&
    parsed?.ok === true &&
    stable(before) === stable(after) &&
    JSON.stringify(catalog) === JSON.stringify(afterCatalog) &&
    absent.length === 1 &&
    Object.values(absent[0]).every((v) => v === true);
  const report = {
    projectRef: TEST_PROJECT,
    state: verified ? "full_schema_rehearsed_and_rolled_back" : "requires_inspection",
    completedAt: new Date().toISOString(),
    submission,
    sourceSha256: journal.sourceSha256,
    probeSha256: journal.probeSha256,
    preservedDataSets: before.length,
    sourcesUnchanged: stable(before) === stable(after),
    catalogUnchanged: JSON.stringify(catalog) === JSON.stringify(afterCatalog),
    candidateAndFixturesAbsent:
      absent.length === 1 && Object.values(absent[0]).every((v) => v === true),
    actualSqlAcceptedByClient: parsed?.ok === true,
    persistentUsers: 0,
    issuedSessions: 0,
    persistentPlatformGrants: 0,
    providerRequests: 0,
    productionChanged: false,
  };
  writeFileSync(prefix + "-result.json", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  if (row)
    writeFileSync(prefix + "-synthetic-output.json", JSON.stringify(row.synthetic_summary), {
      mode: 0o600,
    });
  console.log(JSON.stringify(report, null, 2));
  if (!verified) process.exitCode = 1;
} catch {
  console.error(
    "Scheduler TEST rehearsal unavailable or unconfirmed; inspect private journal before retrying",
  );
  process.exitCode = 1;
}
