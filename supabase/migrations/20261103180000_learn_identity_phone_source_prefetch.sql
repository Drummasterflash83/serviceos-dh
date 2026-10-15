-- Preserve the existing one-quarter Phone fair share and oldest-first order.
-- Fetch pending Phone IDs through the existing (tenant, source table, source ID)
-- index before sorting; otherwise an almost-empty Phone queue can scan every
-- interaction in the tenant to find its few remaining calls.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if md5(pg_get_functiondef('public.learn_identity_pending(uuid,integer)'::regprocedure))
   <> '756ac1a5a7b493ebcd13c68791d59354'
 then raise exception 'identity_phone_source_prefetch_baseline_changed';end if;
end$$;

create or replace function public.learn_identity_pending(p_tenant uuid,p_limit integer default 20)
returns table(interaction_id uuid,source_revision text)
language sql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
 with limits as materialized (
  select greatest(1,least(200,coalesce(p_limit,20))) as bound
 ), phone_source as materialized (
  select i.id,i.occurred_at
  from public.interactions i join public.tenants t on t.id=i.tenant_id and t.status='active'
  where i.tenant_id=p_tenant and i.source_table='phone_calls'
   and i.processing_status in('pending','ready')
 ), phone_ids as materialized (
  select s.id,s.occurred_at from phone_source s
  order by s.occurred_at,s.id
  limit (select greatest(1,(bound+3)/4) from limits)
 ), phone as materialized (
  select p.id,public.learn_identity_revision(i) revision,p.occurred_at
  from phone_ids p join public.interactions i on i.id=p.id
 ), general as materialized (
  select i.id,public.learn_identity_revision(i) revision,i.occurred_at
  from public.interactions i join public.tenants t on t.id=i.tenant_id and t.status='active'
  where i.tenant_id=p_tenant and i.processing_status in('pending','ready')
   and not public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id)
   and not exists(select 1 from phone p where p.id=i.id)
  order by i.occurred_at,i.id
  limit (select bound-(select count(*) from phone) from limits)
 )
 select x.id,x.revision from (
  select 0 priority,p.id,p.revision,p.occurred_at from phone p
  union all
  select 1 priority,g.id,g.revision,g.occurred_at from general g
 ) x order by x.priority,x.occurred_at,x.id
$$;
commit;
