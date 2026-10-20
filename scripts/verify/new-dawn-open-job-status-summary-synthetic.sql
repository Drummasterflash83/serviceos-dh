-- Run after the open-job-page bootstrap, migration and synthetic fixture.
-- The fixture already created an equal-time conflicting new version for job 10.
update public.feature_flags set value='true'::jsonb
where tenant_id='11111111-1111-4111-8111-111111111111'
 and flag='new_dawn.open_job_page';
set test.actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set test.role='authenticated';
do $$
declare client jsonb; operator_result jsonb;
begin
 client:=public.new_dawn_open_job_status_summary(
  '11111111-1111-4111-8111-111111111111');
 if client#>>'{counts,on_hold}'<>'1' or client#>>'{counts,pending}'<>'1'
  or client#>>'{counts,open}'<>'0' or client#>>'{counts,total}'<>'2'
  then raise exception 'status summary did not exclude conflicted/closed jobs: %',client;end if;
 if client->>'actor_id'<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  or client->>'audit_id' is null
  or (select count(*) from public.controlplane_change_log
   where action='client_jobs.status_summary_read')<>1
  then raise exception 'client status summary audit missing';end if;
 operator_result:=public.new_dawn_open_job_status_summary(
  '11111111-1111-4111-8111-111111111111','Review saved job status');
 if operator_result->'counts' is distinct from client->'counts'
  or (select count(*) from public.controlplane_change_log
   where action='client_jobs.status_summary_preview')<>1
  then raise exception 'operator status summary mismatch or audit missing';end if;
end $$;
do $$
begin
 begin
  perform public.new_dawn_open_job_status_summary(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  raise exception 'wrong tenant passed';
 exception when insufficient_privilege then null;end;
end $$;
insert into public.view_as_context(actor_user_id,ended_at,expires_at)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,clock_timestamp()+interval '10 minutes');
do $$
begin
 begin
  perform public.new_dawn_open_job_status_summary(
   '11111111-1111-4111-8111-111111111111');
  raise exception 'active View As passed client access';
 exception when insufficient_privilege then null;end;
end $$;
delete from public.view_as_context where actor_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.feature_flags set value='false'::jsonb
where tenant_id='11111111-1111-4111-8111-111111111111'
 and flag='new_dawn.open_job_page';
do $$
begin
 begin
  perform public.new_dawn_open_job_status_summary(
   '11111111-1111-4111-8111-111111111111');
  raise exception 'disabled flag passed';
 exception when insufficient_privilege then null;end;
end $$;
