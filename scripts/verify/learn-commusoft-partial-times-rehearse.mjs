/** Full-schema hosted TEST rehearsal only. Every DDL, fixture and banned identity rolls back. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readPhoneSavedResultsCatalog,
  phoneSavedResultsSourceQuery,
} from "./learn-phone-saved-results-catalog.mjs";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const prefix = ".verification-results/commusoft-partial-times-rehearse-v4";
const contract = `select jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'definition',pg_get_functiondef(oid),'acl',proacl::text,'owner',proowner) order by oid::regprocedure::text) as functions from pg_proc where oid in ('public.learn_commusoft_confirm_work_record(uuid,uuid,uuid,text)'::regprocedure,'public.learn_business_input_time_detail(jsonb)'::regprocedure)`;
try {
  if (
    process.argv.slice(2).join(" ") !== "--rehearse --existing-cli-login" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
  )
    throw Error("Explicit TEST rollback rehearsal required");
  const token = savedCliToken(),
    catalog = await readPhoneSavedResultsCatalog(token);
  if (catalog.fingerprint !== "6632f3df219ea27a9ccc3f668f198f00")
    throw Error("Exact TEST release 058 required");
  const snapshot = phoneSavedResultsSourceQuery(catalog.catalog.phone),
    before = await communicationQuery(token, snapshot),
    functions = await communicationQuery(token, contract);
  if (before.length !== 113 || functions[0]?.functions?.length !== 2)
    throw Error("Complete preflight required");
  const original = JSON.parse(
    readFileSync(".verification-results/commusoft-partial-times-rehearse-journal.json"),
  );
  const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
  if (
    stable(before) !== stable(original.before) ||
    JSON.stringify(functions) !== JSON.stringify(original.functions)
  )
    throw Error("Previous rehearsal did not restore the original state");
  const fixture = (
    await communicationQuery(
      token,
      "select not exists(select 1 from auth.users where id='eb190659-aaaa-4000-8000-000000000080') and not exists(select 1 from tenants where id in('eb190659-aaaa-4000-8000-000000000001','eb190659-aaaa-4000-8000-000000000002')) as absent",
    )
  )[0];
  if (!fixture.absent) throw Error("Prior rollback fixture remains");
  const migration = readFileSync(
    "supabase/migrations/20261101250000_learn_commusoft_partial_job_times.sql",
    "utf8",
  );
  const probe = readFileSync(
    "scripts/verify/learn-commusoft-partial-times-hosted.assert.sql",
    "utf8",
  );
  const journal = {
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    sourceSha256: hash(migration),
    probeSha256: hash(probe),
    schema: catalog.fingerprint,
    before,
    functions,
  };
  writeFileSync(prefix + "-journal.json", JSON.stringify(journal, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  const body = migration.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
  await communicationQuery(
    token,
    `begin;set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;${body}\n${probe}\nselect 'full_projection_rehearsal_passed' as marker;rollback;`,
    {
      readOnly: false,
      fetcher: async (url, options) => {
        const response = await fetch(url, options);
        if (!response.ok)
          writeFileSync(
            prefix + "-sql-error.txt",
            (await response.clone().text()).slice(0, 10000),
            { mode: 0o600 },
          );
        return response;
      },
    },
  );
  const after = await communicationQuery(token, snapshot),
    afterFunctions = await communicationQuery(token, contract);
  const order = (x) => JSON.stringify([...x].sort((a, b) => a.name.localeCompare(b.name)));
  if (
    order(before) !== order(after) ||
    JSON.stringify(functions) !== JSON.stringify(afterFunctions)
  )
    throw Error("Rehearsal rollback differs");
  const result = {
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    state: "full_schema_projection_rehearsed_and_rolled_back",
    sourceSha256: journal.sourceSha256,
    probeSha256: journal.probeSha256,
    preservedDataSets: 113,
    functionDefinitionsAndGrantsRestored: true,
    committedAccounts: 0,
    issuedSessions: 0,
    platformGrants: 0,
    providerRequests: 0,
    productionChanged: false,
  };
  writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result));
} catch (e) {
  console.error("TEST rollback rehearsal unconfirmed: " + String(e.message).slice(0, 600));
  process.exitCode = 1;
}
