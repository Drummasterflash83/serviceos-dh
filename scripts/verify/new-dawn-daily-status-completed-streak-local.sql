\set ON_ERROR_STOP on
-- Run only in a disposable PostgreSQL database. The baseline harness creates
-- synthetic data and checks the original function before this replacement.
\i /project/scripts/verify/new-dawn-daily-status-coverage-local.sql
\i /project/supabase/migrations/20261111190000_new_dawn_daily_status_completed_streak.sql

truncate public.new_dawn_job_status_daily,public.new_dawn_job_status_daily_seeds;
insert into public.new_dawn_job_status_daily_seeds values
 ('11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333',
  (clock_timestamp() at time zone 'Europe/London')::date-1,326),
 ('11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333',
  (clock_timestamp() at time zone 'Europe/London')::date,330);
insert into public.new_dawn_job_status_daily
 select gen_random_uuid(),'11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333',
  (clock_timestamp() at time zone 'Europe/London')::date-1,
  'observed',clock_timestamp() from generate_series(1,326);
insert into public.new_dawn_job_status_daily
 select gen_random_uuid(),'11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333',
  (clock_timestamp() at time zone 'Europe/London')::date,
  case when n<=119 then 'observed' else 'pending' end,
  case when n<=119 then clock_timestamp() else null end
 from generate_series(1,330) n;

do $$ declare r jsonb;yesterday date:=(clock_timestamp() at time zone 'Europe/London')::date-1;
begin
 r:=public.new_dawn_daily_status_coverage('11111111-1111-4111-8111-111111111111');
 if (r->>'observed_count')::int<>119 or (r->>'roster_count')::int<>330
  or (r->>'qualifying_streak_days')::int<>1
  or (r->>'streak_start_day')::date<>yesterday
  or (r->>'earliest_moving_review_day')::date<>yesterday+14 then
  raise exception 'pending today lost completed streak: %',r;end if;
end $$;

update public.new_dawn_job_status_daily set state='observed',observed_at=clock_timestamp()
 where id in (select id from public.new_dawn_job_status_daily
  where observation_day=(clock_timestamp() at time zone 'Europe/London')::date
   and state='pending' order by id limit 208);
do $$ declare r jsonb;yesterday date:=(clock_timestamp() at time zone 'Europe/London')::date-1;
begin
 r:=public.new_dawn_daily_status_coverage('11111111-1111-4111-8111-111111111111');
 if (r->>'observed_count')::int<>327 or (r->>'missing_count')::int<>3
  or (r->>'qualifying_streak_days')::int<>2
  or (r->>'streak_start_day')::date<>yesterday then
  raise exception 'qualifying today did not extend streak: %',r;end if;
end $$;
select 'completed-streak local checks passed' result;
