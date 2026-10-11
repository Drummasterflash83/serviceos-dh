/** Hosted TEST metadata only; no source records or credentials in the catalog. */
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  RESUMABLE_WORK_CATALOG,
  RESUMABLE_WORK_PRESERVED,
} from "./learn-resumable-work-catalog.mjs";
export const WORKING_RELEASE_SOURCES = [
  "supabase/migrations/20261101100000_learn_work_calendars.sql",
  "supabase/migrations/20261101110000_learn_work_delays.sql",
  "supabase/migrations/20261101120000_learn_working_time_calculation.sql",
  "supabase/migrations/20261101130000_learn_working_time_collection.sql",
  "supabase/migrations/20261101140000_learn_working_collection_input_bounds.sql",
];
export const WORKING_RELEASE_FUNCTIONS = [
  "learn_work_calendar_expand",
  "learn_work_calendar_immutable",
  "learn_work_calendar_preview",
  "learn_work_calendar_publish",
  "learn_work_calendar_read",
  "learn_work_calendar_request",
  "learn_work_calendar_resolve",
  "learn_work_calendar_save",
  "learn_work_calendar_snapshot",
  "learn_work_calendar_validate",
  "learn_work_calendar_version_result",
  "learn_work_delay_entry",
  "learn_work_delay_evidence",
  "learn_work_delay_immutable",
  "learn_work_delay_read",
  "learn_work_delay_record",
  "learn_work_delay_request",
  "learn_work_delay_resolve",
  "learn_work_delay_snapshot",
  "learn_working_calendar_freeze",
  "learn_working_collection_immutable",
  "learn_working_delay_freeze",
  "learn_working_rule_states",
  "learn_working_time_calculate",
  "learn_working_time_micros",
  "learn_working_time_ranges",
  "learn_working_time_windows",
];
export const WORKING_RELEASE_TABLES = [
  "learn_work_calendar_versions",
  "learn_work_calendar_publications",
  "learn_work_calendar_cancellations",
  "learn_work_delay_events",
  "learn_work_delay_cancellations",
  "learn_working_collection_runs",
  "learn_working_collection_items",
];
export const WORKING_RELEASE_PRESERVED = [
  ...RESUMABLE_WORK_PRESERVED,
  "public.learn_work_collection_runs",
  "public.learn_work_collection_items",
];
export const WORKING_RELEASE_SNAPSHOT = WORKING_RELEASE_PRESERVED.map(
  (n) =>
    `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`,
).join(" union all ");
const functions = (names) =>
  `(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${names.map((n) => `'${n}'`).join(",")}))`;
const table = (
  name,
) => `(select jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl::text,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(jsonb_build_object('name',x.conname,'definition',pg_get_constraintdef(x.oid)) order by x.conname) from pg_constraint x where x.conrelid=c.oid),
 'triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname),'[]') from pg_policies p where p.schemaname='public' and p.tablename=c.relname),
 'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname='public' and tablename=c.relname)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='${name}')`;

export const WORKING_RELEASE_CATALOG = `jsonb_build_object('base',${RESUMABLE_WORK_CATALOG},'dependencies',${functions(["learn_scorecard_save_draft", "learn_performance_correct", "learn_performance_review"])},'functions',${functions(WORKING_RELEASE_FUNCTIONS)},'tables',jsonb_build_array(${WORKING_RELEASE_TABLES.map(table).join(",")}))`;
export async function readWorkingReleaseCatalog(token, options) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;select ${WORKING_RELEASE_CATALOG} as catalog,md5((${WORKING_RELEASE_CATALOG})::text) as fingerprint,md5((${RESUMABLE_WORK_CATALOG})::text) as "baseFingerprint"`,
    options,
  );
  const r = rows[0];
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(r?.fingerprint) ||
    ![0, WORKING_RELEASE_FUNCTIONS.length].includes(r.catalog?.functions?.length) ||
    r.catalog?.tables?.length !== WORKING_RELEASE_TABLES.length ||
    r.catalog?.dependencies?.length !== 3 ||
    r.catalog?.base?.functions?.length !== 12
  )
    throw Error("Working-time release catalog incomplete");
  return r;
}
