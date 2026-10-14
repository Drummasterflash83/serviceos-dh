-- The ordinary latest-window graph refresh never reaches older retained
-- interactions. Select missing canonical nodes by exact tenant/source identity
-- in bounded oldest-first pages; the existing graph job owns publication.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public.learn_graph_missing_interactions(uuid,integer)') is not null
 then raise exception 'graph_missing_selector_exists';end if;
end$$;
create function public.learn_graph_missing_interactions(p_tenant uuid,p_limit integer default 200)
returns table(id uuid,interaction_type text,occurred_at timestamptz,
 processing_status text,source_connector_id text,related_person_id uuid,related_company_id uuid)
language sql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
 select i.id,i.interaction_type,i.occurred_at,i.processing_status,i.source_connector_id,
  i.related_person_id,i.related_company_id
 from public.interactions i join public.tenants t on t.id=i.tenant_id and t.status='active'
 where i.tenant_id=p_tenant and i.processing_status in('ready','enriched')
  and not exists(select 1 from public.graph_nodes n where n.tenant_id=i.tenant_id
   and n.node_type='interaction' and n.source_table='interactions' and n.source_id=i.id)
 order by i.occurred_at,i.id
 limit greatest(1,least(200,coalesce(p_limit,200)))
$$;
revoke all on function public.learn_graph_missing_interactions(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_graph_missing_interactions(uuid,integer) to service_role;
commit;
