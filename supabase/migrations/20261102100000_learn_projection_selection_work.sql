-- Bound repair selection work without changing source eligibility or publication.
-- Defer full row serialisation until a source fingerprint is actually needed.
-- Retain exact revision comparisons and review holds, then fingerprint the selected
-- batch. CREATE OR REPLACE retains the existing service-only owner/ACL.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public.learn_projection_pending(uuid,text,integer)') is null
 then raise exception 'projection_selection_prerequisite_missing';end if;
end$$;
create or replace function public.learn_projection_pending(p_tenant uuid,p_source text,p_limit integer default 100)
 returns table(source_kind text,source_id uuid,source_revision text)
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
begin
 if p_source is null or p_source not in('all','phone','email') then raise exception 'projection_source_invalid' using errcode='22023';end if;
 return query with candidates as materialized (
  select x.kind,x.id,x.occurred from (
   select 'phone'::text kind,c.id,coalesce(c.started_at,c.created_at) occurred
   from public.phone_calls c left join public.interactions i on i.tenant_id=c.tenant_id and i.source_table='phone_calls' and i.source_id=c.id
   where c.tenant_id=p_tenant and p_source in('all','phone')
   and (i.id is null or case when i.metadata?'phone_handoff' then i.source_version is distinct from public.phone_projection_version(p_tenant,c.id)
    else i.metadata#>>'{source_projection,revision}' is null or i.metadata#>>'{source_projection,revision}' is distinct from public.learn_projection_revision(public.learn_phone_source_fields(c),null) end)
   and not exists(select 1 from public.learn_interaction_projection_receipts r where r.tenant_id=p_tenant and r.source_kind='phone' and r.source_id=c.id and r.receipt->>'state'='review_required'
    and r.source_revision=public.learn_projection_revision(public.learn_phone_source_fields(c),case when i.metadata?'phone_handoff' then public.phone_projection_version(p_tenant,c.id) else null end))
   union all
   select 'email',m.id,coalesce(m.received_at,m.sent_at,m.created_at)
   from public.email_messages m left join public.interactions i on i.tenant_id=m.tenant_id and i.source_table='email_messages' and i.source_id=m.id
   where m.tenant_id=p_tenant and p_source in('all','email') and not public.learn_email_is_draft(m)
   and (case when i.id is null or i.metadata#>>'{source_projection,revision}' is null then true else i.metadata#>>'{source_projection,revision}' is distinct from public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id','')) end)
   and not exists(select 1 from public.learn_interaction_projection_receipts r where r.tenant_id=p_tenant and r.source_kind='email' and r.source_id=m.id and r.receipt->>'state'='review_required'
    and r.source_revision=public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id','')))
  ) x where exists(select 1 from public.tenants t where t.id=p_tenant and t.status='active')
  order by x.occurred,x.kind,x.id limit greatest(1,least(2000,coalesce(p_limit,100)))
 ) select x.kind,x.id,case x.kind when 'phone' then
  (select public.learn_projection_revision(public.learn_phone_source_fields(c),case when i.metadata?'phone_handoff' then public.phone_projection_version(p_tenant,c.id) else null end)
   from public.phone_calls c left join public.interactions i on i.tenant_id=c.tenant_id and i.source_table='phone_calls' and i.source_id=c.id where c.tenant_id=p_tenant and c.id=x.id)
  else (select public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id','')) from public.email_messages m where m.tenant_id=p_tenant and m.id=x.id) end
 from candidates x order by x.occurred,x.kind,x.id;
end$$;

commit;
