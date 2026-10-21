-- Exact rollback: switch the audited summary to retained history before
-- dropping only the derived projection. Source rows and observations remain.
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
do $rollback$
declare
 signature regprocedure := 'public.new_dawn_open_job_status_summary(uuid,text)'::regprocedure;
 current_definition text := pg_get_functiondef(signature);
 begin_marker text := ' with source_status as (';
 end_marker text := ' select count(*) filter(where status=''on_hold''),';
 start_at integer;
 end_at integer;
 original text := $old$ with latest_time as materialized (
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
 ), source_status as (
  select case v.payload->>'status' when 'Open' then 'open'
    when 'ongoing' then 'open' when 'pending' then 'pending'
    when 'on_hold' then 'on_hold' end status,
   case when links.link_count=1 and links.current_exact then 'linked'
    else 'awaiting_review' end identity_state
  from unique_latest u join public.learn_business_input_versions v
   on v.id=u.version_id and v.tenant_id=p_tenant and v.connection_id=u.connection_id
    and v.provider='commusoft' and v.collection='jobs'
  left join lateral (
   select count(*) link_count,bool_and(
    l.source_version_id=u.version_id and j.id is not null
    and j.metadata#>>'{learn_business_input,source_version_id}'=u.version_id::text
   ) current_exact
   from public.learn_business_input_current_links l
   left join public.jobs j on j.id=l.entity_id and j.tenant_id=p_tenant
   where l.tenant_id=p_tenant and l.connection_id=u.connection_id
    and l.provider='commusoft' and l.collection='jobs'
    and l.external_id=u.external_id and l.entity_kind='job'
    and l.entity_table='jobs'
  ) links on true
  where jsonb_typeof(v.payload->'id')='number'
   and v.payload->>'id'=u.external_id
   and v.payload->>'status' in ('Open','ongoing','pending','on_hold')
 )
$old$;
begin
 if encode(sha256(convert_to(current_definition,'UTF8')),'hex') <>
  '9219b20578e4213f927785ffd4c0714066cdb5972997b7b02e9024ef0fff4e23'
 then raise exception 'open_job_summary_rollback_state_changed'; end if;
 start_at:=position(begin_marker in current_definition);
 end_at:=position(end_marker in current_definition);
 if start_at<=0 or end_at<=start_at then
  raise exception 'open_job_summary_rollback_marker_changed';
 end if;
 execute left(current_definition,start_at-1)||original||
  substring(current_definition from end_at);
 if encode(sha256(convert_to(pg_get_functiondef(signature),'UTF8')),'hex') <>
  '1a373342368cc703a09860bc6162c0a98a8116cebd104719d212449fb9603f9a'
 then raise exception 'open_job_summary_rollback_hash_changed'; end if;
end $rollback$;
drop trigger new_dawn_commusoft_current_job_source_observe
 on public.learn_business_input_observations;
drop function public.new_dawn_commusoft_current_job_source_observe();
drop table public.new_dawn_commusoft_current_job_source;
commit;
