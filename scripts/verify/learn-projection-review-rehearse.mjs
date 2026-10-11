/** Full hosted TEST rollback rehearsal; no persistent source/account changes. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readProjectionCatalog,
  projectionInstalledSnapshot,
} from "./learn-interaction-projection-catalog.mjs";
const prefix = ".verification-results/projection-review-full-schema-v2";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
const absent = `select to_regclass('public.learn_projection_operator_reviews') is null
 and to_regprocedure('public.learn_projection_review_state(uuid,uuid)') is null
 and to_regprocedure('public.learn_operator_projection_reviews(uuid,uuid)') is null
 and to_regprocedure('public.learn_operator_projection_review_detail(uuid,uuid)') is null
 and to_regprocedure('public.learn_operator_projection_review(uuid,uuid,uuid,uuid,jsonb,text)') is null
 and not exists(select 1 from public.tenants where id in('b3870214-dddd-4000-8000-000000000001','b3870214-dddd-4000-8000-000000000002'))
 and not exists(select 1 from auth.users where id in('b3870214-dddd-4000-8000-000000000010','b3870214-dddd-4000-8000-000000000011','b3870214-dddd-4000-8000-000000000012')) as absent`;
try {
  if (
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT ||
    process.argv.slice(2).join(" ") !== "--rehearse --existing-cli-login"
  )
    throw Error("Explicit TEST scope required");
  const token = savedCliToken(),
    catalog = await readProjectionCatalog(token);
  if (
    catalog.fingerprint !== "537f21e8392a8c3034434120d7fc35a7" ||
    (await communicationQuery(token, absent))[0]?.absent !== true
  )
    throw Error("Exact TEST 063 and absent candidate required");
  const snapshot = projectionInstalledSnapshot(catalog.catalog.phone),
    before = await communicationQuery(token, snapshot);
  if (before.length !== 117) throw Error("Full preservation baseline required");
  const source = readFileSync(
      "supabase/migrations/20261101320000_learn_projection_operator_review.sql",
      "utf8",
    ),
    probe = readFileSync("scripts/verify/learn-projection-review.assert.sql", "utf8");
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
      `begin;set local search_path=public,pg_catalog;${source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "")}\n${probe}\nselect 'projection-review-rehearsed/1' as marker;rollback;`,
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
  const after = await readProjectionCatalog(token),
    rows = await communicationQuery(token, snapshot),
    removed = (await communicationQuery(token, absent))[0]?.absent === true;
  const preserved =
    after.fingerprint === catalog.fingerprint && stable(rows) === stable(before) && removed;
  const passed = result?.some((r) => r.marker === "projection-review-rehearsed/1");
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
    preservedDatasets: preserved ? 117 : null,
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
  console.error("Projection review rehearsal unconfirmed: " + e.message);
  process.exitCode = 1;
}
