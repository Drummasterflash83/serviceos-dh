/** TEST team workload metadata, preserved sources and existing collection authority. */
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { JOB_DETAILS_CATALOG, JOB_DETAILS_PRESERVED } from "./learn-job-details-catalog.mjs";
export const TEAM_WORK_PRESERVED = [...new Set([...JOB_DETAILS_PRESERVED,
 "public.intelligence_objects", "public.object_state_history", "public.learn_work_measurement_runs"] )];
export const TEAM_WORK_SNAPSHOT = TEAM_WORK_PRESERVED.map(n =>
 `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`).join(' union all ');
export const TEAM_WORK_DEPENDENCIES = [
 'learn_performance_append','learn_handoff_owner','learn_work_residence_collect','learn_work_handoffs_collect',
 'learn_member_group_covers','learn_work_snapshot','learn_capture_work_change','learn_work_capture_baseline',
 'learn_work_history_read','learn_work_history_immutable','work_transition_apply','learn_member_snapshot',
 'learn_member_history_immutable','learn_capture_member_change','learn_member_capture_baseline','learn_member_history_read'];
const functions = names => `(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${names.map(n=>`'${n}'`).join(',')}))`;
const table = (
  name,
) => `(select jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl::text,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(jsonb_build_object('name',x.conname,'definition',pg_get_constraintdef(x.oid)) order by x.conname) from pg_constraint x where x.conrelid=c.oid),
 'triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname),'[]') from pg_policies p where p.schemaname='public' and p.tablename=c.relname),
 'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname='public' and tablename=c.relname)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='${name}')`;

export const TEAM_WORK_CATALOG = `jsonb_build_object('base',${JOB_DETAILS_CATALOG},
 'dependencies',${functions(TEAM_WORK_DEPENDENCIES)},
 'sourceTables',jsonb_build_array(${['intelligence_objects','object_state_history','learn_work_measurement_runs','learn_member_history','team_members','org_units','measurements'].map(table).join(',')}),
 'functions',${functions(['learn_team_work_residence_collect'])},
 'teamTable',${table('learn_team_work_measurement_runs')})`;
export async function readTeamWorkCatalog(token, options) {
 const rows=await communicationQuery(token,`set local search_path=public,pg_catalog;select ${TEAM_WORK_CATALOG} as catalog,md5((${TEAM_WORK_CATALOG})::text) as fingerprint`,options);
 if(rows.length!==1 || !/^[a-f0-9]{32}$/.test(rows[0].fingerprint)
  || rows[0].catalog?.dependencies?.length!==TEAM_WORK_DEPENDENCIES.length
  || ![0,1].includes(rows[0].catalog?.functions?.length)
  || rows[0].catalog?.sourceTables?.some(t=>!t?.name)
  || rows[0].catalog?.base?.functions?.length!==2
  || !Array.isArray(rows[0].catalog?.base?.base?.ledger)) throw Error('Team work catalog incomplete');
 return rows[0];
}
