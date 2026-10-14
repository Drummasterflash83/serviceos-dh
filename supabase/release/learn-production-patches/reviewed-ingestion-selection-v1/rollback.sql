begin;
set local search_path=public,pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
do $$begin
if current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz' or current_setting('serviceos.release_sha256',true) is distinct from '11f4c4a95a5c78604bb976c7ab6d7a1a06421841039c4e297f8c16c2142d7bc2' then raise exception 'Reviewed target/source required';end if;
if (select md5(p.prosrc)||'|'||pg_get_userbyid(p.proowner)||'|'||p.proacl::text||'|'||p.prosecdef::text||'|'||p.proconfig::text from pg_proc p where p.oid='public.intelligence_select_uningested(uuid,text,integer)'::regprocedure) is distinct from '7c853a1c8f7d5d787f0a26d685406472|postgres|{postgres=X/postgres,service_role=X/postgres}|false|{search_path=pg_catalog}' then raise exception 'Reviewed selector or authority differs';end if;
end$$;
CREATE OR REPLACE FUNCTION public.intelligence_select_uningested(p_tenant uuid, p_mapper_version text, p_limit integer DEFAULT 25)
 RETURNS TABLE(interaction_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
  select i.id
  from interactions i
  where i.tenant_id = p_tenant
    and i.processing_status = 'enriched'
    and not exists (
      select 1 from intelligence_ingestions g
      where g.tenant_id = p_tenant
        and g.interaction_id = i.id
        and g.mapper_version = p_mapper_version
    )
  order by i.occurred_at asc nulls first, i.created_at asc
  limit greatest(1, least(coalesce(p_limit, 25), 200));
$function$;

do $$begin
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||p.proacl::text||'|'||p.prosecdef::text from pg_proc p where p.oid='public.intelligence_select_uningested(uuid,text,integer)'::regprocedure) is distinct from 'd5eaf0cd64c12fe790f34de26359b6f3|postgres|{postgres=X/postgres,service_role=X/postgres}|false' then raise exception 'Selector definition or authority changed';end if;
end$$;
commit;
