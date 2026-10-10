/** TEST resumable collection metadata and preservation boundaries. */
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEAM_WORK_CATALOG, TEAM_WORK_PRESERVED } from "./learn-team-work-catalog.mjs";
export const RESUMABLE_WORK_PRESERVED = [
  ...TEAM_WORK_PRESERVED,
  "public.learn_team_work_measurement_runs",
];
export const RESUMABLE_WORK_SNAPSHOT = RESUMABLE_WORK_PRESERVED.map(
  (n) =>
    `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`,
).join(" union all ");
export const RESUMABLE_WORK_FUNCTIONS = [
  "learn_work_collection_immutable",
  "learn_work_collection_access",
  "learn_work_collection_history",
  "learn_work_frozen_owner",
  "learn_work_collection_calculate",
  "learn_work_collection_result",
  "learn_work_collection_cell_lock",
  "learn_work_collection_begin",
  "learn_work_collection_step",
  "learn_work_collection_status",
  "learn_work_collection_abandon",
  "learn_work_collection_evidence",
];
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

export const RESUMABLE_WORK_CATALOG = `jsonb_build_object('base',${TEAM_WORK_CATALOG},
 'functions',${functions(RESUMABLE_WORK_FUNCTIONS)},
 'tables',jsonb_build_array(${["learn_work_collection_runs", "learn_work_collection_items"].map(table).join(",")}))`;
export async function readResumableWorkCatalog(token, options) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;select ${RESUMABLE_WORK_CATALOG} as catalog,md5((${RESUMABLE_WORK_CATALOG})::text) as fingerprint,md5((${TEAM_WORK_CATALOG})::text) as "baseFingerprint"`,
    options,
  );
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(rows[0].fingerprint) ||
    ![0, RESUMABLE_WORK_FUNCTIONS.length].includes(rows[0].catalog?.functions?.length) ||
    rows[0].catalog?.tables?.length !== 2 ||
    rows[0].catalog?.base?.functions?.length !== 1 ||
    rows[0].catalog?.base?.dependencies?.length !== 16 ||
    rows[0].catalog?.base?.teamTable?.name !== "learn_team_work_measurement_runs" ||
    !Array.isArray(rows[0].catalog?.base?.base?.base?.ledger)
  )
    throw Error("Resumable work catalog incomplete");
  return rows[0];
}
