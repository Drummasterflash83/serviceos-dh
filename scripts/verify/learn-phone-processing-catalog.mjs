/** Phone release metadata and complete retained-source fingerprints. No source content returned. */
import { EMAIL_DIAGNOSTIC_CATALOG, EMAIL_DIAGNOSTIC_PRESERVED } from './learn-email-diagnostic-catalog.mjs';
import { communicationQuery } from './learn-card-communication-catalog.mjs';
export const PHONE_PROCESSING_FILES = [
  "supabase/migrations/20260805120000_phone_intelligence_v1.sql",
  "supabase/migrations/20260807120000_telephony_directory_endpoints.sql",
  "supabase/migrations/20261101200000_learn_phone_download_attempts.sql",
  "supabase/migrations/20261101210000_learn_phone_derived_versions.sql",
];
export const PHONE_PROCESSING_TABLES = [
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
const quoted = PHONE_PROCESSING_TABLES.map((n) => `'${n}'`).join(",");
export const PHONE_PROCESSING_METADATA = `select jsonb_build_object(
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',c.relowner,'acl',c.relacl::text,'rls',c.relrowsecurity,'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${quoted})),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid),'identity',pg_get_function_identity_arguments(p.oid),'settings',p.proconfig,'definer',p.prosecdef,'owner',p.proowner,'acl',p.proacl::text) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('learn_phone_download_attempt','learn_phone_derived_attempt','learn_phone_apply_intelligence','phone_pending_readiness')),
 'constraints',(select jsonb_agg(jsonb_build_object('name',k.conname,'table',c.relname,'definition',pg_get_constraintdef(k.oid)) order by c.relname,k.conname) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${quoted})),
 'triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'table',c.relname,'definition',pg_get_triggerdef(t.oid)) order by c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${quoted}) and not t.tgisinternal),
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
export const phoneProcessingSourceQuery = (catalog) =>
  EMAIL_DIAGNOSTIC_PRESERVED.map((n) => {
    const existing =
      catalog.tables.find((t) => "public." + t.name === n)?.columns.map((c) => c.name) ?? [];
    const absentAdditions = additions.filter((c) => !existing.includes(c));
    const row = ["public.phone_transcripts", "public.phone_ai_insights"].includes(n)
      ? `(to_jsonb(s)-array[${absentAdditions.map((x) => `'${x}'`).join(",")} ]::text[])`
      : "to_jsonb(s)";
    return `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(${row}::text),'' order by md5(${row}::text)),'')) as fingerprint from ${n} s`;
  }).join(" union all ");

export const PHONE_PROCESSING_CATALOG = `jsonb_build_object('phone',(${PHONE_PROCESSING_METADATA}),'base',${EMAIL_DIAGNOSTIC_CATALOG})`;
export async function readPhoneProcessingCatalog(token) {
 const rows = await communicationQuery(token,`set local search_path=public,pg_catalog;with snapshot as materialized(select ${PHONE_PROCESSING_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint from snapshot`);
 const r=rows[0];
 if(rows.length!==1 || !/^[a-f0-9]{32}$/.test(r?.fingerprint??'') || !Array.isArray(r.catalog?.phone?.tables) || !Array.isArray(r.catalog?.base?.ledger)) throw Error('Phone processing catalog incomplete');
 return r;
}
