-- Keep the oldest-first missing interaction page bounded as the graph catches up.
-- The prior index anti-join probes every already projected prefix row again for
-- each page. Materialising source identities permits a bounded hash comparison
-- against the eligible tenant interactions without changing its exact result.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public.learn_graph_missing_interactions(uuid,integer)') is null
 then raise exception 'graph_missing_selector_absent';end if;
end$$;
create or replace function public.learn_graph_missing_interactions(p_tenant uuid,p_limit integer default 200)
returns table(id uuid,interaction_type text,occurred_at timestamptz,
 processing_status text,source_connector_id text,related_person_id uuid,related_company_id uuid)
language sql stable security definer set search_path=pg_catalog set timezone='UTC'
set statement_timeout='25s' as $$
 with existing as materialized (
  select source_id from public.graph_nodes
  where tenant_id=p_tenant and node_type='interaction' and source_table='interactions'
 )
 select i.id,i.interaction_type,i.occurred_at,i.processing_status,i.source_connector_id,
  i.related_person_id,i.related_company_id
 from public.interactions i join public.tenants t on t.id=i.tenant_id and t.status='active'
 left join existing n on n.source_id=i.id
 where i.tenant_id=p_tenant and i.processing_status in('ready','enriched')
  and n.source_id is null
 order by i.occurred_at,i.id
 limit greatest(1,least(200,coalesce(p_limit,200)))
$$;
revoke all on function public.learn_graph_missing_interactions(uuid,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_graph_missing_interactions(uuid,integer) to service_role;
commit;
