/** Full hosted TEST rollback rehearsal; no persistent source/account changes. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readIdentityReviewCatalog,
  identityReviewInstalledSnapshot,
} from "./learn-identity-review-catalog.mjs";
const prefix = ".verification-results/processing-queue-full-schema-v2";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
const absent = `select to_regclass('public.learn_processing_publications') is null
 and to_regclass('public.learn_processing_settlements') is null
 and to_regprocedure('public.learn_identity_review_count(uuid)') is null
 and to_regprocedure('public.learn_processing_publish(uuid,uuid,text,integer,uuid,text,uuid,text,text)') is null
 and to_regprocedure('public.learn_processing_settle(uuid,uuid,text,integer,uuid,jsonb,text)') is null
 and not exists(select 1 from public.tenants where id in('dd780923-ffff-4000-8000-000000000001','dd780923-ffff-4000-8000-000000000002')) as absent`;
try {
  if (
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT ||
    process.argv.slice(2).join(" ") !== "--rehearse --existing-cli-login"
  )
    throw Error("Explicit TEST scope required");
  const token = savedCliToken(),
    catalog = await readIdentityReviewCatalog(token);
  if (
    catalog.fingerprint !== "d6a28f8f2e3cf36b9660ba0386077eb6" ||
    (await communicationQuery(token, absent))[0]?.absent !== true
  )
    throw Error("Exact TEST 065 and absent candidate required");
  const snapshot = identityReviewInstalledSnapshot(catalog.catalog.phone),
    before = await communicationQuery(token, snapshot);
  if (before.length !== 119) throw Error("Full preservation baseline required");
  const source = readFileSync(
      "supabase/migrations/20261101340000_learn_processing_queue.sql",
      "utf8",
    ),
    probe = readFileSync("scripts/verify/learn-processing-queue.assert.sql", "utf8");
  const journal = {
    projectRef: TEST_PROJECT,
    startedAt: new Date().toISOString(),
    sourceSha256: hash(source),
    probeSha256: hash(probe),
    schema: catalog.fingerprint,
    before,
  };
  const fd = openSync(prefix + "-journal.json", "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(journal, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  let result = null;
  try {
    result = await communicationQuery(
      token,
      `begin;set local search_path=public,pg_catalog;${source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "")}\n${probe}\nselect 'processing-queue-rehearsed/1' as marker;rollback;`,
      {
        readOnly: false,
        fetcher: async (url, options) => {
          const r = await fetch(url, options);
          if (!r.ok)
            writeFileSync(prefix + "-error.txt", (await r.clone().text()).slice(0, 10000), {
              mode: 0o600,
            });
          return r;
        },
      },
    );
  } catch {
    /* Inspect rollback, never replay an uncertain transaction. */
  }
  const after = await readIdentityReviewCatalog(token),
    rows = await communicationQuery(token, snapshot),
    removed = (await communicationQuery(token, absent))[0]?.absent === true;
  const preserved =
    after.fingerprint === catalog.fingerprint && stable(rows) === stable(before) && removed;
  const passed = result?.some((r) => r.marker === "processing-queue-rehearsed/1");
  const report = {
    projectRef: TEST_PROJECT,
    state:
      preserved && passed
        ? "full_schema_rehearsed_and_rolled_back"
        : preserved
          ? "rehearsal_failed_rollback_verified"
          : "requires_inspection",
    observedAt: new Date().toISOString(),
    sourceSha256: hash(source),
    probeSha256: hash(probe),
    preservedDatasets: preserved ? 119 : null,
    originalSchemaRestored: after.fingerprint === catalog.fingerprint,
    candidateAndFixturesRemoved: removed,
    newUsers: 0,
    newGrants: 0,
    providerRequests: 0,
    productionChanged: false,
  };
  writeFileSync(prefix + "-result.json", JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(report, null, 2));
  if (!preserved || !passed) process.exitCode = 1;
} catch (e) {
  console.error("Identity review rehearsal unconfirmed: " + e.message);
  process.exitCode = 1;
}
