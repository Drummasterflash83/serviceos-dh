-- Bounded job home from reviewed Commusoft links. No source-only job becomes a
-- client job; retained versions are compared without fetching from Commusoft.
-- The required tenant flag is not inserted here, so this route is default-OFF.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.new_dawn_source_job_home(p_tenant uuid,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();operator_read boolean:=p_reason is not null;
 entries jsonb;reviewed_count integer;checked timestamptz;audit_id uuid:=gen_random_uuid();
begin
 if actor is null or p_tenant is null or auth.role() is distinct from 'authenticated' then
  raise exception 'new_dawn_source_home_forbidden' using errcode='42501';end if;
 perform 1 from auth.users u where u.id=actor and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share;
 if not found then raise exception 'new_dawn_source_home_forbidden' using errcode='42501';end if;
 if operator_read then
  if length(btrim(p_reason)) not between 3 and 500 then
   raise exception 'new_dawn_source_home_invalid' using errcode='22023';end if;
  perform public.learn_operator_input_access(p_tenant,actor,true);
 else
  perform 1 from public.profiles p join public.tenants t on t.id=p.tenant_id
   where p.id=actor and p.tenant_id=p_tenant and p.role in ('owner','admin')
    and t.status='active' for share of p,t;
  if not found or exists(select 1 from public.view_as_context v
   where v.actor_user_id=actor and v.ended_at is null
    and (v.expires_at is null or v.expires_at>clock_timestamp()))
   or exists(select 1 from public.platform_authority_grants g
    where g.profile_id=actor
     and g.permission in ('platform.controlplane.view','platform.controlplane.admin')
     and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
     and coalesce(g.effective_to,'infinity')>clock_timestamp())
   then raise exception 'new_dawn_source_home_forbidden' using errcode='42501';end if;
 end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.source_job_home' and value='true'::jsonb for share;
 if not found then raise exception 'new_dawn_source_home_disabled' using errcode='42501';end if;

 with linked as materialized (
  select j.id,j.job_number,j.title,j.status,j.verified,j.updated_at,
   j.customer_person_id,j.customer_company_id,j.site_id,
   l.connection_id,l.external_id,l.source_version_id,
   j.metadata#>>'{learn_business_input,source_version_id}' metadata_source_version_id,
   count(*) over(partition by j.id) link_count,
   (select max(pg.committed_at) from public.learn_business_input_versions sv
     join public.learn_business_input_observations o on o.version_id=sv.id
     join public.learn_business_input_pages pg on pg.id=o.page_id
      and pg.tenant_id=sv.tenant_id and pg.connection_id=sv.connection_id
      and pg.provider=sv.provider and pg.collection=sv.collection
    where sv.tenant_id=p_tenant and sv.connection_id=l.connection_id
     and sv.provider='commusoft' and sv.collection='jobs'
     and sv.external_id=l.external_id) source_observed_at
  from public.jobs j join public.learn_business_input_current_links l
   on l.tenant_id=j.tenant_id and l.entity_id=j.id
    and l.entity_kind='job' and l.entity_table='jobs'
    and l.provider='commusoft' and l.collection='jobs'
  join public.learn_business_input_versions v on v.id=l.source_version_id
   and v.tenant_id=l.tenant_id and v.connection_id=l.connection_id
   and v.provider=l.provider and v.collection=l.collection and v.external_id=l.external_id
  where j.tenant_id=p_tenant
 ), valid as materialized (
  select * from linked where link_count=1 and source_observed_at is not null
   and metadata_source_version_id=source_version_id::text
   and exists(select 1 from public.learn_business_input_observations o
    where o.version_id=linked.source_version_id)
 ), candidates as materialized (
  select * from valid order by source_observed_at desc,updated_at desc nulls last,id limit 24
 ), rows as (
  select c.id,c.source_observed_at,c.updated_at,
   case when latest.id is null then 'source_ambiguous'
    when latest.id=c.source_version_id then 'reviewed_latest'
    else 'source_changed' end source_state,
   jsonb_build_object('job_number',c.job_number,'title',left(c.title,500),
    'status',c.status,'customer',left(coalesce(p.display_name,co.name),500),
    'address',left(coalesce(s.address_text,p.address_text,co.address_text),1000),
    'postcode',coalesce(s.postcode,p.postcode,co.postcode),
    'verified',c.verified,'updated_at',c.updated_at) fields
  from candidates c
  left join lateral (select (public.learn_business_input_latest(
   p_tenant,c.connection_id,'commusoft','jobs',c.external_id)).id) latest on true
  left join public.people p on p.id=c.customer_person_id and p.tenant_id=p_tenant
  left join public.companies co on co.id=c.customer_company_id and co.tenant_id=p_tenant
  left join public.sites s on s.id=c.site_id and s.tenant_id=p_tenant
 )
 select (select count(*)::integer from valid),
  coalesce((select jsonb_agg(jsonb_build_object('id',id,'fields',fields,
   'source_state',source_state,'source_observed_at',source_observed_at)
   order by case source_state when 'source_changed' then 0
    when 'source_ambiguous' then 1 else 2 end,
    source_observed_at desc,updated_at desc nulls last,id) from rows),'[]'::jsonb)
 into reviewed_count,entries;
 if operator_read then perform public.learn_operator_input_access(p_tenant,actor,true);end if;
 checked:=clock_timestamp();
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit_id,p_tenant,actor::text,
  case when operator_read then 'client_jobs.source_home_preview' else 'client_jobs.source_home_read' end,
  'jobs',p_tenant::text,jsonb_build_object('record_ids',
   (select coalesce(jsonb_agg(x->'id'),'[]'::jsonb) from jsonb_array_elements(entries) x),
   'reviewed_job_count',reviewed_count),
  case when operator_read then btrim(p_reason) else 'Client source-backed job home' end,
  audit_id::text,false,'new-dawn-source-job-home');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-source-job-home/1','tenant_id',p_tenant,
  'actor_id',actor,'audit_id',audit_id,'observed_at',checked,
  'reviewed_job_count',reviewed_count,'rows',entries);
end $$;
revoke all on function public.new_dawn_source_job_home(uuid,text) from public,anon,service_role;
grant execute on function public.new_dawn_source_job_home(uuid,text) to authenticated;
commit;
