/** Schema-only source-reader metadata and all preceding TEST contracts. */
import {readCorrectionCatalog} from './learn-performance-corrections-catalog.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {RULES_FUNCTION_QUERY} from './learn-rules-catalog.mjs';
export const SOURCE_FUNCTION='learn_card_source_read';
export const SOURCE_TABLES=['email_messages','phone_calls','phone_recordings'];
export const SOURCE_POLICIES=['learn_card_email_source_read','learn_card_call_source_read','learn_card_recording_source_read'];
const functionQuery=RULES_FUNCTION_QUERY.replace(/p\.proname in \([^)]*\)/,"p.proname in ('learn_card_source_read')");
export const SOURCE_CATALOG_QUERY=`set local search_path=public,pg_catalog;
select jsonb_build_object(
 'functions',(select functions from (${functionQuery}) f),
 'policies',(select coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'roles',roles,'command',cmd,'using',qual,'check',with_check,'permissive',permissive) order by tablename,policyname),'[]') from pg_policies where schemaname='public' and policyname in ('learn_card_email_source_read','learn_card_call_source_read','learn_card_recording_source_read')),
 'grants',(select coalesce(jsonb_agg(x order by x::text),'[]') from (
  select jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,'privilege',g.privilege_type,'grantable',g.is_grantable) x from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(a.attacl) g join pg_roles r on r.oid=g.grantee where n.nspname='public' and c.relname in ('email_messages','phone_calls','phone_recordings') and r.rolname='learn_card_communication_reader'
  union all select jsonb_build_object('schema',n.nspname,'table',c.relname,'column',null,'privilege',g.privilege_type,'grantable',g.is_grantable) from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(c.relacl) g join pg_roles r on r.oid=g.grantee where n.nspname='public' and c.relname in ('email_messages','phone_calls','phone_recordings') and r.rolname='learn_card_communication_reader'
 ) g),
 'access',(select coalesce(jsonb_agg(x order by x::text),'[]') from (
  select jsonb_build_object('table',c.relname,'column',a.attname,'role',r,'select',has_column_privilege(r,c.oid,a.attnum,'SELECT'),'insert',has_column_privilege(r,c.oid,a.attnum,'INSERT'),'update',has_column_privilege(r,c.oid,a.attnum,'UPDATE'),'references',has_column_privilege(r,c.oid,a.attnum,'REFERENCES')) x from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped cross join unnest(array['anon','authenticated','service_role']) r where n.nspname='public' and c.relname in ('email_messages','phone_calls','phone_recordings')
  union all select jsonb_build_object('table',c.relname,'role',r,'privilege',p,'allowed',has_table_privilege(r,c.oid,p)) from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join unnest(array['anon','authenticated','service_role']) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where n.nspname='public' and c.relname in ('email_messages','phone_calls','phone_recordings')
 ) a)
) as source_reader`;
export async function readSourceCatalog(args){const c=await readCorrectionCatalog(args),rows=await communicationQuery(args.token,SOURCE_CATALOG_QUERY,args);if(rows?.length!==1||!['functions','policies','grants','access'].every(k=>Array.isArray(rows[0]?.source_reader?.[k])))throw Error('Source reader catalog incomplete');return {...c,sourceReader:rows[0].source_reader};}
