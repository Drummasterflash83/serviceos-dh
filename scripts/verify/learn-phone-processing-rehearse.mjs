/** Rehearse the entire Phone schema candidate inside one rolled-back TEST transaction.
 * No activation, runtime deployment, credentials, users or retained data changes. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { EMAIL_DIAGNOSTIC_PRESERVED } from "./learn-email-diagnostic-catalog.mjs";
const files = [
  "supabase/migrations/20260805120000_phone_intelligence_v1.sql",
  "supabase/migrations/20260807120000_telephony_directory_endpoints.sql",
  "supabase/migrations/20261101200000_learn_phone_download_attempts.sql",
  "supabase/migrations/20261101210000_learn_phone_derived_versions.sql",
];
const names = [
  "phone_recordings",
  "phone_transcripts",
  "phone_ai_insights",
  "call_directions",
  "call_participants",
  "call_transcript_normalisations",
  "telephony_directory",
  "tenant_vocabulary",
  "learn_phone_processing_attempts",
  "learn_phone_result_versions",
];
const quoted = names.map((n) => `'${n}'`).join(",");
const metadata = `select jsonb_build_object(
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',c.relowner,'acl',c.relacl::text,'rls',c.relrowsecurity,'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${quoted})),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl::text) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('learn_phone_download_attempt','learn_phone_derived_attempt','learn_phone_apply_intelligence','phone_pending_readiness')),
 'view',pg_get_viewdef('public.phone_recording_pipeline_state'::regclass),
 'indexes',(select jsonb_agg(to_jsonb(x) order by x.indexname) from pg_indexes x where x.schemaname='public' and x.tablename in (${quoted})),
 'policies',(select jsonb_agg(to_jsonb(x) order by x.tablename,x.policyname) from pg_policies x where x.schemaname='public' and x.tablename in (${quoted}))
 ) as catalog`;
const additions = [
  "identity_summary",
  "source_storage_path",
  "source_sha256",
  "source_transcript_sha256",
  "processing_run_id",
];
const sourceQuery = (catalog) =>
  EMAIL_DIAGNOSTIC_PRESERVED.map((n) => {
    const existing =
      catalog.tables.find((t) => "public." + t.name === n)?.columns.map((c) => c.name) ?? [];
    const absentAdditions = additions.filter((c) => !existing.includes(c));
    const row = ["public.phone_transcripts", "public.phone_ai_insights"].includes(n)
      ? `(to_jsonb(s)-array[${absentAdditions.map((x) => `'${x}'`).join(",")}])`
      : "to_jsonb(s)";
    return `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(${row}::text),'' order by md5(${row}::text)),'')) as fingerprint from ${n} s`;
  }).join(" union all ");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
if (process.argv[2] !== "--rehearse" || process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Explicit TEST-only rehearsal required");
const token = savedCliToken(),
  query = (sql, readOnly = true) => communicationQuery(token, sql, { readOnly });
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
  };
  writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
  const sql = `begin;set local search_path=public,pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
 do $$begin
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('learn_phone_processing_attempts','call_directions')) then raise exception 'Candidate already installed';end if;
 end$$;
 ${body}
 do $$begin
 if has_table_privilege('authenticated','learn_phone_result_versions','select') or has_function_privilege('authenticated','learn_phone_derived_attempt(uuid,uuid,uuid,text,text,jsonb)','execute') then raise exception 'Private processing access leaked';end if;
 end$$;
 set local role service_role;
 select count(*) from public.phone_pending_readiness('00000000-0000-4000-8000-000000000000');
 reset role;
 select 'phone-processing-rehearsed/1' as marker,(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${quoted}))::int as tables;
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
  const receipt = result?.find((x) => x.marker === "phone-processing-rehearsed/1");
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
