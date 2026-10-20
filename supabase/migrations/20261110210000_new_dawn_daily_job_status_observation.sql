-- A separate, provider-observed status ledger. Saved input-page timestamps are
-- deliberately not substituted for a daily provider observation. Installation
-- creates no flag, request, timer, provider call or client-visible score.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table public.new_dawn_job_status_daily (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 connection_id uuid not null references public.provider_connections(id),
 external_id text not null check (external_id ~ '^[1-9][0-9]{0,15}$'),
 observation_day date not null,
 source_version_id uuid not null references public.learn_business_input_versions(id),
 saved_status text not null check (saved_status in ('open','pending','on_hold')),
 connection_revision timestamptz not null,
 secret_id uuid not null,
 state text not null default 'pending' check (state in ('pending','claimed','retry','observed')),
 attempt_count integer not null default 0 check (attempt_count between 0 and 8),
 claim_token uuid,
 claimed_at timestamptz,
 next_attempt_at timestamptz,
 failure_code text,
 provider_status text check (provider_status is null or length(provider_status) between 1 and 120),
 status text check (status is null or status in ('open','pending','on_hold','other')),
 provider_updated_at timestamptz,
 raw_sha256 text check (raw_sha256 is null or raw_sha256 ~ '^[0-9a-f]{64}$'),
 observed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique (tenant_id,connection_id,external_id,observation_day),
 constraint observed_status_complete check (
  (state='observed' and status is not null and provider_status is not null
   and raw_sha256 is not null and observed_at is not null and claim_token is null)
  or (state<>'observed' and status is null and provider_status is null
   and raw_sha256 is null and observed_at is null))
);
create index new_dawn_job_status_daily_coverage
 on public.new_dawn_job_status_daily(tenant_id,observation_day,status);
alter table public.new_dawn_job_status_daily enable row level security;
revoke all on public.new_dawn_job_status_daily from public,anon,authenticated,service_role;

create function public.new_dawn_job_status_daily_retain()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op in ('DELETE','TRUNCATE') or old.state='observed' then
  raise exception 'job_status_observation_immutable' using errcode='55000';end if;
 return new;
end $$;
create trigger new_dawn_job_status_daily_retain_row
 before update or delete on public.new_dawn_job_status_daily
 for each row execute function public.new_dawn_job_status_daily_retain();
create trigger new_dawn_job_status_daily_retain_all
 before truncate on public.new_dawn_job_status_daily
 for each statement execute function public.new_dawn_job_status_daily_retain();
revoke all on function public.new_dawn_job_status_daily_retain()
 from public,anon,authenticated,service_role;

create function public.new_dawn_job_status_daily_current(p_id uuid,p_token uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_job_status_daily%rowtype;
 c public.provider_connections%rowtype;v public.learn_business_input_versions%rowtype;
begin
 if auth.role() is distinct from 'service_role' or p_id is null or p_token is null then
  return false;end if;
 select * into r from public.new_dawn_job_status_daily where id=p_id
  and state='claimed' and claim_token=p_token
  and claimed_at>clock_timestamp()-interval '40 seconds';
 if not found then return false;end if;
 perform 1 from public.tenants where id=r.tenant_id and status='active' for share;
 if not found then return false;end if;
 perform 1 from public.feature_flags where tenant_id=r.tenant_id
  and flag='new_dawn.daily_job_status.enabled' and value='true'::jsonb for share;
 if not found then return false;end if;
 perform 1 from public.feature_flags where tenant_id=r.tenant_id
  and flag='learn.enabled' and value='true'::jsonb for share;
 if not found then return false;end if;
 perform 1 from public.feature_flags where tenant_id=r.tenant_id
  and flag='learn.inputs.commusoft.enabled' and value='true'::jsonb for share;
 if not found then return false;end if;
 select * into c from public.provider_connections where id=r.connection_id
  and tenant_id=r.tenant_id and provider='commusoft' and status='configured'
  and auth_mode='private_api_key' and revoked_at is null and verified_at is not null
  and updated_at=r.connection_revision and secret_refs->>'api_key'=r.secret_id::text
  and non_secret_config->>'region' in ('uk','us') for share;
 if not found then return false;end if;
 v:=public.learn_business_input_latest(r.tenant_id,r.connection_id,'commusoft','jobs',r.external_id);
 return v.id is not distinct from r.source_version_id
  and v.payload->>'id'=r.external_id
  and (case v.payload->>'status' when 'Open' then 'open' when 'ongoing' then 'open'
   when 'pending' then 'pending' when 'on_hold' then 'on_hold' end)=r.saved_status;
end $$;

create function public.new_dawn_job_status_daily_claim()
returns jsonb language plpgsql security definer set search_path=pg_catalog
 set statement_timeout='20s' as $$
declare item record;r public.new_dawn_job_status_daily%rowtype;
 day date:=(clock_timestamp() at time zone 'Europe/London')::date;
 secret text;fingerprint text;lease jsonb;token uuid;
begin
 if auth.role() is distinct from 'service_role'
  or current_setting('transaction_isolation')<>'read committed' then
  raise exception 'job_status_daily_forbidden' using errcode='42501';end if;
 -- A single scheduler tick claims one job. The advisory lock prevents two
 -- concurrent ticks selecting the same first candidate before its row exists.
 if not pg_try_advisory_xact_lock(hashtextextended('new-dawn-job-status-daily',0)) then
  return jsonb_build_object('state','waiting');end if;
 select x.tenant_id,x.connection_id,x.external_id,x.version_id,x.saved_status,
  x.connection_revision,x.secret_id,x.region into item
 from (
  with latest_time as materialized (
   select v.tenant_id,v.connection_id,v.external_id,max(pg.committed_at) observed_at
   from public.learn_business_input_versions v
   join public.learn_business_input_observations o on o.version_id=v.id
   join public.learn_business_input_pages pg on pg.id=o.page_id
    and pg.tenant_id=v.tenant_id and pg.connection_id=v.connection_id
    and pg.provider=v.provider and pg.collection=v.collection
   where v.provider='commusoft' and v.collection='jobs'
   group by v.tenant_id,v.connection_id,v.external_id
  ), unique_latest as materialized (
   select t.tenant_id,t.connection_id,t.external_id,t.observed_at,
    min(v.id::text)::uuid version_id
   from latest_time t
   join public.learn_business_input_versions v on v.tenant_id=t.tenant_id
    and v.connection_id=t.connection_id and v.provider='commusoft'
    and v.collection='jobs' and v.external_id=t.external_id
   join public.learn_business_input_observations o on o.version_id=v.id
   join public.learn_business_input_pages pg on pg.id=o.page_id
    and pg.tenant_id=t.tenant_id and pg.connection_id=t.connection_id
    and pg.provider='commusoft' and pg.collection='jobs'
    and pg.committed_at=t.observed_at
   group by t.tenant_id,t.connection_id,t.external_id,t.observed_at
   having count(distinct v.id)=1
  )
  select u.tenant_id,u.connection_id,u.external_id,u.version_id,
   case v.payload->>'status' when 'Open' then 'open' when 'ongoing' then 'open'
    when 'pending' then 'pending' when 'on_hold' then 'on_hold' end saved_status,
   c.updated_at connection_revision,(c.secret_refs->>'api_key')::uuid secret_id,
   c.non_secret_config->>'region' region
  from unique_latest u
  join public.learn_business_input_versions v on v.id=u.version_id
   and v.tenant_id=u.tenant_id and v.connection_id=u.connection_id
  join public.provider_connections c on c.id=u.connection_id
   and c.tenant_id=u.tenant_id and c.provider='commusoft'
   and c.status='configured' and c.auth_mode='private_api_key'
   and c.revoked_at is null and c.verified_at is not null
   and c.non_secret_config->>'region' in ('uk','us')
   and coalesce(c.secret_refs->>'api_key','')~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  join public.tenants t on t.id=u.tenant_id and t.status='active'
  left join public.new_dawn_job_status_daily d on d.tenant_id=u.tenant_id
   and d.connection_id=u.connection_id and d.external_id=u.external_id
   and d.observation_day=day
  where v.payload->>'id'=u.external_id
   and u.external_id~'^[1-9][0-9]{0,15}$'
   and case when u.external_id~'^[1-9][0-9]{0,15}$'
    then u.external_id::numeric<=9007199254740991 else false end
   and v.payload->>'status' in ('Open','ongoing','pending','on_hold')
   and exists(select 1 from public.feature_flags f where f.tenant_id=u.tenant_id
    and f.flag='new_dawn.daily_job_status.enabled' and f.value='true'::jsonb)
   and exists(select 1 from public.feature_flags f where f.tenant_id=u.tenant_id
    and f.flag='learn.enabled' and f.value='true'::jsonb)
   and exists(select 1 from public.feature_flags f where f.tenant_id=u.tenant_id
    and f.flag='learn.inputs.commusoft.enabled' and f.value='true'::jsonb)
   and (d.id is null or (d.attempt_count<8 and
    (d.state in ('pending','retry') and coalesce(d.next_attempt_at,'-infinity')<=clock_timestamp()
     or d.state='claimed' and d.claimed_at<=clock_timestamp()-interval '40 seconds')))
  order by case v.payload->>'status' when 'on_hold' then 0
   when 'pending' then 1 else 2 end,u.external_id collate "C"
  limit 1
 ) x;
 if not found then return jsonb_build_object('state','idle');end if;
 insert into public.new_dawn_job_status_daily
  (tenant_id,connection_id,external_id,observation_day,source_version_id,
   saved_status,connection_revision,secret_id)
 values(item.tenant_id,item.connection_id,item.external_id,day,item.version_id,
  item.saved_status,item.connection_revision,item.secret_id)
 on conflict (tenant_id,connection_id,external_id,observation_day) do nothing;
 select * into r from public.new_dawn_job_status_daily
  where tenant_id=item.tenant_id and connection_id=item.connection_id
   and external_id=item.external_id and observation_day=day for update;
 if r.state='observed' or r.attempt_count>=8 then
  return jsonb_build_object('state','idle');end if;
 select decrypted_secret into secret from vault.decrypted_secrets
  where id=item.secret_id and name='provider_secret:'||item.tenant_id::text||':commusoft:api_key';
 if secret is null or length(secret) not between 1 and 4096 or secret!~'^[!-~]+$' then
  return jsonb_build_object('state','held');end if;
 fingerprint:=encode(sha256(convert_to('commusoft:'||secret,'UTF8')),'hex');
 lease:=public.learn_commusoft_shared_lease_acquire(fingerprint,'verification',r.id::text);
 if lease->>'state'='wait' then return jsonb_build_object('state','waiting');end if;
 if lease->>'state'<>'ready' then return jsonb_build_object('state','held');end if;
 token:=gen_random_uuid();
 update public.new_dawn_job_status_daily set source_version_id=item.version_id,
  saved_status=item.saved_status,connection_revision=item.connection_revision,
  secret_id=item.secret_id,state='claimed',attempt_count=attempt_count+1,
  claim_token=token,claimed_at=clock_timestamp(),next_attempt_at=null,
  failure_code=null,updated_at=clock_timestamp() where id=r.id;
 if not public.new_dawn_job_status_daily_current(r.id,token) then
  raise exception 'job_status_daily_scope_changed' using errcode='42501';end if;
 return jsonb_build_object('state','ready','id',r.id,'claim_token',token,
  'external_id',r.external_id,'region',item.region,'api_key',secret,
  'send_before',ceil(extract(epoch from clock_timestamp()+interval '5 seconds')*1000)::bigint);
end $$;

create function public.new_dawn_job_status_daily_finish(
 p_id uuid,p_token uuid,p_external text,p_status text,
 p_provider_updated text,p_sha256 text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_job_status_daily%rowtype;normalized text;audit uuid:=gen_random_uuid();
begin
 if auth.role() is distinct from 'service_role' or p_status is null
  or length(p_status) not between 1 and 120 or p_status !~ '^[[:print:]]+$'
  or p_sha256 !~ '^[0-9a-f]{64}$' or p_external !~ '^[1-9][0-9]{0,15}$'
  or (p_provider_updated is not null and
   (length(p_provider_updated)>80 or
    not pg_input_is_valid(p_provider_updated,'timestamptz'))) then
  raise exception 'job_status_daily_result_invalid' using errcode='22023';end if;
 select * into r from public.new_dawn_job_status_daily where id=p_id for update;
 if not found or r.external_id<>p_external
  or not public.new_dawn_job_status_daily_current(p_id,p_token) then
  raise exception 'job_status_daily_scope_changed' using errcode='42501';end if;
 normalized:=case p_status when 'Open' then 'open' when 'ongoing' then 'open'
  when 'pending' then 'pending' when 'on_hold' then 'on_hold' else 'other' end;
 update public.new_dawn_job_status_daily set state='observed',claim_token=null,
  provider_status=p_status,status=normalized,
  provider_updated_at=p_provider_updated::timestamptz,raw_sha256=p_sha256,
  observed_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
 perform public.learn_commusoft_shared_lease_release('verification',r.id::text);
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit,r.tenant_id,'platform-worker','client_jobs.daily_status_observed',
  'commusoft_jobs',r.external_id,
  jsonb_build_object('observation_id',r.id,'day',r.observation_day,
   'source_version_id',r.source_version_id,'saved_status',r.saved_status,
   'provider_status',normalized,'checked_at',clock_timestamp()),
  'Read-only daily Commusoft job status',r.id::text,false,'new-dawn-daily-job-status');
 return jsonb_build_object('state','observed','id',r.id,'day',r.observation_day,
  'status',normalized);
end $$;

create function public.new_dawn_job_status_daily_fail(
 p_id uuid,p_token uuid,p_code text
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_job_status_daily%rowtype;
begin
 if auth.role() is distinct from 'service_role' or p_code not in
  ('scope_changed','authentication_required','access_denied','rate_limited',
   'provider_unavailable','response_too_large','response_invalid',
   'transport_unavailable','result_unconfirmed','request_window_expired') then
  raise exception 'job_status_daily_failure_invalid' using errcode='22023';end if;
 select * into r from public.new_dawn_job_status_daily where id=p_id for update;
 if not found or r.state<>'claimed' or r.claim_token is distinct from p_token then return;end if;
 update public.new_dawn_job_status_daily set state='retry',claim_token=null,
  claimed_at=null,failure_code=p_code,
  next_attempt_at=clock_timestamp()+case when p_code in
   ('authentication_required','access_denied') then interval '1 hour'
    else interval '15 minutes' end,updated_at=clock_timestamp()
 where id=r.id;
 perform public.learn_commusoft_shared_lease_release('verification',r.id::text);
end $$;

revoke all on function public.new_dawn_job_status_daily_current(uuid,uuid),
 public.new_dawn_job_status_daily_claim(),
 public.new_dawn_job_status_daily_finish(uuid,uuid,text,text,text,text),
 public.new_dawn_job_status_daily_fail(uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.new_dawn_job_status_daily_current(uuid,uuid),
 public.new_dawn_job_status_daily_claim(),
 public.new_dawn_job_status_daily_finish(uuid,uuid,text,text,text,text),
 public.new_dawn_job_status_daily_fail(uuid,uuid,text) to service_role;
commit;
