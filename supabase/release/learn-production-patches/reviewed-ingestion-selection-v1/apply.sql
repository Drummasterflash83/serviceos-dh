begin;
set local search_path=pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
do $$begin
if current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz' or current_setting('serviceos.release_sha256',true) is distinct from '11f4c4a95a5c78604bb976c7ab6d7a1a06421841039c4e297f8c16c2142d7bc2' then raise exception 'Reviewed target/source required';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||p.proacl::text||'|'||p.prosecdef::text from pg_proc p where p.oid='public.intelligence_select_uningested(uuid,text,integer)'::regprocedure) is distinct from 'd5eaf0cd64c12fe790f34de26359b6f3|postgres|{postgres=X/postgres,service_role=X/postgres}|false' then raise exception 'Selector definition or authority changed';end if;
end$$;
create or replace function public.intelligence_select_uningested(
 p_tenant uuid,p_mapper_version text,p_limit integer default 25
) returns table(interaction_id uuid)
language sql stable security invoker set search_path=pg_catalog as $$
 with limits as (
  select greatest(1,least(coalesce(p_limit,25),200)) n
 ), eligible as materialized (
  select i.id,i.occurred_at,i.created_at,
   coalesce(i.source_connector_id='slack' and i.source_table='slack_messages'
    and i.interaction_type='slack_message' and i.status not in('deleted','removed')
    and i.metadata#>>'{work_context,version}'='learn-slack-work-context/1'
    and i.metadata#>>'{work_context,state}'='reviewed'
    and i.metadata#>>'{work_context,source_version}'=i.metadata->>'source_version'
    and exists(select 1 from public.slack_messages s where s.tenant_id=i.tenant_id
     and s.id=i.source_id and s.source_version=i.metadata->>'source_version'
     and not coalesce(s.provider_payload->>'subtype'='tombstone' and s.provider_payload->'hidden'='true'::jsonb,false)),false) reviewed
  from public.interactions i
  where i.tenant_id=p_tenant and i.processing_status='enriched'
   and not exists(select 1 from public.intelligence_ingestions g
    where g.tenant_id=p_tenant and g.interaction_id=i.id and g.mapper_version=p_mapper_version)
 ), reviewed_page as materialized (
  select e.id,e.occurred_at,e.created_at from eligible e where e.reviewed
  order by e.occurred_at asc nulls first,e.created_at asc,e.id
  limit (select n/5 from limits)
 ), historical_page as (
  select e.id,e.occurred_at,e.created_at from eligible e
  where not exists(select 1 from reviewed_page r where r.id=e.id)
  order by e.occurred_at asc nulls first,e.created_at asc,e.id
  limit (select n-(select count(*) from reviewed_page) from limits)
 )
 select x.id from (
  select r.*,0 lane from reviewed_page r union all select h.*,1 lane from historical_page h
 )x order by x.lane,x.occurred_at asc nulls first,x.created_at asc,x.id;
$$;
-- CREATE OR REPLACE preserves the existing owner and service-only EXECUTE ACL.
-- No table grants, jobs, schedules, data or queue priorities are changed.

do $$begin
if (select md5(p.prosrc)||'|'||pg_get_userbyid(p.proowner)||'|'||p.proacl::text||'|'||p.prosecdef::text||'|'||p.proconfig::text from pg_proc p where p.oid='public.intelligence_select_uningested(uuid,text,integer)'::regprocedure) is distinct from '7c853a1c8f7d5d787f0a26d685406472|postgres|{postgres=X/postgres,service_role=X/postgres}|false|{search_path=pg_catalog}' then raise exception 'Reviewed selector or authority differs';end if;
end$$;
commit;
