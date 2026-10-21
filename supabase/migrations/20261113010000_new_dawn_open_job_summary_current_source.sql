-- Backfill the exact current-source projection, then use it for the audited
-- Home totals read. The retained source history and paged reader are unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';

with latest_time as materialized (
 select v.tenant_id,v.connection_id,v.external_id,max(p.committed_at) observed_at
 from public.learn_business_input_versions v
 join public.learn_business_input_observations o on o.version_id=v.id
 join public.learn_business_input_pages p on p.id=o.page_id
  and p.tenant_id=v.tenant_id and p.connection_id=v.connection_id
  and p.provider=v.provider and p.collection=v.collection
 where v.provider='commusoft' and v.collection='jobs'
 group by v.tenant_id,v.connection_id,v.external_id
), latest_versions as (
 select t.tenant_id,t.connection_id,t.external_id,t.observed_at,
  min(v.id::text)::uuid source_version_id,
  min(p.id::text)::uuid source_page_id,
  count(distinct v.id) version_count
 from latest_time t
 join public.learn_business_input_versions v
  on v.tenant_id=t.tenant_id and v.connection_id=t.connection_id
   and v.provider='commusoft' and v.collection='jobs'
   and v.external_id=t.external_id
 join public.learn_business_input_observations o on o.version_id=v.id
 join public.learn_business_input_pages p on p.id=o.page_id
  and p.tenant_id=t.tenant_id and p.connection_id=t.connection_id
  and p.provider='commusoft' and p.collection='jobs'
  and p.committed_at=t.observed_at
 group by t.tenant_id,t.connection_id,t.external_id,t.observed_at
)
insert into public.new_dawn_commusoft_current_job_source as current_row
 (tenant_id,connection_id,external_id,observed_at,source_version_id,
  source_page_id,ambiguous)
select tenant_id,connection_id,external_id,observed_at,
 case when version_count=1 then source_version_id end,
 case when version_count=1 then source_page_id end,
 version_count<>1
from latest_versions
where true
on conflict(tenant_id,connection_id,external_id) do update set
 observed_at=excluded.observed_at,
 source_version_id=case
  when excluded.observed_at>current_row.observed_at
   then excluded.source_version_id
  when excluded.ambiguous or current_row.ambiguous
   or current_row.source_version_id is distinct from excluded.source_version_id
   then null
  else current_row.source_version_id end,
 source_page_id=case
  when excluded.observed_at>current_row.observed_at
   then excluded.source_page_id
  when excluded.ambiguous or current_row.ambiguous
   or current_row.source_version_id is distinct from excluded.source_version_id
   then null
  else current_row.source_page_id end,
 ambiguous=case
  when excluded.observed_at>current_row.observed_at then excluded.ambiguous
  else excluded.ambiguous or current_row.ambiguous
   or current_row.source_version_id is distinct from excluded.source_version_id end,
 updated_at=clock_timestamp()
where excluded.observed_at>=current_row.observed_at;

-- Preserve the existing actor, tenant, flag, audit and output contract. Only
-- replace the expensive history-wide source selection with its transactional
-- projection. A changed LIVE function fails closed before replacement.
do $release$
declare
 signature regprocedure := 'public.new_dawn_open_job_status_summary(uuid,text)'::regprocedure;
 prior text := pg_get_functiondef(signature);
 begin_marker text := ' with latest_time as materialized (';
 end_marker text := ' select count(*) filter(where status=''on_hold''),';
 start_at integer;
 end_at integer;
 replacement text := $new$ with source_status as (
  select case v.payload->>'status' when 'Open' then 'open'
    when 'ongoing' then 'open' when 'pending' then 'pending'
    when 'on_hold' then 'on_hold' end status,
   case when links.link_count=1 and links.current_exact then 'linked'
    else 'awaiting_review' end identity_state
  from public.new_dawn_commusoft_current_job_source c
  join public.learn_business_input_versions v
   on v.id=c.source_version_id and v.tenant_id=c.tenant_id
    and v.connection_id=c.connection_id and v.provider='commusoft'
    and v.collection='jobs' and v.external_id=c.external_id
  left join lateral (
   select count(*) link_count,bool_and(
    l.source_version_id=c.source_version_id and j.id is not null
    and j.metadata#>>'{learn_business_input,source_version_id}'=
      c.source_version_id::text
   ) current_exact
   from public.learn_business_input_current_links l
   left join public.jobs j on j.id=l.entity_id and j.tenant_id=c.tenant_id
   where l.tenant_id=c.tenant_id and l.connection_id=c.connection_id
    and l.provider='commusoft' and l.collection='jobs'
    and l.external_id=c.external_id and l.entity_kind='job'
    and l.entity_table='jobs'
  ) links on true
  where c.tenant_id=p_tenant and not c.ambiguous
   and c.observed_at<=as_of
   and jsonb_typeof(v.payload->'id')='number'
   and v.payload->>'id'=c.external_id
   and v.payload->>'status' in ('Open','ongoing','pending','on_hold')
 )
$new$;
begin
 if encode(sha256(convert_to(prior,'UTF8')),'hex') <>
  '1a373342368cc703a09860bc6162c0a98a8116cebd104719d212449fb9603f9a'
 then raise exception 'open_job_summary_baseline_changed'; end if;
 start_at:=position(begin_marker in prior);
 end_at:=position(end_marker in prior);
 if start_at<=0 or end_at<=start_at then
  raise exception 'open_job_summary_marker_changed';
 end if;
 execute left(prior,start_at-1)||replacement||substring(prior from end_at);
 if encode(sha256(convert_to(pg_get_functiondef(signature),'UTF8')),'hex') <>
  '9219b20578e4213f927785ffd4c0714066cdb5972997b7b02e9024ef0fff4e23'
 then raise exception 'open_job_summary_candidate_changed'; end if;
end $release$;

-- The confirmed customer groups use the same expensive saved-history
-- selection. Preserve every exact link/site/customer guard and only replace
-- its latest-source prefix with the same transactional projection.
do $customer_release$
declare
 signature regprocedure := 'public.new_dawn_customer_blockers(uuid,text)'::regprocedure;
 prior text := pg_get_functiondef(signature);
 begin_marker text := ' with latest_time as materialized (';
 end_marker text := ', grouped as (';
 start_at integer;
 end_at integer;
 replacement text := $new$ with linked as (
  select current_job.connection_id,current_job.external_id,
   current_job.source_version_id version_id,current_job.observed_at,
   case v.payload->>'status' when 'on_hold' then 'on_hold'
    when 'pending' then 'pending' end status,
   case when j.customer_company_id is not null then 'company' else 'person' end customer_kind,
   coalesce(j.customer_company_id,j.customer_person_id) customer_id,
   left(case when j.customer_company_id is not null then c.name else p.display_name end,200) customer_name
  from public.new_dawn_commusoft_current_job_source current_job
  join public.learn_business_input_versions v
   on v.id=current_job.source_version_id and v.tenant_id=current_job.tenant_id
    and v.connection_id=current_job.connection_id and v.provider='commusoft'
    and v.collection='jobs' and v.external_id=current_job.external_id
  join lateral (
   select count(*) link_count,min(l.entity_id::text)::uuid job_id,
    bool_and(l.source_version_id=current_job.source_version_id) current_version
   from public.learn_business_input_current_links l
   where l.tenant_id=p_tenant and l.connection_id=current_job.connection_id
    and l.provider='commusoft' and l.collection='jobs'
    and l.external_id=current_job.external_id and l.entity_kind='job'
    and l.entity_table='jobs'
  ) x on x.link_count=1 and x.current_version
  join public.jobs j on j.id=x.job_id and j.tenant_id=p_tenant
   and j.source_system='commusoft:connection:'||current_job.connection_id::text
   and j.external_id=current_job.external_id
   and j.metadata#>>'{learn_business_input,source_version_id}'=current_job.source_version_id::text
  join public.sites site on site.id=j.site_id and site.tenant_id=p_tenant
   and site.source_system=j.source_system
   and site.external_id=v.payload->>'propertyID'
  left join public.companies c on c.id=j.customer_company_id and c.tenant_id=p_tenant
  left join public.people p on p.id=j.customer_person_id and p.tenant_id=p_tenant
  where current_job.tenant_id=p_tenant and not current_job.ambiguous
   and current_job.observed_at<=as_of
   and jsonb_typeof(v.payload->'id')='number'
   and current_job.external_id ~ '^[1-9][0-9]{0,15}$'
   and v.payload->>'id'=current_job.external_id
   and jsonb_typeof(v.payload->'propertyID')='number'
   and v.payload->>'status' in('on_hold','pending')
   and (j.customer_company_id is null)<>(j.customer_person_id is null)
   and ((j.customer_company_id is not null
     and site.company_id=j.customer_company_id and site.person_id is null)
    or (j.customer_person_id is not null
     and site.person_id=j.customer_person_id and site.company_id is null))
   and ((j.customer_company_id is not null and c.id is not null
     and nullif(btrim(c.name),'') is not null)
    or (j.customer_person_id is not null and p.id is not null
     and nullif(btrim(p.display_name),'') is not null))
 )
$new$;
begin
 if encode(sha256(convert_to(prior,'UTF8')),'hex') <>
  'edc63a68703186905bbd7a61a791629c843b14a4ebdefe3b9660260f51e17e55'
 then raise exception 'customer_blockers_baseline_changed'; end if;
 start_at:=position(begin_marker in prior);
 end_at:=position(end_marker in prior);
 if start_at<=0 or end_at<=start_at then
  raise exception 'customer_blockers_marker_changed';
 end if;
 execute left(prior,start_at-1)||replacement||substring(prior from end_at);
 if encode(sha256(convert_to(pg_get_functiondef(signature),'UTF8')),'hex') <>
  'a2f5916d204014e3affced8136308a74e67d6c0d42ea7856cdf27d7276f813c0'
 then raise exception 'customer_blockers_candidate_changed'; end if;
end $customer_release$;
commit;
