-- Restore only the prior audited open-job identity review function. No source,
-- link, flag or grant changes are reversed here.
begin;
set local lock_timeout='3s';
set local statement_timeout='35s';

do $$begin
 if encode(sha256(convert_to(pg_get_functiondef(
  'public.new_dawn_open_identity_review_page(uuid,uuid,text,text,integer)'::regprocedure),
  'UTF8')),'hex')<>'81a8316c6800eca74a89e2095f59b52ab910d19f8e2203122f18e1adcf6fe3d2'
 then raise exception 'open_identity_triage_rollback_candidate_changed';end if;
end $$;

create or replace function public.new_dawn_open_identity_review_page(
 p_tenant uuid,p_connection uuid,p_reason text,
 p_cursor text default null,p_limit integer default 25
) returns jsonb language plpgsql security definer
 set search_path=pg_catalog set statement_timeout='30s' as $$
declare
 actor uuid:=auth.uid(); anchor timestamptz; decoded jsonb;
 after_rank integer;after_external text; item record;
 candidate jsonb;property public.learn_business_input_versions%rowtype;
 property_ref text;customer_ref text;state text;hold text;
 rows jsonb:='[]'::jsonb;next_cursor text;more boolean:=false;
 n integer:=0;total_unlinked integer:=0;
 last_rank integer;last_external text;
 checked timestamptz;audit_id uuid:=gen_random_uuid();
begin
 if actor is null or auth.role() is distinct from 'authenticated'
  or p_tenant is null or p_connection is null
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500
  or p_limit is null or p_limit not between 1 and 40
  or (p_cursor is not null and length(p_cursor)>512)
  then raise exception 'open_identity_review_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.m2_link_review_queue' and value='true'::jsonb for share;
 if not found then raise exception 'open_identity_review_disabled' using errcode='42501';end if;
 perform 1 from public.provider_connections where tenant_id=p_tenant
  and id=p_connection and provider='commusoft' and status='configured'
  and revoked_at is null for share;
 if not found then raise exception 'open_identity_review_connection_unavailable'
  using errcode='42501';end if;
 if p_cursor is null then anchor:=clock_timestamp();
 else
  begin
   decoded:=convert_from(decode(p_cursor,'base64'),'utf8')::jsonb;
   if jsonb_typeof(decoded)<>'object' or decoded->>'v' is distinct from '1'
    or decoded->>'tenant' is distinct from p_tenant::text
    or decoded->>'connection' is distinct from p_connection::text
    or decoded->>'rank' is null or decoded->>'external' is null
    or decoded->>'anchor' is null
    or (decoded->>'rank')::integer not between 0 and 2
    or decoded->>'external' !~ '^[1-9][0-9]{0,15}$' then
    raise exception 'invalid cursor';end if;
   anchor:=(decoded->>'anchor')::timestamptz;
   after_rank:=(decoded->>'rank')::integer;
   after_external:=decoded->>'external';
   if anchor>clock_timestamp()+interval '1 minute'
    or anchor<clock_timestamp()-interval '2 hours' then
    raise exception 'invalid cursor';end if;
  exception when others then
   raise exception 'open_identity_review_invalid_cursor' using errcode='22023';
  end;
 end if;

 for item in
  with latest_time as materialized (
   select v.external_id,max(pg.committed_at) observed_at
   from public.learn_business_input_versions v
   join public.learn_business_input_observations o on o.version_id=v.id
   join public.learn_business_input_pages pg on pg.id=o.page_id
    and pg.tenant_id=v.tenant_id and pg.connection_id=v.connection_id
    and pg.provider='commusoft' and pg.collection='jobs'
   where v.tenant_id=p_tenant and v.connection_id=p_connection
    and v.provider='commusoft' and v.collection='jobs'
    and pg.committed_at<=anchor
   group by v.external_id
  ), unique_latest as materialized (
   select t.external_id,t.observed_at,min(v.id::text)::uuid version_id
   from latest_time t join public.learn_business_input_versions v
    on v.tenant_id=p_tenant and v.connection_id=p_connection
     and v.provider='commusoft' and v.collection='jobs'
     and v.external_id=t.external_id
   join public.learn_business_input_observations o on o.version_id=v.id
   join public.learn_business_input_pages pg on pg.id=o.page_id
    and pg.tenant_id=p_tenant and pg.connection_id=p_connection
    and pg.provider='commusoft' and pg.collection='jobs'
    and pg.committed_at=t.observed_at
   group by t.external_id,t.observed_at
   having count(distinct v.id)=1
  ), source as materialized (
   select u.external_id,u.version_id,u.observed_at,v.payload,
    case v.payload->>'status' when 'on_hold' then 'on_hold'
     when 'pending' then 'pending' when 'Open' then 'open'
     when 'ongoing' then 'open' end status
   from unique_latest u join public.learn_business_input_versions v
    on v.id=u.version_id and v.tenant_id=p_tenant
     and v.connection_id=p_connection and v.provider='commusoft'
     and v.collection='jobs'
   where jsonb_typeof(v.payload->'id')='number'
    and v.payload->>'id'=u.external_id
  ), open_unlinked as materialized (
   select s.*,
    case s.status when 'on_hold' then 0 when 'pending' then 1 else 2 end rank
   from source s
   left join lateral (
    select count(*) link_count,bool_and(l.source_version_id=s.version_id
     and j.id is not null and
     j.metadata#>>'{learn_business_input,source_version_id}'=s.version_id::text)
     current_exact
    from public.learn_business_input_current_links l
    left join public.jobs j on j.id=l.entity_id and j.tenant_id=p_tenant
    where l.tenant_id=p_tenant and l.connection_id=p_connection
     and l.provider='commusoft' and l.collection='jobs'
     and l.external_id=s.external_id and l.entity_kind='job'
     and l.entity_table='jobs'
   ) links on true
   where s.status is not null and
    not coalesce(links.link_count=1 and links.current_exact,false)
  )
  select x.*,(select count(*)::integer from open_unlinked) total_unlinked
  from open_unlinked x
  where after_rank is null or x.rank>after_rank
   or (x.rank=after_rank and x.external_id collate "C">after_external collate "C")
  order by x.rank,x.external_id collate "C" limit p_limit+1
 loop
  n:=n+1;
  total_unlinked:=item.total_unlinked;
  if n>p_limit then more:=true;exit;end if;
  property_ref:=case when jsonb_typeof(item.payload->'propertyID')='number'
   and item.payload->>'propertyID'~'^[1-9][0-9]{0,15}$'
   then item.payload->>'propertyID' end;
  customer_ref:=null;property:=null;
  if property_ref is not null then
   property:=public.learn_business_input_latest(p_tenant,p_connection,
    'commusoft','properties',property_ref);
   if property.id is not null and property.payload->>'id'=property_ref then
    customer_ref:=case when property.payload->>'type'='customer'
     then property_ref
     when jsonb_typeof(property.payload->'parentPropertyID')='number'
      and property.payload->>'parentPropertyID'~'^[1-9][0-9]{0,15}$'
     then property.payload->>'parentPropertyID' end;
   end if;
  end if;
  candidate:=public.new_dawn_commusoft_exact_link_candidate(
   p_tenant,p_connection,item.external_id);
  state:=candidate->>'state';
  hold:=case when state='ready' and
   candidate->>'job_version_id' is distinct from item.version_id::text
   then 'source_changed_refresh'
   when state='ready' then null
   else coalesce(candidate->>'reason','source_review_required') end;
  rows:=rows||jsonb_build_array(jsonb_build_object(
   'external_id',item.external_id,'status',item.status,
   'source_version_id',item.version_id,
   'source_observed_at',item.observed_at,
   'property_external_id',property_ref,
   'customer_external_id',customer_ref,
   'candidate_state',case when hold is null then 'ready' else 'review' end,
   'hold_reason',hold,
   'suggested_site_id',case when hold is null then candidate->>'site_id' end,
   'suggested_customer_id',case when hold is null
    then candidate->>'customer_entity_id' end));
  last_rank:=item.rank;last_external:=item.external_id;
 end loop;
 if more then
  next_cursor:=replace(encode(convert_to(jsonb_build_object('v',1,
   'tenant',p_tenant,'connection',p_connection,'anchor',anchor,
   'rank',last_rank,'external',last_external)::text,'utf8'),'base64'),E'\n','');
 end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 checked:=clock_timestamp();
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit_id,p_tenant,actor::text,'client_jobs.open_identity_review_page',
  'jobs',p_connection::text,
  jsonb_build_object('source_keys',(select coalesce(jsonb_agg(x->>'external_id'),
   '[]'::jsonb) from jsonb_array_elements(rows) x),
   'returned_count',jsonb_array_length(rows),'total_unlinked',total_unlinked,
   'snapshot_at',anchor,
   'has_more',more),btrim(p_reason),audit_id::text,false,
   'new-dawn-open-identity-review');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-open-identity-review/1',
  'tenant_id',p_tenant,'connection_id',p_connection,'actor_id',actor,
  'audit_id',audit_id,'observed_at',checked,'snapshot_at',anchor,
  'total_unlinked',total_unlinked,'rows',rows,'next_cursor',next_cursor);
end $$;
do $$begin
 if encode(sha256(convert_to(pg_get_functiondef(
  'public.new_dawn_open_identity_review_page(uuid,uuid,text,text,integer)'::regprocedure),
  'UTF8')),'hex')<>'39787455642e88b3ec7f0b21884869da438b917a06bee3a9f6992f74240ec217'
 then raise exception 'open_identity_triage_rollback_baseline_changed';end if;
end $$;
revoke all on function public.new_dawn_open_identity_review_page(uuid,uuid,text,text,integer)
 from public,anon,service_role;
grant execute on function public.new_dawn_open_identity_review_page(uuid,uuid,text,text,integer)
 to authenticated;
commit;
