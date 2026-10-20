-- Run only in a disposable database after the daily-stats bootstrap, base and
-- split migrations, their existing tests, and the newest-job migration.
-- A later committed revision of job 1 must not displace newer source job 2.
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';

update public.learn_business_input_versions
  set external_id = '1',
    payload = jsonb_set(payload, '{createdOnDateTime}',
      '"2026-10-19T08:00:00Z"'::jsonb)
  where tenant_id = '00000000-0000-0000-0000-000000000001'
    and collection = 'jobs' and external_id = '001';
update public.learn_business_input_versions
  set external_id = '2',
    payload = jsonb_set(payload, '{createdOnDateTime}',
      '"2026-10-20T09:00:00Z"'::jsonb)
  where tenant_id = '00000000-0000-0000-0000-000000000001'
    and collection = 'jobs' and external_id = '002';
insert into public.learn_business_input_versions values
  ('00000000-0000-0000-0000-000000000107',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000099',
   'commusoft', 'jobs', '1', now(),
   '{"id":1,"status":"Complete","createdOnDateTime":"2026-10-19T08:00:00Z"}');
insert into public.learn_business_input_pages values
  ('00000000-0000-0000-0000-000000000204',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000099',
   'commusoft', 'jobs', now());
insert into public.learn_business_input_observations values
  ('00000000-0000-0000-0000-000000000204',
   '00000000-0000-0000-0000-000000000107', 1);

do $$
declare r jsonb; expected_seen timestamptz;
begin
  select min(first_seen_at) into expected_seen
    from public.learn_business_input_versions
    where tenant_id = '00000000-0000-0000-0000-000000000001'
      and collection = 'jobs' and external_id = '2';
  r := public.new_dawn_learn_daily_stats_part(
    '00000000-0000-0000-0000-000000000001', 'business');
  if r#>>'{latest_saved_job,number}' <> '2'
    or (r#>>'{latest_saved_job,saved_at}')::timestamptz <> expected_seen
    or r#>>'{counts,jobs,total}' <> '2'
    or r#>>'{counts,jobs,today}' <> '1'
  then raise exception 'newest_job_order_failed: %', r; end if;
end $$;
