-- A bounded current-message lane while the three-year Email import drains.
-- The older ordered selector and every retained source/receipt remain intact.
-- Service-only; no scheduler, provider call, source mutation or activation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.learn_projection_pending_current_email(
 p_tenant uuid,p_limit integer default 50)
returns table(source_kind text,source_id uuid,source_revision text)
language plpgsql volatile security definer set search_path=pg_catalog set timezone='UTC' as $$
#variable_conflict use_column
declare bound integer:=greatest(1,least(100,coalesce(p_limit,50)));
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'projection_current_forbidden' using errcode='42501';end if;
 if not exists(select 1 from public.tenants t where t.id=p_tenant and t.status='active')
 then return;end if;
 return query with unlinked as materialized (
  select m.id,coalesce(m.received_at,m.sent_at,m.created_at) occurred
  from public.email_messages m
  where m.tenant_id=p_tenant
   and coalesce(m.received_at,m.sent_at,m.created_at)>=now()-interval '1 day'
   and not coalesce(m.provider='gmail' and
    m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
   and not exists(select 1 from public.interactions i
    where i.tenant_id=m.tenant_id and i.source_table='email_messages' and i.source_id=m.id)
  order by coalesce(m.received_at,m.sent_at,m.created_at),m.id
  limit 2000
 ), ranked as materialized (
  select u.id,u.occurred,row_number() over(order by u.occurred,u.id) selection_rank
  from unlinked u
 ), held_first as materialized (
  select exists(select 1 from ranked u
   join public.learn_interaction_projection_receipts r on r.tenant_id=p_tenant
    and r.source_kind='email' and r.source_id=u.id
   where u.selection_rank<=bound and r.receipt->>'state'='review_required') held
 ), selected as materialized (
  select u.id,u.occurred from ranked u cross join held_first h
  where u.selection_rank<=bound or h.held
 ), versions as materialized (
  select m.id,s.occurred,
   public.learn_projection_revision(public.learn_email_source_fields(m),
    coalesce(to_jsonb(m)->>'origin_campaign_id','')) revision
  from selected s join public.email_messages m on m.tenant_id=p_tenant and m.id=s.id
 )
 select 'email'::text,v.id,v.revision from versions v
 where not exists(select 1 from public.learn_interaction_projection_receipts r
  where r.tenant_id=p_tenant and r.source_kind='email' and r.source_id=v.id
   and r.source_revision=v.revision and r.receipt->>'state'='review_required')
 order by v.occurred,v.id limit bound;
end$$;
revoke all on function public.learn_projection_pending_current_email(uuid,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_projection_pending_current_email(uuid,integer)
 to service_role;
notify pgrst, 'reload schema';
commit;
