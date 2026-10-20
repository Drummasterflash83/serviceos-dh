-- Run after the open-job-page bootstrap, base migration, the 170000 migration,
-- and new-dawn-open-job-page-synthetic.sql in an isolated PostgreSQL database.
-- The existing fixture has already checked tenant, actor, flag and audit guards.
set test.actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set test.role='authenticated';
update public.feature_flags set value='true'::jsonb
 where flag='new_dawn.open_job_page';
update public.learn_business_input_pages set committed_at='2026-10-18 05:00+00'
 where id='90000000-0000-4000-8000-000000000001';
insert into public.learn_business_input_pages
 (id,tenant_id,provider,collection,connection_id,committed_at) values
 ('90000000-0000-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111111','commusoft','jobs',
  '22222222-2222-4222-8222-222222222222','2026-10-20 05:00+00'),
 ('90000000-0000-4000-8000-000000000004',
  '11111111-1111-4111-8111-111111111111','commusoft','jobs',
  '22222222-2222-4222-8222-222222222222','2026-10-20 06:00+00');
insert into public.learn_business_input_versions
 (id,tenant_id,connection_id,provider,collection,external_id,payload) values
 ('30000000-0000-4000-8000-000000000041',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222','commusoft','jobs','40',
  '{"id":40,"status":"Open","propertyID":101}');
insert into public.learn_business_input_observations(page_id,version_id) values
 ('90000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000041'),
 ('90000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000040'),
 ('90000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000020');
do $$
declare pending jsonb; held jsonb;
begin
 pending:=public.new_dawn_open_job_page(
  '11111111-1111-4111-8111-111111111111',null,null,'pending',40);
 if pending->>'version'<>'new-dawn-open-job-page/2'
  or pending#>>'{rows,0,status_evidence}'<>'repeat_saved_checks'
  or (pending#>>'{rows,0,status_first_saved_at}')::timestamptz
   <>'2026-10-18 05:00+00'::timestamptz then
  raise exception 'repeat observation evidence failed %',pending;end if;
 held:=public.new_dawn_open_job_page(
  '11111111-1111-4111-8111-111111111111',null,null,'on_hold',40);
 if held#>>'{rows,0,status_evidence}'<>'timing_unknown'
  or (held#>>'{rows,0,status_first_saved_at}')::timestamptz
   <>'2026-10-20 06:00+00'::timestamptz then
  raise exception 'status change should reset observation run %',held;end if;
end $$;
