-- Run in the disposable synthetic database after both candidate migrations.
do $check$
declare
 result jsonb;
 cross_tenant_refused boolean:=false;
begin
 if (select count(*) from public.new_dawn_commusoft_current_job_source)
   <>5 then raise exception 'current_job_source_backfill_count'; end if;
 if not exists(select 1 from public.new_dawn_commusoft_current_job_source
   where tenant_id='00000000-0000-0000-0000-000000000001'
    and external_id='101' and not ambiguous
    and source_version_id='20000000-0000-4000-8000-000000000008')
  or not exists(select 1 from public.new_dawn_commusoft_current_job_source
   where tenant_id='00000000-0000-0000-0000-000000000001'
    and external_id='103' and ambiguous and source_version_id is null)
 then raise exception 'current_job_source_latest_or_tie'; end if;
 if has_table_privilege('authenticated',
   'public.new_dawn_commusoft_current_job_source','SELECT')
  or has_table_privilege('service_role',
   'public.new_dawn_commusoft_current_job_source','SELECT')
  or has_function_privilege('anon',
   'public.new_dawn_open_job_status_summary(uuid,text)','EXECUTE')
  or not has_function_privilege('authenticated',
   'public.new_dawn_open_job_status_summary(uuid,text)','EXECUTE')
 then raise exception 'current_job_source_grants'; end if;
 result:=public.new_dawn_open_job_status_summary(
  '00000000-0000-0000-0000-000000000001',null);
 if result->'counts'<>'{"open":1,"pending":1,"on_hold":0,"total":2}'::jsonb
  or result->'identity'<>'{"linked":0,"awaiting_review":2}'::jsonb
 then raise exception 'current_job_source_summary_changed'; end if;
 begin
  perform public.new_dawn_open_job_status_summary(
   '00000000-0000-0000-0000-000000000002',null);
 exception when sqlstate '42501' then cross_tenant_refused:=true;
 end;
 if not cross_tenant_refused then raise exception 'current_job_source_tenant_leak'; end if;
end $check$;

-- An equal-time different version with the same source ID is withheld.
insert into public.learn_business_input_pages values
 ('30000000-0000-4000-8000-000000000009',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','2026-10-03');
insert into public.learn_business_input_versions values
 ('20000000-0000-4000-8000-000000000009',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','102',
  '{"id":102,"status":"pending"}');
insert into public.learn_business_input_observations values
 ('30000000-0000-4000-8000-000000000009',
  '20000000-0000-4000-8000-000000000009',1);
do $check$
declare r jsonb;
begin
 if not exists(select 1 from public.new_dawn_commusoft_current_job_source
   where external_id='102' and ambiguous and source_version_id is null)
 then raise exception 'current_job_source_tie_not_held'; end if;
 r:=public.new_dawn_open_job_status_summary(
  '00000000-0000-0000-0000-000000000001',null);
 if r->'counts'<>'{"open":0,"pending":1,"on_hold":0,"total":1}'::jsonb
 then raise exception 'current_job_source_tie_counted'; end if;
end $check$;

-- A newer retained version resolves the old tie without any manual cache edit.
insert into public.learn_business_input_pages values
 ('30000000-0000-4000-8000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','2026-10-05');
insert into public.learn_business_input_versions values
 ('20000000-0000-4000-8000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','102',
  '{"id":102,"status":"Open","revision":2}');
insert into public.learn_business_input_observations values
 ('30000000-0000-4000-8000-000000000010',
  '20000000-0000-4000-8000-000000000010',1);
do $check$
declare r jsonb;
begin
 if not exists(select 1 from public.new_dawn_commusoft_current_job_source
   where external_id='102' and not ambiguous
    and source_version_id='20000000-0000-4000-8000-000000000010')
 then raise exception 'current_job_source_newer_not_released'; end if;
 r:=public.new_dawn_open_job_status_summary(
  '00000000-0000-0000-0000-000000000001',null);
 if r->'counts'<>'{"open":1,"pending":1,"on_hold":0,"total":2}'::jsonb
 then raise exception 'current_job_source_newer_count_wrong'; end if;
end $check$;

-- The second audited Home reader must show only one exact, same-version
-- customer/site/job link and withhold an equal-time source conflict.
drop view public.learn_business_input_current_links;
create table public.learn_business_input_current_links (
 tenant_id uuid,connection_id uuid,provider text,collection text,
 external_id text,entity_kind text,entity_table text,entity_id uuid,
 source_version_id uuid
);
alter table public.jobs add column source_system text;
alter table public.jobs add column external_id text;
alter table public.jobs add column site_id uuid;
alter table public.jobs add column customer_company_id uuid;
alter table public.jobs add column customer_person_id uuid;
create table public.sites (
 id uuid,tenant_id uuid,source_system text,external_id text,
 company_id uuid,person_id uuid
);
create table public.companies (id uuid,tenant_id uuid,name text);
create table public.people (id uuid,tenant_id uuid,display_name text);
insert into public.companies values
 ('40000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000001','Synthetic Company');
insert into public.sites values
 ('50000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'commusoft:connection:00000000-0000-0000-0000-000000000100','501',
  '40000000-0000-4000-8000-000000000001',null);
insert into public.jobs values
 ('60000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '{"learn_business_input":{"source_version_id":"20000000-0000-4000-8000-000000000011"}}',
  'commusoft:connection:00000000-0000-0000-0000-000000000100','105',
  '50000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',null);
insert into public.learn_business_input_current_links values
 ('00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','105',
  'job','jobs','60000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000011');
insert into public.learn_business_input_pages values
 ('30000000-0000-4000-8000-000000000011',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','2026-10-06');
insert into public.learn_business_input_versions values
 ('20000000-0000-4000-8000-000000000011',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','105',
  '{"id":105,"status":"on_hold","propertyID":501}');
insert into public.learn_business_input_observations values
 ('30000000-0000-4000-8000-000000000011',
  '20000000-0000-4000-8000-000000000011',1);
do $check$ declare r jsonb; begin
 r:=public.new_dawn_customer_blockers(
  '00000000-0000-0000-0000-000000000001',null);
 if (r->>'linked_blocked_jobs')::int<>1 or jsonb_array_length(r->'groups')<>1
  or r->'groups'->0->>'customer_name'<>'Synthetic Company'
 then raise exception 'current_job_customer_group_missing'; end if;
end $check$;
insert into public.learn_business_input_pages values
 ('30000000-0000-4000-8000-000000000012',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','2026-10-06');
insert into public.learn_business_input_versions values
 ('20000000-0000-4000-8000-000000000012',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100','commusoft','jobs','105',
  '{"id":105,"status":"pending","propertyID":501}');
insert into public.learn_business_input_observations values
 ('30000000-0000-4000-8000-000000000012',
  '20000000-0000-4000-8000-000000000012',1);
do $check$ declare r jsonb; begin
 r:=public.new_dawn_customer_blockers(
  '00000000-0000-0000-0000-000000000001',null);
 if (r->>'linked_blocked_jobs')::int<>0 or jsonb_array_length(r->'groups')<>0
 then raise exception 'current_job_customer_conflict_exposed'; end if;
end $check$;
