-- Give newly retained, unlinked Email a bounded indexed lane before the
-- linked-update audit. The older broad unlinked branch remains the fallback;
-- it is not moved, because running it first exceeded the ordinary job budget.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$declare definition text; old text; replacement text;
begin
  definition:=pg_get_functiondef(
    'public.learn_projection_pending(uuid,text,integer)'::regprocedure);
  if md5(definition) not in (
    'dc02928d4700ac5c15f92e81767f4e9f', -- TEST after exact rollback
    '2a0534eb8d0394bbec8b86714f4e7d1e'  -- LIVE after exact rollback
  ) then raise exception 'email_indexed_recent_baseline_changed';end if;
  if to_regprocedure('public.learn_projection_pending_email_recent(uuid,integer)') is not null
  then raise exception 'email_indexed_recent_helper_exists';end if;
  if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
    where c.relname='learn_email_projection_recent_import_idx'
      and i.indrelid='public.email_messages'::regclass
      and i.indisvalid and i.indisready)
  then raise exception 'email_indexed_recent_index_missing';end if;
  old:=$anchor$
 if p_source='email' then
  return query select * from public.learn_projection_pending_email_updates(p_tenant,bound);$anchor$;
  replacement:=$anchor$
 if p_source='email' then
  return query select * from public.learn_projection_pending_email_recent(p_tenant,bound);
  get diagnostics selected=row_count;
  if selected>0 then return;end if;
  return query select * from public.learn_projection_pending_email_updates(p_tenant,bound);$anchor$;
  if (length(definition)-length(replace(definition,old,'')))/length(old)<>1
  then raise exception 'email_indexed_recent_anchor_changed';end if;
end$$;

create function public.learn_projection_pending_email_recent(
  p_tenant uuid,p_limit integer default 50)
returns table(source_kind text,source_id uuid,source_revision text)
language sql volatile security definer set search_path=pg_catalog set timezone='UTC'
set statement_timeout='10s' as $$
with bounds as materialized (
  select greatest(1,least(100,coalesce(p_limit,50))) bound
), unlinked as materialized (
  select m.id,m.created_at
  from public.email_messages m cross join bounds b
  where m.tenant_id=p_tenant
    and exists(select 1 from public.tenants t where t.id=p_tenant and t.status='active')
    and m.created_at>=clock_timestamp()-interval '30 days'
    and not coalesce(m.provider='gmail' and
      m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
    and not exists(select 1 from public.interactions i
      where i.tenant_id=m.tenant_id and i.source_table='email_messages'
        and i.source_id=m.id)
  order by m.created_at desc,m.id desc
  limit (select least(512,greatest(64,bound*4)) from bounds)
), revisions as materialized (
  select m.id,m.created_at,
    public.learn_projection_revision(public.learn_email_source_fields(m),
      coalesce(to_jsonb(m)->>'origin_campaign_id','')) revision
  from unlinked u join public.email_messages m on m.tenant_id=p_tenant and m.id=u.id
), eligible as materialized (
  select r.* from revisions r
  where not exists(select 1 from public.learn_interaction_projection_receipts h
    where h.tenant_id=p_tenant and h.source_kind='email' and h.source_id=r.id
      and h.source_revision=r.revision and h.receipt->>'state'='review_required')
)
select 'email'::text,e.id,e.revision from eligible e
order by e.created_at desc,e.id desc limit (select bound from bounds)
$$;
revoke all on function public.learn_projection_pending_email_recent(uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.learn_projection_pending_email_recent(uuid,integer)
  to service_role;

do $$declare definition text; old text; replacement text;
begin
  definition:=pg_get_functiondef(
    'public.learn_projection_pending(uuid,text,integer)'::regprocedure);
  if md5(definition) not in (
    'dc02928d4700ac5c15f92e81767f4e9f',
    '2a0534eb8d0394bbec8b86714f4e7d1e'
  ) then raise exception 'email_indexed_recent_baseline_changed';end if;
  old:=$anchor$
 if p_source='email' then
  return query select * from public.learn_projection_pending_email_updates(p_tenant,bound);$anchor$;
  replacement:=$anchor$
 if p_source='email' then
  return query select * from public.learn_projection_pending_email_recent(p_tenant,bound);
  get diagnostics selected=row_count;
  if selected>0 then return;end if;
  return query select * from public.learn_projection_pending_email_updates(p_tenant,bound);$anchor$;
  if (length(definition)-length(replace(definition,old,'')))/length(old)<>1
  then raise exception 'email_indexed_recent_anchor_changed';end if;
  execute replace(definition,old,replacement);
end$$;
notify pgrst, 'reload schema';
commit;
