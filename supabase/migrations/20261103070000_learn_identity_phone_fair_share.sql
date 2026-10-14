-- Keep recent calls from waiting behind an older email catch-up. At most one
-- quarter of each existing identity batch is reserved for ready Phone rows;
-- the rest retains the original oldest-first order and review behavior.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if md5(pg_get_functiondef('public.learn_identity_pending(uuid,integer)'::regprocedure))
   <> 'f732741e58c3020b2bff15f90be2cd12'
 then raise exception 'identity_phone_fair_share_baseline_changed';end if;
end$$;

create or replace function public.learn_identity_pending(p_tenant uuid,p_limit integer default 20)
returns table(interaction_id uuid,source_revision text)
language sql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
 with limits as materialized (
  select greatest(1,least(200,coalesce(p_limit,20))) as bound
 ), phone as materialized (
  select i.id,public.learn_identity_revision(i) revision,i.occurred_at
  from public.interactions i join public.tenants t on t.id=i.tenant_id and t.status='active'
  where i.tenant_id=p_tenant and i.source_table='phone_calls'
   and i.processing_status in('pending','ready')
  order by i.occurred_at,i.id
  limit (select greatest(1,(bound+3)/4) from limits)
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
