-- Keep the active Email lane on a bounded source-update window once its
-- recent-unlinked pass is empty. The source's updated_at trigger and immutable
-- committed projection receipts are the progress boundary; an unchanged
-- canonical revision is still returned so the publisher records a fresh
-- unchanged receipt and advances past metadata-only source updates.
-- Existing legacy interactions without a projection revision remain visible
-- for separate reviewed reconciliation. This change does not silently rewrite
-- those pre-framework canonical records or alter Phone selection.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$declare definition text; hits integer;
begin
 definition:=pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure);
 if md5(definition) not in ('6df5eceae994dec6085656f9a2eb4db9',
                            '7d073a1af6e1fb5c32478af58e7d6221')
 then raise exception 'email_receipt_window_baseline_changed';end if;
 hits:=(length(definition)-length(replace(definition,
  'return query select * from public.learn_projection_pending_full(p_tenant,p_source,bound);','')))
  /length('return query select * from public.learn_projection_pending_full(p_tenant,p_source,bound);');
 if hits<>2 then raise exception 'email_receipt_window_anchor_changed';end if;
 if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
  where c.relname='learn_email_projection_updated_idx' and i.indrelid='public.email_messages'::regclass
   and i.indisvalid and i.indisready)
 then raise exception 'email_receipt_window_index_missing';end if;
 if not exists(select 1 from pg_trigger t
  where t.tgrelid='public.email_messages'::regclass
   and t.tgname='email_messages_set_updated_at' and t.tgenabled='O')
 then raise exception 'email_updated_at_trigger_missing';end if;
end$$;

create function public.learn_projection_pending_email_updates(p_tenant uuid,p_limit integer default 50)
returns table(source_kind text,source_id uuid,source_revision text)
language sql volatile security definer set search_path=pg_catalog set timezone='UTC'
set statement_timeout='20s' as $$
 with bounds as materialized (
  select greatest(1,least(100,coalesce(p_limit,50))) bound
 ), selected as materialized (
  select m.id,m.updated_at
  from public.email_messages m
  join public.interactions i on i.tenant_id=m.tenant_id
   and i.source_table='email_messages' and i.source_id=m.id
  cross join bounds b
  where m.tenant_id=p_tenant
   and exists(select 1 from public.tenants t where t.id=p_tenant and t.status='active')
   and i.metadata#>>'{source_projection,revision}' is not null
   and not coalesce(m.provider='gmail' and
    m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
   and m.updated_at>coalesce((select max(r.created_at)
    from public.learn_interaction_projection_receipts r
    where r.tenant_id=m.tenant_id and r.source_kind='email'
     and r.source_id=m.id and r.receipt->>'state'='committed'),'-infinity'::timestamptz)
   and not exists(select 1 from public.learn_interaction_projection_receipts h
    where h.tenant_id=m.tenant_id and h.source_kind='email'
     and h.source_id=m.id and h.receipt->>'state'='review_required'
     and h.created_at>=m.updated_at)
  order by m.updated_at desc,m.id desc
  limit least(1000,greatest(256,(select bound from bounds)+64))
 ), versions as materialized (
  select s.id,s.updated_at,
   public.learn_projection_revision(public.learn_email_source_fields(m),
    coalesce(to_jsonb(m)->>'origin_campaign_id','')) revision
  from selected s join public.email_messages m on m.tenant_id=p_tenant and m.id=s.id
 )
 select 'email'::text,v.id,v.revision from versions v
 where not exists(select 1 from public.learn_interaction_projection_receipts h
  where h.tenant_id=p_tenant and h.source_kind='email'
   and h.source_id=v.id and h.source_revision=v.revision
   and h.receipt->>'state'='review_required')
 order by v.updated_at desc,v.id desc limit (select bound from bounds)
$$;
revoke all on function public.learn_projection_pending_email_updates(uuid,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_projection_pending_email_updates(uuid,integer)
 to service_role;

create function public.learn_projection_pending_bounded_fallback(
 p_tenant uuid,p_source text,p_limit integer)
returns table(source_kind text,source_id uuid,source_revision text)
language plpgsql volatile security definer set search_path=pg_catalog set timezone='UTC'
set statement_timeout='25s' as $$
begin
 if p_source='email' then
  return query select * from public.learn_projection_pending_email_updates(p_tenant,p_limit);
 else
  return query select * from public.learn_projection_pending_full(p_tenant,p_source,p_limit);
 end if;
end$$;
revoke all on function public.learn_projection_pending_bounded_fallback(uuid,text,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_projection_pending_bounded_fallback(uuid,text,integer)
 to service_role;

do $$declare definition text; old text;
begin
 definition:=pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure);
 old:='return query select * from public.learn_projection_pending_full(p_tenant,p_source,bound);';
 if md5(definition) not in ('6df5eceae994dec6085656f9a2eb4db9',
                            '7d073a1af6e1fb5c32478af58e7d6221')
 then raise exception 'email_receipt_window_baseline_changed';end if;
 execute replace(definition,old,
  'return query select * from public.learn_projection_pending_bounded_fallback(p_tenant,p_source,bound);');
end$$;
notify pgrst, 'reload schema';
commit;
