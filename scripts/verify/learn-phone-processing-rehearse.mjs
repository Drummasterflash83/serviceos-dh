/** Rehearse the entire Phone schema candidate inside one rolled-back TEST transaction.
 * No activation, runtime deployment, credentials, users or retained data changes. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { phoneProcessingHostedProbe } from "./learn-phone-processing-hosted-probe.mjs";
import { PHONE_PROCESSING_FILES as files, PHONE_PROCESSING_TABLES as names,
 PHONE_PROCESSING_METADATA as metadata, phoneProcessingSourceQuery as sourceQuery } from './learn-phone-processing-catalog.mjs';
const quoted = names.map((n) => `'${n}'`).join(',');
const hash = (s) => createHash("sha256").update(s).digest("hex");
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
if (process.argv[2] !== "--rehearse" || process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Explicit TEST-only rehearsal required");
const token = savedCliToken(),
  query = (sql, readOnly = true) => communicationQuery(token, sql, {
    readOnly,
    fetcher: async (...args) => {
      const response = await fetch(...args);
      if (!response.ok && response.body) {
        const parts = []; let bytes = 0;
        for await (const chunk of response.clone().body) {
          bytes += chunk.length;
          if (bytes > 65536) break;
          parts.push(chunk);
        }
        writeFileSync(dir + "/private-error.txt", Buffer.concat(parts), { mode: 0o600 });
      }
      return response;
    },
  });
const dir = ".verification-results/phone-processing-rehearsal";
mkdirSync(dir, { recursive: true, mode: 0o700 });
const journalPath = dir + "/journal.json";
try {
  const before = (await query(metadata))[0];
  const present = before.catalog.tables.map((t) => t.name);
  if (
    names
      .filter((n) => !["phone_recordings", "phone_transcripts", "phone_ai_insights"].includes(n))
      .some((n) => present.includes(n))
  )
    throw Error("Candidate prerequisites changed; inspect instead of replaying");
  const sources = sourceQuery(before.catalog);
  const preserved = await query(sources);
  const inputs = files.map((path) => ({ path, source: readFileSync(path, "utf8") }));
  const assertion = phoneProcessingHostedProbe();
  const body = inputs
    .map((f) => f.source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, ""))
    .join("\n");
  const snapshot = hash(JSON.stringify(before));
  const journal = {
    state: "prepared",
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    priorMetadataSha256: snapshot,
    sources: inputs.map((f) => ({ path: f.path, sha256: hash(f.source) })),
    preservedDataSets: preserved.length,
    assertionSha256: hash(assertion),
  };
  writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
  const sql = `begin;set local search_path=public,pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
 do $$begin
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('learn_phone_processing_attempts','call_directions')) then raise exception 'Candidate already installed';end if;
 end$$;
 ${body}
 savepoint phone_processing_probe;
 ${assertion}
 rollback to savepoint phone_processing_probe;
 release savepoint phone_processing_probe;
 do $$begin
 if has_table_privilege('authenticated','learn_phone_result_versions','select') or has_function_privilege('authenticated','learn_phone_derived_attempt(uuid,uuid,uuid,text,text,jsonb)','execute') then raise exception 'Private processing access leaked';end if;
 end$$;
 set local role service_role;
 select count(*) from public.phone_pending_readiness('00000000-0000-4000-8000-000000000000');
 reset role;
 select 'phone-processing-rehearsed/2' as marker,(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${quoted}))::int as tables;
 rollback;`;
  let result = null;
  try {
    result = await query(sql, false);
  } catch {
    journal.state = "rehearsal_unconfirmed";
  }
  const after = (await query(metadata))[0],
    afterSources = await query(sources);
  if (!equal(before, after) || !equal(preserved, afterSources))
    throw Error("Post-rehearsal state differs; inspect before any action");
  const receipt = result?.find((x) => x.marker === "phone-processing-rehearsed/2");
  journal.state =
    receipt?.tables === names.length ? "rehearsed_rolled_back" : "rehearsal_failed_or_unconfirmed";
  journal.schemaUnchanged = true;
  journal.retainedSourcesUnchanged = true;
  journal.completedAt = new Date().toISOString();
  writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(journal, null, 2));
  if (journal.state !== "rehearsed_rolled_back") process.exitCode = 1;
} catch {
  console.error(
    "Phone schema rehearsal not confirmed; inspect the private journal and current schema before retrying",
  );
  process.exitCode = 1;
}
