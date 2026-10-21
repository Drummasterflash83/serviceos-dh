-- Show only customers attached to uniquely retained, exactly linked current
-- Commusoft jobs whose saved status is On hold or Pending. No source inference.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.new_dawn_customer_blockers(
 p_tenant uuid,p_reason text default null
) returns jsonb language plpgsql security definer
 set search_path=pg_catalog set statement_timeout='20s' as $$
declare
 actor uuid:=auth.uid(); operator_read boolean:=p_reason is not null;
 as_of timestamptz:=statement_timestamp(); flag_name text;
 groups jsonb; group_count integer; job_count integer; audit_id uuid:=gen_random_uuid();
begin
 if actor is null or p_tenant is null or auth.role() is distinct from 'authenticated'
 then raise exception 'customer_blockers_forbidden' using errcode='42501';end if;
 perform 1 from auth.users u where u.id=actor and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=as_of) for share;
 if not found then raise exception 'customer_blockers_forbidden' using errcode='42501';end if;
 if operator_read then
  if length(btrim(p_reason)) not between 3 and 500
  then raise exception 'customer_blockers_reason_invalid' using errcode='22023';end if;
  perform public.learn_operator_input_access(p_tenant,actor,true);
  flag_name:='new_dawn.open_job_page.operator_preview';
 else
  perform 1 from public.profiles p join public.tenants t on t.id=p.tenant_id
   where p.id=actor and p.tenant_id=p_tenant and p.role in('owner','admin')
    and t.status='active' for share of p,t;
  if not found or exists(select 1 from public.view_as_context v
   where v.actor_user_id=actor and v.ended_at is null
    and (v.expires_at is null or v.expires_at>as_of))
   or exists(select 1 from public.platform_authority_grants g
    where g.profile_id=actor and g.permission in
     ('platform.controlplane.view','platform.controlplane.admin')
     and coalesce(g.effective_from,'-infinity')<=as_of
     and coalesce(g.effective_to,'infinity')>as_of)
  then raise exception 'customer_blockers_forbidden' using errcode='42501';end if;
  flag_name:='new_dawn.open_job_page';
 end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag=flag_name and value='true'::jsonb for share;
 if not found then raise exception 'customer_blockers_disabled' using errcode='42501';end if;

 with latest_time as materialized (
  select v.connection_id,v.external_id,max(pg.committed_at) observed_at
  from public.learn_business_input_versions v
  join public.learn_business_input_observations o on o.version_id=v.id
  join public.learn_business_input_pages pg on pg.id=o.page_id
   and pg.tenant_id=v.tenant_id and pg.connection_id=v.connection_id
   and pg.provider=v.provider and pg.collection=v.collection
  where v.tenant_id=p_tenant and v.provider='commusoft'
   and v.collection='jobs' and pg.committed_at<=as_of
  group by v.connection_id,v.external_id
 ), unique_latest as materialized (
  select t.connection_id,t.external_id,t.observed_at,min(v.id::text)::uuid version_id
  from latest_time t
  join public.learn_business_input_versions v
   on v.tenant_id=p_tenant and v.connection_id=t.connection_id
    and v.provider='commusoft' and v.collection='jobs' and v.external_id=t.external_id
  join public.learn_business_input_observations o on o.version_id=v.id
  join public.learn_business_input_pages pg on pg.id=o.page_id
   and pg.tenant_id=p_tenant and pg.connection_id=t.connection_id
   and pg.provider='commusoft' and pg.collection='jobs'
   and pg.committed_at=t.observed_at
  group by t.connection_id,t.external_id,t.observed_at
  having count(distinct v.id)=1
 ), linked as (
  select u.connection_id,u.external_id,u.version_id,u.observed_at,
   case v.payload->>'status' when 'on_hold' then 'on_hold'
    when 'pending' then 'pending' end status,
   case when j.customer_company_id is not null then 'company' else 'person' end customer_kind,
   coalesce(j.customer_company_id,j.customer_person_id) customer_id,
   left(case when j.customer_company_id is not null then c.name else p.display_name end,200) customer_name
  from unique_latest u
  join public.learn_business_input_versions v
   on v.id=u.version_id and v.tenant_id=p_tenant and v.connection_id=u.connection_id
    and v.provider='commusoft' and v.collection='jobs' and v.external_id=u.external_id
  join lateral (
   select count(*) link_count,min(l.entity_id::text)::uuid job_id,
    bool_and(l.source_version_id=u.version_id) current_version
   from public.learn_business_input_current_links l
   where l.tenant_id=p_tenant and l.connection_id=u.connection_id
    and l.provider='commusoft' and l.collection='jobs'
    and l.external_id=u.external_id and l.entity_kind='job' and l.entity_table='jobs'
  ) x on x.link_count=1 and x.current_version
  join public.jobs j on j.id=x.job_id and j.tenant_id=p_tenant
   and j.source_system='commusoft:connection:'||u.connection_id::text
   and j.external_id=u.external_id
   and j.metadata#>>'{learn_business_input,source_version_id}'=u.version_id::text
  join public.sites site on site.id=j.site_id and site.tenant_id=p_tenant
  left join public.companies c on c.id=j.customer_company_id and c.tenant_id=p_tenant
  left join public.people p on p.id=j.customer_person_id and p.tenant_id=p_tenant
  where jsonb_typeof(v.payload->'id')='number'
   and u.external_id ~ '^[1-9][0-9]{0,15}$'
   and v.payload->>'id'=u.external_id
   and v.payload->>'status' in('on_hold','pending')
   and (j.customer_company_id is null)<>(j.customer_person_id is null)
   and ((j.customer_company_id is not null and c.id is not null
     and nullif(btrim(c.name),'') is not null)
    or (j.customer_person_id is not null and p.id is not null
     and nullif(btrim(p.display_name),'') is not null))
 ), grouped as (
  select customer_kind,customer_id,customer_name,
   count(*) filter(where status='on_hold') on_hold,
   count(*) filter(where status='pending') pending,
   jsonb_agg(jsonb_build_object('connection_id',connection_id,
    'external_id',external_id,'source_version_id',version_id,
    'source_observed_at',observed_at,'status',status)
    order by case status when 'on_hold' then 0 else 1 end,
     external_id collate "C",connection_id) jobs
  from linked group by customer_kind,customer_id,customer_name
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'customer_kind',customer_kind,'customer_id',customer_id,
  'customer_name',customer_name,'on_hold',on_hold,'pending',pending,'jobs',jobs)
  order by on_hold desc,pending desc,customer_name collate "C",customer_id),
  '[]'::jsonb) into groups from grouped;
 group_count:=jsonb_array_length(groups);
 select coalesce(sum((g->>'on_hold')::integer+(g->>'pending')::integer),0)
  into job_count from jsonb_array_elements(groups) g;
 if job_count>2000 or octet_length(groups::text)>250000
 then raise exception 'customer_blockers_too_large' using errcode='54000';end if;

 if operator_read then perform public.learn_operator_input_access(p_tenant,actor,true);
 else
  perform 1 from public.profiles p join public.tenants t on t.id=p.tenant_id
   where p.id=actor and p.tenant_id=p_tenant and p.role in('owner','admin')
    and t.status='active' for share of p,t;
  if not found or exists(select 1 from public.view_as_context v
   where v.actor_user_id=actor and v.ended_at is null
    and (v.expires_at is null or v.expires_at>clock_timestamp()))
   or exists(select 1 from public.platform_authority_grants g
    where g.profile_id=actor and g.permission in
     ('platform.controlplane.view','platform.controlplane.admin')
     and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
     and coalesce(g.effective_to,'infinity')>clock_timestamp())
  then raise exception 'customer_blockers_forbidden' using errcode='42501';end if;
 end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag=flag_name and value='true'::jsonb for share;
 if not found then raise exception 'customer_blockers_disabled' using errcode='42501';end if;
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit_id,p_tenant,actor::text,
  case when operator_read then 'client_jobs.customer_blockers_preview'
   else 'client_jobs.customer_blockers_read' end,
  'jobs',p_tenant::text,
  jsonb_build_object('snapshot_at',as_of,'customer_count',group_count,
   'job_count',job_count),
  case when operator_read then btrim(p_reason) else 'Client customer-held jobs' end,
  audit_id::text,false,'new-dawn-customer-blockers');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-customer-blockers/1',
  'tenant_id',p_tenant,'actor_id',actor,'audit_id',audit_id,
  'observed_at',clock_timestamp(),'snapshot_at',as_of,
  'linked_blocked_jobs',job_count,'groups',groups);
end $$;
revoke all on function public.new_dawn_customer_blockers(uuid,text)
 from public,anon,service_role;
grant execute on function public.new_dawn_customer_blockers(uuid,text)
 to authenticated;
commit;
