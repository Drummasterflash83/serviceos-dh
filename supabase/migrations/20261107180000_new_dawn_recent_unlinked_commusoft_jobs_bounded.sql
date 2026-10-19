-- Scan only recently observed job identities before resolving current source
-- versions and related properties. Preserve the installed audited RPC contract.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create or replace function public.new_dawn_recent_unlinked_commusoft_jobs(
 p_tenant uuid,p_connection uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog set statement_timeout='15s' as $$
declare actor uuid:=auth.uid();window_start timestamptz:=clock_timestamp()-interval '24 hours';
 checked timestamptz;audit uuid:=gen_random_uuid();unlinked_count integer;
 newest_source timestamptz;latest_page timestamptz;entries jsonb;
begin
 if actor is null or p_tenant is null or p_connection is null
  or auth.role() is distinct from 'authenticated'
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'recent_unlinked_request_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,actor,false);
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='learn.enabled' and value='true'::jsonb for share;
 if not found then raise exception 'recent_unlinked_module_unavailable' using errcode='42501';end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='learn.inputs.commusoft.enabled' and value='true'::jsonb for share;
 if not found then raise exception 'recent_unlinked_module_unavailable' using errcode='42501';end if;
 perform 1 from public.tenant_connectors where tenant_id=p_tenant
  and provider='commusoft' and connector_id='commusoft'
  and enabled and status='active' for share;
 if not found then raise exception 'recent_unlinked_connector_unavailable' using errcode='42501';end if;
 perform 1 from public.provider_connections where tenant_id=p_tenant and id=p_connection
  and provider='commusoft' and status='configured' and revoked_at is null
  and verified_at<=clock_timestamp() for share;
 if not found then raise exception 'recent_unlinked_connection_unavailable' using errcode='42501';end if;

 with recent as materialized (
  select v.external_id,max(p.committed_at) observed_at
  from public.learn_business_input_pages p
  join public.learn_business_input_observations o on o.page_id=p.id
  join public.learn_business_input_versions v on v.id=o.version_id
   and v.tenant_id=p.tenant_id and v.connection_id=p.connection_id
   and v.provider=p.provider and v.collection=p.collection
  where p.tenant_id=p_tenant and p.connection_id=p_connection
   and p.provider='commusoft' and p.collection='jobs'
   and p.committed_at>=window_start
  group by v.external_id
 ), source_versions as materialized (
  select r.*,j.id version_id,j.payload
  from recent r
  left join lateral public.learn_business_input_latest(
   p_tenant,p_connection,'commusoft','jobs',r.external_id
  ) j on true
 ), unlinked as materialized (
  select s.* from source_versions s
  where not exists (
   select 1 from public.learn_business_input_current_links link
   join public.jobs j on j.tenant_id=link.tenant_id and j.id=link.entity_id
   where link.tenant_id=p_tenant and link.connection_id=p_connection
    and link.provider='commusoft' and link.collection='jobs'
    and link.external_id=s.external_id and link.entity_kind='job'
    and link.entity_table='jobs' and link.source_version_id=s.version_id
    and j.metadata#>>'{learn_business_input,source_version_id}'=s.version_id::text
  )
 ), page as materialized (
  select * from unlinked order by observed_at desc,external_id collate "C" desc limit 25
 ), job_facts as materialized (
  select p.*,public.learn_business_input_text(p.payload,'status') source_status,
   case when p.payload->>'propertyID' ~ '^[1-9][0-9]{0,15}$'
    then p.payload->>'propertyID' end property_ref
  from page p
 ), property_facts as materialized (
  select j.*,pr.id property_version,pr.payload property_payload,
   exists(select 1 from public.learn_business_input_versions v
    join public.learn_business_input_observations o on o.version_id=v.id
    join public.learn_business_input_pages pg on pg.id=o.page_id
     and pg.tenant_id=v.tenant_id and pg.connection_id=v.connection_id
     and pg.provider=v.provider and pg.collection=v.collection
    where v.tenant_id=p_tenant and v.connection_id=p_connection
     and v.provider='commusoft' and v.collection='properties'
     and v.external_id=j.property_ref) found_property
  from job_facts j
  left join lateral public.learn_business_input_latest(
   p_tenant,p_connection,'commusoft','properties',j.property_ref
  ) pr on true
 ), customer_refs as materialized (
  select p.*,case when p.property_payload->>'type'='customer' then p.property_ref
   when p.property_payload->>'type'='workaddress'
    and p.property_payload->>'parentPropertyID' ~ '^[1-9][0-9]{0,15}$'
    then p.property_payload->>'parentPropertyID' end customer_ref
  from property_facts p
 ), customer_facts as materialized (
  select c.*,parent.id parent_version,parent.payload parent_payload,
   exists(select 1 from public.learn_business_input_versions v
    join public.learn_business_input_observations o on o.version_id=v.id
    join public.learn_business_input_pages pg on pg.id=o.page_id
     and pg.tenant_id=v.tenant_id and pg.connection_id=v.connection_id
     and pg.provider=v.provider and pg.collection=v.collection
    where v.tenant_id=p_tenant and v.connection_id=p_connection
     and v.provider='commusoft' and v.collection='properties'
     and v.external_id=c.customer_ref) found_customer
  from customer_refs c
  left join lateral public.learn_business_input_latest(
   p_tenant,p_connection,'commusoft','properties',
   case when c.customer_ref is distinct from c.property_ref then c.customer_ref end
  ) parent on true
 ), states as (
  select c.external_id,c.version_id,c.observed_at,c.source_status,
   case when c.version_id is null then 'job_source_conflict'
    when c.property_ref is null then 'property_reference_missing'
    when not c.found_property then 'property_source_missing'
    when c.property_version is null then 'property_source_conflict'
    when c.property_payload->>'type'='customer' then 'customer_source_retained'
    when c.property_payload->>'type' is distinct from 'workaddress' then 'property_type_unresolved'
    when c.customer_ref is null then 'customer_reference_missing'
    when not c.found_customer then 'customer_source_missing'
    when c.parent_version is null then 'customer_source_conflict'
    when c.parent_payload->>'type' is distinct from 'customer' then 'customer_type_unresolved'
    else 'site_customer_source_retained' end relationship_state,
   case when (case when c.property_payload->>'type'='customer'
     then c.property_version else c.parent_version end) is null
    or (case when c.property_payload->>'type'='customer'
     then c.property_payload else c.parent_payload end)->>'type' is distinct from 'customer'
     then 'unresolved'
    when cl.id is null then 'unreviewed'
    when cl.source_version_id is distinct from
     (case when c.property_payload->>'type'='customer'
      then c.property_version else c.parent_version end) then 'review_changed'
    else 'reviewed' end customer_identity_state
  from customer_facts c
  left join public.learn_business_input_current_links cl
   on cl.tenant_id=p_tenant and cl.connection_id=p_connection
    and cl.provider='commusoft' and cl.collection='properties'
    and cl.external_id=c.customer_ref and cl.entity_kind='customer'
 )
 select (select count(*)::integer from unlinked),
  (select max(p.committed_at) from public.learn_business_input_pages p
   where p.tenant_id=p_tenant and p.connection_id=p_connection
    and p.provider='commusoft' and p.collection='jobs'
    and exists(select 1 from public.learn_business_input_observations o
     join public.learn_business_input_versions v on v.id=o.version_id
     where o.page_id=p.id and v.tenant_id=p.tenant_id
      and v.connection_id=p.connection_id and v.provider=p.provider
      and v.collection=p.collection)),
  coalesce((select jsonb_agg(jsonb_build_object(
   'external_id',external_id,'version_id',version_id,
   'source_observed_at',observed_at,'source_status',source_status,
   'relationship_state',relationship_state,
   'customer_identity_state',customer_identity_state)
   order by observed_at desc,external_id collate "C" desc) from states),'[]'::jsonb)
 into unlinked_count,newest_source,entries;
 select max(committed_at) into latest_page from public.learn_business_input_pages
  where tenant_id=p_tenant and connection_id=p_connection
   and provider='commusoft' and collection='jobs';
 perform public.learn_operator_input_access(p_tenant,actor,false);
 checked:=clock_timestamp();
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'client_jobs.recent_unlinked_source_review',
  'jobs',p_connection::text,jsonb_build_object(
   'unlinked_count',unlinked_count,'returned_count',jsonb_array_length(entries),
   'window_start',window_start,'latest_source_observed_at',newest_source,
   'latest_checkpoint_at',latest_page),
  btrim(p_reason),audit::text,false,'new-dawn-recent-unlinked-jobs');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-recent-unlinked-jobs/1',
  'tenant_id',p_tenant,'connection_id',p_connection,'actor_id',actor,
  'audit_id',audit,'observed_at',checked,'window_start',window_start,
  'unlinked_count',unlinked_count,'latest_source_observed_at',newest_source,
  'latest_checkpoint_at',latest_page,'rows',entries);
end $$;
revoke all on function public.new_dawn_recent_unlinked_commusoft_jobs(uuid,uuid,text)
 from public,anon,service_role;
grant execute on function public.new_dawn_recent_unlinked_commusoft_jobs(uuid,uuid,text)
 to authenticated;
commit;
