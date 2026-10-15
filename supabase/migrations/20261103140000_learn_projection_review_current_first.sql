-- Count only current projection review holds without sorting every historical
-- receipt. A newer receipt of any state supersedes an older review; a changed
-- source revision also removes the old hold from the current count.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if md5(pg_get_functiondef('public.learn_projection_review_count(uuid,text)'::regprocedure))
   <> '4167acdf6e611866169a983dd83877f6'
 then raise exception 'projection_review_count_baseline_changed';end if;
end$$;

create or replace function public.learn_projection_review_count(p_tenant uuid,p_source text)
returns integer language sql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
 select count(*)::integer from public.learn_interaction_projection_receipts r
 where r.tenant_id=p_tenant and (p_source='all' or r.source_kind=p_source)
 and r.receipt->>'state'='review_required'
 and coalesce(r.receipt->>'reason','')<>'email_draft'
 and not exists(select 1 from public.learn_interaction_projection_receipts newer
  where newer.tenant_id=r.tenant_id and newer.source_kind=r.source_kind and newer.source_id=r.source_id
   and (newer.created_at,newer.request_id)>(r.created_at,r.request_id))
 and (case r.source_kind when 'phone' then exists(select 1 from public.phone_calls c left join public.interactions i
  on i.tenant_id=c.tenant_id and i.source_table='phone_calls' and i.source_id=c.id
  where c.tenant_id=p_tenant and c.id=r.source_id
   and r.source_revision=public.learn_projection_revision(public.learn_phone_source_fields(c),
    case when i.metadata?'phone_handoff' then public.phone_projection_version(p_tenant,c.id) else null end))
 else exists(select 1 from public.email_messages m where m.tenant_id=p_tenant and m.id=r.source_id
  and r.source_revision=public.learn_projection_revision(public.learn_email_source_fields(m),
   coalesce(to_jsonb(m)->>'origin_campaign_id',''))) end)
$$;
commit;
