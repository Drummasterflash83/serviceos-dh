/** TEST assessment recovery metadata, existing authority and retained source fingerprints. */
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { REVIEW_SEARCH_CATALOG, REVIEW_SEARCH_PRESERVED } from "./learn-review-search-catalog.mjs";
export const ASSESSMENT_RECOVERY_PRESERVED = [
  ...REVIEW_SEARCH_PRESERVED,
  "public.learn_assessments",
  "public.measurements",
  "public.learn_performance_reviews",
  "public.learn_performance_corrections",
  "public.learn_scorecard_publications",
  "public.operating_profile_entries",
  "public.team_members",
  "public.org_units",
  "public.learn_member_history",
];
export const ASSESSMENT_RECOVERY_SNAPSHOT = ASSESSMENT_RECOVERY_PRESERVED.map(
  (n) =>
    `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`,
).join(" union all ");
const functions = `(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('learn_assessment_save','learn_assessment_resolve','learn_assessment_immutable'))`;
const table = (
  name,
) => `(select jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl::text,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(jsonb_build_object('name',x.conname,'definition',pg_get_constraintdef(x.oid)) order by x.conname) from pg_constraint x where x.conrelid=c.oid),
 'triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname),'[]') from pg_policies p where p.schemaname='public' and p.tablename=c.relname),
 'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname='public' and tablename=c.relname)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='${name}')`;
export const ASSESSMENT_RECOVERY_CATALOG = `jsonb_build_object('base',${REVIEW_SEARCH_CATALOG},'functions',${functions},'assessmentTable',${table("learn_assessments")},'cancelTable',${table("learn_assessment_cancellations")},'ledger',(select jsonb_agg(jsonb_build_object('name',migration_name,'sha256',source_sha256,'project',project_ref) order by migration_name) from of_test_deploy.migrations))`;
export async function readAssessmentRecoveryCatalog(token, options) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;select ${ASSESSMENT_RECOVERY_CATALOG} as catalog,md5((${ASSESSMENT_RECOVERY_CATALOG})::text) as fingerprint`,
    options,
  );
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(rows[0].fingerprint) ||
    ![2, 3].includes(rows[0].catalog?.functions?.length) ||
    rows[0].catalog?.assessmentTable?.name !== "learn_assessments" ||
    !Array.isArray(rows[0].catalog.ledger)
  )
    throw Error("Assessment recovery catalog incomplete");
  return rows[0];
}
