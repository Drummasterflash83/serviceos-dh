/** Prepare a TEST-only atomic database release from reviewed source migrations. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  RUNTIME_CATALOG_EXPRESSION,
  RUNTIME_SNAPSHOT_QUERY,
} from "./learn-email-runtime-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const prior = JSON.parse(readFileSync(".verification-results/email-runtime-prior.json"));
if (
  prior.catalog.ledger.length !== 33 ||
  prior.catalog.views.length !== 0 ||
  prior.catalog.functions.length !== 15 ||
  prior.catalog.tables.length !== 18 ||
  !/^[a-f0-9]{32}$/.test(prior.fingerprint) ||
  prior.catalog.ledger.some((r) => r.project_ref !== TEST_PROJECT)
)
  throw Error("Expected untouched TEST email prerequisites required");
const paths = [
  "supabase/migrations/20260711120000_phone_pipeline_selection.sql",
  "supabase/migrations/20261024100000_phone_retry_fairness.sql",
  "supabase/migrations/20261031230000_learn_capture_controls.sql",
  "supabase/migrations/20261031233000_learn_email_transition_outbox.sql",
  "supabase/migrations/20261031234500_learn_email_job_attempts.sql",
  "supabase/migrations/20261031235500_learn_email_page_store.sql",
  "supabase/migrations/20261031235900_learn_email_job_failure.sql",
  "supabase/migrations/20261101000500_learn_email_paused_recovery.sql",
  "supabase/migrations/20261101001500_learn_email_enqueue.sql",
];
const sources = paths.map((path) => ({ path, source: readFileSync(path, "utf8") }));
const viewSource = sources[0].source;
const viewStart = viewSource.indexOf("create or replace view phone_recording_pipeline_state\n");
const viewEnd = viewSource.indexOf(") ins on true;", viewStart) + ") ins on true;".length;
if (viewStart < 0 || viewEnd <= viewStart) throw Error("Phone view source changed");
const bodies = sources.slice(2).map(({ source }) => {
  if (source.split("\nbegin;\n").length !== 2 || source.split("\ncommit;\n").length !== 2)
    throw Error("Migration framing changed");
  return source.slice(source.indexOf("\nbegin;\n") + 8, source.lastIndexOf("\ncommit;\n"));
});
const sql = `-- TEST-only capture controls and durable mailbox runtime. No provider activation.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if md5((${RUNTIME_CATALOG_EXPRESSION})::text) <> '${prior.fingerprint}' then raise exception 'Exact email runtime prerequisites required';end if;
end $$;
create temporary table serviceos_email_preserved_before on commit drop as ${RUNTIME_SNAPSHOT_QUERY};
${viewSource.slice(viewStart, viewEnd)}
revoke all on public.phone_recording_pipeline_state from public,anon,authenticated,service_role;
grant select on public.phone_recording_pipeline_state to service_role;
${sources[1].source}
revoke all on function public.phone_retry_state(text,jsonb,timestamptz),public.phone_pending_readiness(uuid),public.phone_select_pending(uuid,integer,integer) from anon,authenticated;
${bodies.join("\n")}
do $$begin
 if (select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_email_preserved_before x) is distinct from (select jsonb_agg(to_jsonb(x) order by x.name) from (${RUNTIME_SNAPSHOT_QUERY})x) then raise exception 'Existing TEST sources changed during email release';end if;
end $$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_email_runtime_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'learn-email-runtime/1' as marker,${RUNTIME_CATALOG_EXPRESSION} as catalog,md5((${RUNTIME_CATALOG_EXPRESSION})::text) as fingerprint,(select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_email_preserved_before x) as preserved;
commit;
`;
const prefix = "supabase/release/learn-test/033_email_runtime";
writeFileSync(prefix + ".sql", sql);
writeFileSync(prefix + ".prerequisites.json", JSON.stringify(prior, null, 2) + "\n");
writeFileSync(
  prefix + ".manifest.json",
  JSON.stringify(
    {
      version: "learn-email-runtime-package/1",
      projectRef: TEST_PROJECT,
      sha256: hash(sql),
      priorFingerprint: prior.fingerprint,
      sources: sources.map(({ path, source }) => ({ path, sha256: hash(source) })),
      preservedDataSets: prior.preserved.length,
      phoneScope:
        "Only the existing pipeline-state view plus retry selector dependencies; no phone capture endpoint or schedule activation.",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    sha256: hash(sql),
    sourceFiles: sources.length,
    priorFingerprint: prior.fingerprint,
    preservedDataSets: prior.preserved.length,
  }),
);
