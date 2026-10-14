begin;
set local search_path=pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$begin
if current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz' or current_setting('serviceos.release_sha256',true) is distinct from 'ab2bd371806fc77ec05226d6a1a164c2f92c806e44f4389608b9be331844e3a0' then raise exception 'Reviewed target/source required';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_projection_pending(uuid,text,integer)'::regprocedure) is distinct from '877329985a486be46a47285554307f57|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Projection selector definition or authority changed';end if;
if to_regclass('public.learn_email_projection_order_idx') is not null or to_regclass('public.learn_phone_projection_order_idx') is not null then raise exception 'Ordering indexes already exist';end if;
end$guard$;
create index learn_email_projection_order_idx on public.email_messages
 (tenant_id, (coalesce(received_at,sent_at,created_at)), id);
create index learn_phone_projection_order_idx on public.phone_calls
 (tenant_id, (coalesce(started_at,created_at)), id);
create or replace function public.learn_projection_pending(p_tenant uuid,p_source text,p_limit integer default 100)
 returns table(source_kind text,source_id uuid,source_revision text)
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
begin
 if p_source is null or p_source not in('all','phone','email') then raise exception 'projection_source_invalid' using errcode='22023';end if;
 return query with phone_candidates as materialized (
   select 'phone'::text kind,c.id,coalesce(c.started_at,c.created_at) occurred
   from public.phone_calls c left join public.interactions i on i.tenant_id=c.tenant_id and i.source_table='phone_calls' and i.source_id=c.id
   where c.tenant_id=p_tenant and p_source in('all','phone')
   and exists(select 1 from public.tenants t where t.id=p_tenant and t.status='active')
   and (i.id is null or case when i.metadata?'phone_handoff' then i.source_version is distinct from public.phone_projection_version(p_tenant,c.id)
    else i.metadata#>>'{source_projection,revision}' is null or i.metadata#>>'{source_projection,revision}' is distinct from public.learn_projection_revision(public.learn_phone_source_fields(c),null) end)
   and not exists(select 1 from public.learn_interaction_projection_receipts r where r.tenant_id=p_tenant and r.source_kind='phone' and r.source_id=c.id and r.receipt->>'state'='review_required'
    and r.source_revision=public.learn_projection_revision(public.learn_phone_source_fields(c),case when i.metadata?'phone_handoff' then public.phone_projection_version(p_tenant,c.id) else null end))
   order by coalesce(c.started_at,c.created_at),c.id limit greatest(1,least(2000,coalesce(p_limit,100)))
 ), email_candidates as materialized (
   select 'email'::text kind,m.id,coalesce(m.received_at,m.sent_at,m.created_at) occurred
   from public.email_messages m left join public.interactions i on i.tenant_id=m.tenant_id and i.source_table='email_messages' and i.source_id=m.id
   where m.tenant_id=p_tenant and p_source in('all','email') and not public.learn_email_is_draft(m)
   and exists(select 1 from public.tenants t where t.id=p_tenant and t.status='active')
   and (case when i.id is null or i.metadata#>>'{source_projection,revision}' is null then true else i.metadata#>>'{source_projection,revision}' is distinct from public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id','')) end)
   and not exists(select 1 from public.learn_interaction_projection_receipts r where r.tenant_id=p_tenant and r.source_kind='email' and r.source_id=m.id and r.receipt->>'state'='review_required'
    and r.source_revision=public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id','')))
   order by coalesce(m.received_at,m.sent_at,m.created_at),m.id limit greatest(1,least(2000,coalesce(p_limit,100)))
 ), candidates as materialized (
  select x.kind,x.id,x.occurred from (select * from phone_candidates union all select * from email_candidates) x
  order by x.occurred,x.kind,x.id limit greatest(1,least(2000,coalesce(p_limit,100)))
 ) select x.kind,x.id,case x.kind when 'phone' then
  (select public.learn_projection_revision(public.learn_phone_source_fields(c),case when i.metadata?'phone_handoff' then public.phone_projection_version(p_tenant,c.id) else null end)
   from public.phone_calls c left join public.interactions i on i.tenant_id=c.tenant_id and i.source_table='phone_calls' and i.source_id=c.id where c.tenant_id=p_tenant and c.id=x.id)
  else (select public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id','')) from public.email_messages m where m.tenant_id=p_tenant and m.id=x.id) end
 from candidates x order by x.occurred,x.kind,x.id;
end$$;

do $check$begin
if (select md5(p.prosrc)||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_projection_pending(uuid,text,integer)'::regprocedure) is distinct from '6bf08273de032cb80f5e73ab9f66a543|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Projection selector definition or authority changed';end if;
if pg_get_indexdef(to_regclass('public.learn_email_projection_order_idx')) is distinct from 'CREATE INDEX learn_email_projection_order_idx ON public.email_messages USING btree (tenant_id, COALESCE(received_at, sent_at, created_at), id)' or not coalesce((select indisvalid and indisready from pg_index where indexrelid=to_regclass('public.learn_email_projection_order_idx')),false) then raise exception 'Projection ordering index differs';end if;
if pg_get_indexdef(to_regclass('public.learn_phone_projection_order_idx')) is distinct from 'CREATE INDEX learn_phone_projection_order_idx ON public.phone_calls USING btree (tenant_id, COALESCE(started_at, created_at), id)' or not coalesce((select indisvalid and indisready from pg_index where indexrelid=to_regclass('public.learn_phone_projection_order_idx')),false) then raise exception 'Projection ordering index differs';end if;
end$check$;
commit;
