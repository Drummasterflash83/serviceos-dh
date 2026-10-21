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
