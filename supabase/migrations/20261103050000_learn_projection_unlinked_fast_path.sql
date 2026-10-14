-- Drain retained sources without repeatedly hashing every already-linked email.
-- The original exact revision selector remains callable and is used once the
-- bounded unlinked work is empty. Reviewed revisions stay held; source rows and
-- canonical identities are not changed by this selection repair.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure);
 if md5(definition)<>'aecb37afae999bfeccf55bc9b12f25c4'
  or to_regprocedure('public.learn_projection_pending_full(uuid,text,integer)') is not null
 then raise exception 'projection_fast_path_baseline_changed';end if;
 definition:=replace(definition,'FUNCTION public.learn_projection_pending(',
  'FUNCTION public.learn_projection_pending_full(');
 if position('FUNCTION public.learn_projection_pending_full(' in definition)=0
 then raise exception 'projection_fast_path_clone_unconfirmed';end if;
 execute definition;
end$$;
revoke all on function public.learn_projection_pending_full(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_projection_pending_full(uuid,text,integer) to service_role;

create or replace function public.learn_projection_pending(p_tenant uuid,p_source text,p_limit integer default 100)
returns table(source_kind text,source_id uuid,source_revision text)
language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
#variable_conflict use_column
declare bound integer:=greatest(1,least(2000,coalesce(p_limit,100)));
 selected integer;
begin
 if p_source is null or p_source not in('all','phone','email')
 then raise exception 'projection_source_invalid' using errcode='22023';end if;
 if p_source='phone' then
  return query select * from public.learn_projection_pending_full(p_tenant,p_source,bound);
  return;
 end if;
 if not exists(select 1 from public.tenants t where t.id=p_tenant and t.status='active')
 then return;end if;
 return query with unlinked as materialized (
  select m.id,coalesce(m.received_at,m.sent_at,m.created_at) occurred
  from public.email_messages m left join public.interactions i
   on i.tenant_id=m.tenant_id and i.source_table='email_messages' and i.source_id=m.id
  where m.tenant_id=p_tenant and i.id is null
   and not coalesce(m.provider='gmail' and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
  order by coalesce(m.received_at,m.sent_at,m.created_at),m.id
  limit least(2000,greatest(200,bound+100))
 ), email_revisions as materialized (
  select 'email'::text kind,m.id,u.occurred,
   public.learn_projection_revision(public.learn_email_source_fields(m),
    coalesce(to_jsonb(m)->>'origin_campaign_id','')) revision
  from unlinked u join public.email_messages m on m.tenant_id=p_tenant and m.id=u.id
 ), email_candidates as materialized (
  select e.kind,e.id,e.occurred,e.revision from email_revisions e
  where not exists(select 1 from public.learn_interaction_projection_receipts r
   where r.tenant_id=p_tenant and r.source_kind='email' and r.source_id=e.id
    and r.source_revision=e.revision and r.receipt->>'state'='review_required')
 ), phone_candidates as materialized (
  select p.source_kind kind,p.source_id id,coalesce(c.started_at,c.created_at) occurred,
   p.source_revision revision
  from public.learn_projection_pending_full(p_tenant,'phone',bound) p
  join public.phone_calls c on c.tenant_id=p_tenant and c.id=p.source_id
  where p_source='all'
 )
 select x.kind,x.id,x.revision from (
  select * from email_candidates union all select * from phone_candidates
 ) x order by x.occurred,x.kind,x.id limit bound;
 get diagnostics selected=row_count;
 if selected>0 then return;end if;
 -- No unlinked work remains. Revisit existing canonical rows for content-version
 -- changes using the original exact selector; do not silently mark them current.
 return query select * from public.learn_projection_pending_full(p_tenant,p_source,bound);
end$$;
commit;
