\set ON_ERROR_STOP on
-- Run only in a disposable PostgreSQL database, then include the migration.
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$
 select nullif(current_setting('request.jwt.claim.role',true),'') $$;
create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
create table public.tenants(id uuid primary key,status text);
create table public.profiles(id uuid primary key,tenant_id uuid,role text);
create table public.feature_flags(tenant_id uuid,flag text,value jsonb);
create table public.view_as_context(actor_user_id uuid,ended_at timestamptz,expires_at timestamptz);
create table public.platform_authority_grants(profile_id uuid,permission text,
 effective_from timestamptz,effective_to timestamptz);
create table public.new_dawn_job_status_daily_seeds(tenant_id uuid,connection_id uuid,
 observation_day date,candidate_count integer);
create table public.new_dawn_job_status_daily(id uuid,tenant_id uuid,connection_id uuid,
 observation_day date,state text,observed_at timestamptz);
create table public.controlplane_change_log(id uuid,tenant_id uuid,actor text,action text,
 resource_type text,resource_id text,after jsonb,reason text,correlation_id text,
 view_as_active boolean,source text);
create function public.learn_operator_input_access(uuid,uuid,boolean)
 returns void language plpgsql as $$ begin raise exception 'operator denied'; end $$;

\i /tmp/new-dawn-daily-status-coverage-home.sql

insert into auth.users(id) values('22222222-2222-4222-8222-222222222222');
insert into public.tenants values('11111111-1111-4111-8111-111111111111','active');
insert into public.profiles values('22222222-2222-4222-8222-222222222222',
 '11111111-1111-4111-8111-111111111111','owner');
insert into public.feature_flags values('11111111-1111-4111-8111-111111111111',
 'new_dawn.open_job_page','true');
insert into public.new_dawn_job_status_daily_seeds values(
 '11111111-1111-4111-8111-111111111111',
 '33333333-3333-4333-8333-333333333333','2026-10-20',326);
insert into public.new_dawn_job_status_daily
 select gen_random_uuid(),'11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333','2026-10-20','observed',
  '2026-10-20 20:49:01+00'::timestamptz from generate_series(1,326);
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select set_config('request.jwt.claim.role','authenticated',false);

do $$ declare r jsonb;begin
 r:=public.new_dawn_daily_status_coverage('11111111-1111-4111-8111-111111111111');
 if (r->>'observed_count')::int<>326 or (r->>'missing_count')::int<>0
  or (r->>'qualifying_streak_days')::int<>1
  or r->>'earliest_moving_review_day'<>'2026-11-03' then
  raise exception 'complete day failed: %',r;end if;
end $$;
update public.new_dawn_job_status_daily set state='retry',observed_at=null
 where id in (select id from public.new_dawn_job_status_daily order by id limit 3);
do $$ declare r jsonb;begin
 r:=public.new_dawn_daily_status_coverage('11111111-1111-4111-8111-111111111111');
 if (r->>'observed_count')::int<>323 or (r->>'missing_count')::int<>3
  or (r->>'qualifying_streak_days')::int<>1 then
  raise exception '99 percent day failed: %',r;end if;
end $$;
update public.new_dawn_job_status_daily set state='retry',observed_at=null
 where id in (select id from public.new_dawn_job_status_daily
  where state='observed' order by id limit 1);
do $$ declare r jsonb;begin
 r:=public.new_dawn_daily_status_coverage('11111111-1111-4111-8111-111111111111');
 if (r->>'observed_count')::int<>322 or (r->>'missing_count')::int<>4
  or (r->>'qualifying_streak_days')::int<>0
  or r->>'earliest_moving_review_day' is not null then
  raise exception 'below threshold day failed: %',r;end if;
end $$;

do $$ begin
 begin
  perform public.new_dawn_daily_status_coverage('44444444-4444-4444-8444-444444444444');
  raise exception 'cross tenant read was not denied';
 exception when sqlstate '42501' then null;end;
end $$;
select 'daily status coverage local checks passed' result;
