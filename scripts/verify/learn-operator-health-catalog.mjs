/** Metadata and aggregate fingerprints only; no source values or credentials. */
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { RUNTIME_CATALOG_EXPRESSION, RUNTIME_PRESERVED } from "./learn-email-runtime-catalog.mjs";
export const OPERATOR_HEALTH_TABLES = ["client_portal_access", "client_programmes", "client_programme_revisions", "client_programme_notes", "receptionist_workspaces", "receptionist_access", "receptionist_feedback", "client_notification_outbox"];
export const OPERATOR_HEALTH_FUNCTIONS = ["current_user_is_openfolk_operator", "client_programme_stamp", "client_programme_record_revision", "receptionist_feedback_stamp", "queue_client_feedback", "claim_client_notifications", "client_portal_write_context"];
export const OPERATOR_HEALTH_PRESERVED = [...RUNTIME_PRESERVED, "public.learn_capture_control_requests", "public.learn_email_transition_requests", "public.learn_email_transition_settlements", "public.learn_email_job_attempts"];
const list = xs => xs.map(s => "'" + s + "'").join(",");
export const OPERATOR_HEALTH_CATALOG = `jsonb_build_object(
 'runtime',${RUNTIME_CATALOG_EXPRESSION},
 'tables',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname),'[]') from pg_constraint where conrelid=c.oid),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname),'[]') from pg_policies p where p.schemaname='public' and p.tablename=c.relname),
 'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(oid) order by tgname),'[]') from pg_trigger where tgrelid=c.oid and not tgisinternal)) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${list(OPERATOR_HEALTH_TABLES)}) and c.relkind='r'),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${list(OPERATOR_HEALTH_FUNCTIONS)})),
 'defaultPrivileges',(select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'type',d.defaclobjtype,'acl',d.defaclacl::text) order by d.defaclrole::regrole::text,n.nspname,d.defaclobjtype),'[]') from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where d.defaclnamespace=0 or n.nspname='public')
)`;
export const OPERATOR_HEALTH_SNAPSHOT = OPERATOR_HEALTH_PRESERVED.map(n => `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`).join(" union all ");
export async function readOperatorHealthCatalog(token) {
  const rows = await communicationQuery(token, `set local search_path=public,pg_catalog;select ${OPERATOR_HEALTH_CATALOG} as catalog,md5((${OPERATOR_HEALTH_CATALOG})::text) as fingerprint`);
  if(rows.length !== 1 || !/^[a-f0-9]{32}$/.test(rows[0].fingerprint)) throw Error("Operator health catalog incomplete");
  return rows[0];
}
