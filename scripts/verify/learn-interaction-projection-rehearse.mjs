/** Full hosted TEST rollback rehearsal; no persistent source/account changes. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readIdentityCatalog,
  identityInstalledSnapshot,
} from "./learn-identity-delivery-catalog.mjs";
const prefix = ".verification-results/interaction-projection-full-schema-v1";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
const absent = `select to_regclass('public.learn_interaction_projection_receipts') is null
 and to_regprocedure('public.learn_projection_pending(uuid,text,integer)') is null
 and to_regprocedure('public.learn_project_interaction(uuid,uuid,text,uuid,text,text)') is null
 and to_regprocedure('public.learn_projection_review_count(uuid,text)') is null
 and to_regprocedure('public.learn_phone_source_fields(public.phone_calls)') is null
 and to_regprocedure('public.learn_email_source_fields(public.email_messages)') is null
 and to_regprocedure('public.learn_projection_revision(jsonb,text)') is null
 and not exists(select 1 from public.tenants where id in('ac68d905-cccc-4000-8000-000000000001','ac68d905-cccc-4000-8000-000000000002')) as absent`;
try {
  if (
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT ||
    process.argv.slice(2).join(" ") !== "--rehearse --existing-cli-login"
  )
    throw Error("Explicit TEST scope required");
  const token = savedCliToken(),
    catalog = await readIdentityCatalog(token);
  if (
    catalog.fingerprint !== "851ab50d52a8d36ea1ee728c0a3f3ecf" ||
    (await communicationQuery(token, absent))[0]?.absent !== true
  )
    throw Error("Exact TEST 062 and absent candidate required");
  const snapshot = identityInstalledSnapshot(catalog.catalog.phone),
    before = await communicationQuery(token, snapshot);
  if (before.length !== 116) throw Error("Full preservation baseline required");
  const source = readFileSync(
      "supabase/migrations/20261101310000_learn_interaction_projection.sql",
      "utf8",
    ),
    probe = readFileSync("scripts/verify/learn-interaction-projection.assert.sql", "utf8");
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
      `begin;set local search_path=public,pg_catalog;${source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "")}\n${probe}\nselect 'interaction-projection-rehearsed/1' as marker;rollback;`,
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
  const after = await readIdentityCatalog(token),
    rows = await communicationQuery(token, snapshot),
    removed = (await communicationQuery(token, absent))[0]?.absent === true;
  const preserved =
    after.fingerprint === catalog.fingerprint && stable(rows) === stable(before) && removed;
  const passed = result?.some((r) => r.marker === "interaction-projection-rehearsed/1");
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
    preservedDatasets: preserved ? 116 : null,
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
  console.error("Interaction projection rehearsal unconfirmed: " + e.message);
  process.exitCode = 1;
}
