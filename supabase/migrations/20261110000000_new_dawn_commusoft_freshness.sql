-- One daily, tenant-scoped, read-only Commusoft Jobs comparison. The worker
-- walks provider IDs from newest creation time to a saved source boundary.
-- Installation creates no run, flag, schedule or provider request.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table public.new_dawn_commusoft_freshness_runs (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 check_day date not null,
 connection_id uuid not null references public.provider_connections(id),
 connection_revision timestamptz not null,
 secret_id uuid not null,
 saved_id text,
 saved_created_at text,
 state text not null default 'collecting' check(state in('collecting','complete','partial')),
 cursor_id bigint,
 cursor_created_at timestamptz,
 page_count integer not null default 0 check(page_count between 0 and 200),
 seen_count integer not null default 0 check(seen_count between 0 and 20000),
 behind_count integer not null default 0 check(behind_count between 0 and 20000),
 newest_id text,
 newest_created_at text,
 provider_server_at timestamptz,
 claim_token uuid,
 claimed_at timestamptz,
 next_attempt_at timestamptz,
 failure_code text,
 failure_count integer not null default 0 check(failure_count between 0 and 8),
 checked_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,check_day)
);
create table public.new_dawn_commusoft_freshness_ids (
 run_id uuid not null references public.new_dawn_commusoft_freshness_runs(id),
 provider_id bigint not null,
 primary key(run_id,provider_id)
);
create index new_dawn_commusoft_freshness_recent
 on public.new_dawn_commusoft_freshness_runs(tenant_id,check_day desc);
alter table public.new_dawn_commusoft_freshness_runs enable row level security;
alter table public.new_dawn_commusoft_freshness_ids enable row level security;
revoke all on public.new_dawn_commusoft_freshness_runs,
 public.new_dawn_commusoft_freshness_ids from public,anon,authenticated,service_role;

create function public.new_dawn_commusoft_freshness_current(p_run uuid,p_claim uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_commusoft_freshness_runs%rowtype;
begin
 if auth.role() is distinct from 'service_role' or p_run is null or p_claim is null then return false;end if;
 select * into r from public.new_dawn_commusoft_freshness_runs where id=p_run
  and state='collecting' and claim_token=p_claim
  and claimed_at>clock_timestamp()-interval '40 seconds';
 if not found then return false;end if;
 perform 1 from public.tenants where id=r.tenant_id and status='active' for share;
 if not found then return false;end if;
 perform 1 from public.feature_flags where tenant_id=r.tenant_id and flag='new_dawn.commusoft_freshness'
  and value='true'::jsonb for share;
 if not found then return false;end if;
 perform 1 from public.feature_flags where tenant_id=r.tenant_id and flag='learn.enabled'
  and value='true'::jsonb for share;
 if not found then return false;end if;
 perform 1 from public.feature_flags where tenant_id=r.tenant_id and flag='learn.inputs.commusoft.enabled'
  and value='true'::jsonb for share;
 if not found then return false;end if;
 perform 1 from public.provider_connections c where c.id=r.connection_id and c.tenant_id=r.tenant_id
  and c.provider='commusoft' and c.status='configured' and c.auth_mode='private_api_key'
  and c.revoked_at is null and c.verified_at is not null and c.updated_at=r.connection_revision
  and c.secret_refs->>'api_key'=r.secret_id::text
  and c.non_secret_config->>'region' in('uk','us') for share;
 return found;
end $$;

create function public.new_dawn_commusoft_freshness_finish(
 p_run uuid,p_claim uuid,p_rows jsonb,p_has_more boolean,
 p_next_cursor bigint,p_server_time text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_commusoft_freshness_runs%rowtype;
 item jsonb;pid bigint;created text;prior timestamptz:='infinity';
 found_boundary boolean:=false;more integer:=0;seen integer:=0;
 next_state text;first_id text;first_created text;last_id bigint;
 audit uuid:=gen_random_uuid();
begin
 if auth.role() is distinct from 'service_role' or p_run is null or p_claim is null
  or p_rows is null or jsonb_typeof(p_rows) is distinct from 'array'
  or jsonb_array_length(p_rows)>100 or p_has_more is null
  or p_server_time is null or p_server_time!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
  or length(p_server_time)>80 then
  raise exception 'freshness_result_invalid' using errcode='22023';end if;
 select * into r from public.new_dawn_commusoft_freshness_runs where id=p_run for update;
 if not found or r.claim_token is distinct from p_claim
  or not public.new_dawn_commusoft_freshness_current(p_run,p_claim) then
  raise exception 'freshness_scope_changed' using errcode='42501';end if;
 if p_has_more and jsonb_array_length(p_rows)=0 then
  raise exception 'freshness_result_invalid' using errcode='22023';end if;
 if r.page_count>0 and (r.cursor_id is null or r.cursor_created_at is null)
  then raise exception 'freshness_result_invalid' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(item) is distinct from 'object'
   or item->>'id'!~'^[1-9][0-9]{0,15}$'
   or item->>'createdAt'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
   or length(item->>'createdAt')>80 then
   raise exception 'freshness_result_invalid' using errcode='22023';end if;
  pid:=(item->>'id')::bigint;created:=item->>'createdAt';
  if pid>9007199254740991 or created::timestamptz>prior
   or (r.cursor_created_at is not null and created::timestamptz>r.cursor_created_at)
   or created::timestamptz>p_server_time::timestamptz+interval '5 minutes'
   or pid=r.cursor_id then
   raise exception 'freshness_result_invalid' using errcode='22023';end if;
  prior:=created::timestamptz;last_id:=pid;
  if first_id is null then first_id:=pid::text;first_created:=created;end if;
  if not found_boundary then
   if pid::text=r.saved_id then found_boundary:=true;
   else
    insert into public.new_dawn_commusoft_freshness_ids(run_id,provider_id)
     values(r.id,pid);
    seen:=seen+1;
    if not exists(select 1 from public.learn_business_input_versions v
      where v.tenant_id=r.tenant_id and v.connection_id=r.connection_id
       and v.provider='commusoft' and v.collection='jobs'
       and v.external_id=pid::text) then more:=more+1;end if;
   end if;
  end if;
 end loop;
 if p_has_more and (p_next_cursor is null or p_next_cursor<>last_id) then
  raise exception 'freshness_result_invalid' using errcode='22023';end if;
 if not p_has_more and p_next_cursor is not null then
  raise exception 'freshness_result_invalid' using errcode='22023';end if;
 next_state:=case when found_boundary or (r.saved_id is null and not p_has_more)
  then 'complete' when not p_has_more or r.page_count>=199 then 'partial'
  else 'collecting' end;
 update public.new_dawn_commusoft_freshness_runs set
  state=next_state,page_count=r.page_count+1,seen_count=r.seen_count+seen,
  behind_count=r.behind_count+more,
  cursor_id=case when next_state='collecting' then p_next_cursor else null end,
  cursor_created_at=case when next_state='collecting' then prior else null end,
  newest_id=case when r.page_count=0 then first_id else r.newest_id end,
  newest_created_at=case when r.page_count=0 then first_created else r.newest_created_at end,
  provider_server_at=case when r.page_count=0 then p_server_time::timestamptz
   else r.provider_server_at end,
  claim_token=null,claimed_at=null,checked_at=case when next_state='collecting'
   then null else clock_timestamp() end,
  failure_code=case when next_state='partial'
   then case when r.page_count>=199 then 'scan_limit' else 'boundary_missing' end
   else null end,updated_at=clock_timestamp()
 where id=r.id;
 perform public.learn_commusoft_shared_lease_release('verification',
  r.id::text||':'||r.page_count::text);
 if next_state<>'collecting' then
  insert into public.controlplane_change_log
   (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
    correlation_id,view_as_active,source)
   values(audit,r.tenant_id,'platform-worker','learn.commusoft_freshness_observed',
    'commusoft_jobs',r.id::text,
    jsonb_build_object('state',next_state,'pages',r.page_count+1,
     'missing_jobs',r.behind_count+more,'saved_id',r.saved_id,
     'newest_id',coalesce(r.newest_id,first_id)),
    'Daily read-only Commusoft Jobs freshness',r.id::text,false,
    'new-dawn-commusoft-freshness');
 end if;
 return jsonb_build_object('state',next_state,'run_id',r.id,'pages',r.page_count+1);
end $$;

create function public.new_dawn_commusoft_freshness_fail(
 p_run uuid,p_claim uuid,p_code text
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_commusoft_freshness_runs%rowtype;
begin
 if auth.role() is distinct from 'service_role' or p_code not in(
  'authority_unavailable','transport_unavailable','provider_unavailable',
  'authentication_required','access_denied','rate_limited','response_too_large',
  'invalid_response','request_window_expired','result_unconfirmed') then
  raise exception 'freshness_failure_invalid' using errcode='22023';end if;
 select * into r from public.new_dawn_commusoft_freshness_runs where id=p_run for update;
 if not found or r.claim_token is distinct from p_claim or r.state<>'collecting' then return;end if;
 update public.new_dawn_commusoft_freshness_runs set
  claim_token=null,claimed_at=null,failure_code=p_code,
  failure_count=least(8,r.failure_count+1),
  next_attempt_at=clock_timestamp()+case when p_code in('authentication_required','access_denied')
   then interval '1 hour' else interval '15 minutes' end,
  updated_at=clock_timestamp() where id=r.id;
 perform public.learn_commusoft_shared_lease_release('verification',
  r.id::text||':'||r.page_count::text);
end $$;

create function public.new_dawn_commusoft_freshness_read(
 p_tenant uuid,p_operator_reason text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();operator_read boolean:=p_operator_reason is not null;
 r public.new_dawn_commusoft_freshness_runs%rowtype;as_of timestamptz:=clock_timestamp();
 audit uuid:=gen_random_uuid(); current_saved text;
begin
 if auth.role() is distinct from 'authenticated' or actor is null or p_tenant is null then
  raise exception 'freshness_read_forbidden' using errcode='42501';end if;
 perform 1 from auth.users u where u.id=actor and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=as_of) for share;
 if not found then raise exception 'freshness_read_forbidden' using errcode='42501';end if;
 if operator_read then
  if length(btrim(p_operator_reason)) not between 3 and 500 then
   raise exception 'freshness_read_invalid' using errcode='22023';end if;
  perform public.learn_operator_input_access(p_tenant,actor,true);
 else
  perform 1 from public.profiles p join public.tenants t on t.id=p.tenant_id
   where p.id=actor and p.tenant_id=p_tenant and p.role in('owner','admin')
    and t.status='active' for share of p,t;
  if not found or exists(select 1 from public.view_as_context v
    where v.actor_user_id=actor and v.ended_at is null
     and (v.expires_at is null or v.expires_at>as_of))
   or exists(select 1 from public.platform_authority_grants g
    where g.profile_id=actor and g.permission in(
     'platform.controlplane.view','platform.controlplane.admin')
     and coalesce(g.effective_from,'-infinity')<=as_of
     and coalesce(g.effective_to,'infinity')>as_of) then
   raise exception 'freshness_read_forbidden' using errcode='42501';end if;
 end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag=case when operator_read then 'new_dawn.learn_daily_stats.operator_preview'
   else 'new_dawn.learn_daily_stats' end and value='true'::jsonb for share;
 if not found then raise exception 'freshness_read_disabled' using errcode='42501';end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.commusoft_freshness' and value='true'::jsonb for share;
 if not found then raise exception 'freshness_read_disabled' using errcode='42501';end if;
 select * into r from public.new_dawn_commusoft_freshness_runs
  where tenant_id=p_tenant order by check_day desc limit 1;
 if found then
  select v.external_id into current_saved from public.learn_business_input_versions v
   where v.tenant_id=p_tenant and v.connection_id=r.connection_id
    and v.provider='commusoft' and v.collection='jobs'
    and v.external_id~'^[1-9][0-9]{0,15}$'
    and v.payload->>'createdOnDateTime'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
   order by v.payload->>'createdOnDateTime' desc,v.external_id::numeric desc limit 1;
 end if;
 if operator_read then perform public.learn_operator_input_access(p_tenant,actor,true);end if;
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'learn.commusoft_freshness_read','commusoft_jobs',
  p_tenant::text,jsonb_build_object('run_id',r.id,'as_of',as_of),
  case when operator_read then btrim(p_operator_reason)
   else 'Client Commusoft freshness summary' end,audit::text,false,
  'new-dawn-commusoft-freshness');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-commusoft-freshness/1',
  'tenant_id',p_tenant,'actor_id',actor,'audit_id',audit,'observed_at',as_of,
  'state',case when r.id is null then 'not_checked'
   when r.state='complete' and r.saved_id is distinct from current_saved then 'saved_advanced'
   when r.state='complete' and (r.check_day<>(as_of at time zone 'Europe/London')::date
    or r.checked_at<as_of-interval '24 hours') then 'stale'
   else r.state end,
  'saved_job_id',r.saved_id,'provider_newest_job_id',r.newest_id,
  'provider_checked_at',r.checked_at,
  'jobs_behind',case when r.state='complete' and
   r.saved_id is not distinct from current_saved and
   r.check_day=(as_of at time zone 'Europe/London')::date and
   r.checked_at>=as_of-interval '24 hours' then r.behind_count else null end,
  'at_least_behind',case when r.state='partial' then r.behind_count else null end,
  'scope','provider_jobs_created_descending');
end $$;

create function public.new_dawn_commusoft_freshness_claim()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.provider_connections%rowtype;r public.new_dawn_commusoft_freshness_runs%rowtype;
 today date:=(clock_timestamp() at time zone 'Europe/London')::date;
 latest_id text;latest_created text;secret text;fingerprint text;lease jsonb;
 owner text;claim uuid;
begin
 if auth.role() is distinct from 'service_role'
  or current_setting('transaction_isolation')<>'read committed' then
  raise exception 'freshness_forbidden' using errcode='42501';end if;
 select pc.* into c from public.provider_connections pc join public.tenants t
  on t.id=pc.tenant_id and t.status='active'
 where pc.provider='commusoft' and pc.status='configured'
  and pc.auth_mode='private_api_key' and pc.revoked_at is null and pc.verified_at is not null
  and pc.non_secret_config->>'region' in('uk','us')
  and coalesce(pc.secret_refs->>'api_key','')~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  and exists(select 1 from public.feature_flags f where f.tenant_id=pc.tenant_id
   and f.flag='new_dawn.commusoft_freshness' and f.value='true'::jsonb)
  and exists(select 1 from public.feature_flags f where f.tenant_id=pc.tenant_id
   and f.flag='learn.enabled' and f.value='true'::jsonb)
  and exists(select 1 from public.feature_flags f where f.tenant_id=pc.tenant_id
   and f.flag='learn.inputs.commusoft.enabled' and f.value='true'::jsonb)
  and not exists(select 1 from public.new_dawn_commusoft_freshness_runs done
   where done.tenant_id=pc.tenant_id and done.check_day=today
    and done.state in('complete','partial'))
 order by pc.tenant_id limit 1 for share of pc;
 if not found then return jsonb_build_object('state','idle');end if;
 select * into r from public.new_dawn_commusoft_freshness_runs
  where tenant_id=c.tenant_id and check_day=today for update;
 if not found then
  select v.external_id,v.payload->>'createdOnDateTime'
   into latest_id,latest_created
   from public.learn_business_input_versions v
   where v.tenant_id=c.tenant_id and v.connection_id=c.id and v.provider='commusoft'
    and v.collection='jobs' and v.external_id~'^[1-9][0-9]{0,15}$'
    and v.payload->>'createdOnDateTime'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
   order by v.payload->>'createdOnDateTime' desc,v.external_id::numeric desc limit 1;
  insert into public.new_dawn_commusoft_freshness_runs
   (tenant_id,check_day,connection_id,connection_revision,secret_id,saved_id,saved_created_at)
   values(c.tenant_id,today,c.id,c.updated_at,(c.secret_refs->>'api_key')::uuid,
    latest_id,latest_created) on conflict(tenant_id,check_day) do nothing;
  select * into r from public.new_dawn_commusoft_freshness_runs
   where tenant_id=c.tenant_id and check_day=today for update;
 end if;
 if r.state<>'collecting' then return jsonb_build_object('state','idle');end if;
 if r.connection_id is distinct from c.id or r.connection_revision is distinct from c.updated_at
  or r.secret_id::text is distinct from c.secret_refs->>'api_key' then
  return jsonb_build_object('state','held');end if;
 if r.failure_count>=8 then return jsonb_build_object('state','held');end if;
 if r.claimed_at>clock_timestamp()-interval '40 seconds'
  or r.next_attempt_at>clock_timestamp() then
  return jsonb_build_object('state','waiting');end if;
 select decrypted_secret into secret from vault.decrypted_secrets
  where id=r.secret_id and name='provider_secret:'||r.tenant_id::text||':commusoft:api_key';
 if secret is null or length(secret) not between 1 and 4096 or secret!~'^[!-~]+$' then
  return jsonb_build_object('state','held');end if;
 fingerprint:=encode(sha256(convert_to('commusoft:'||secret,'UTF8')),'hex');
 owner:=r.id::text||':'||r.page_count::text;
 lease:=public.learn_commusoft_shared_lease_acquire(fingerprint,'verification',owner);
 if lease->>'state'='wait' then return jsonb_build_object('state','waiting');end if;
 if lease->>'state'<>'ready' then return jsonb_build_object('state','held');end if;
 claim:=gen_random_uuid();
 update public.new_dawn_commusoft_freshness_runs set claim_token=claim,
  claimed_at=clock_timestamp(),updated_at=clock_timestamp(),next_attempt_at=null
  where id=r.id;
 if not public.new_dawn_commusoft_freshness_current(r.id,claim) then
  raise exception 'freshness_scope_changed' using errcode='42501';end if;
 return jsonb_build_object('state','ready','run_id',r.id,'claim_token',claim,
  'tenant_id',r.tenant_id,'after',r.cursor_id,'region',c.non_secret_config->>'region',
  'api_key',secret,'send_before',ceil(extract(epoch from clock_timestamp()+interval '5 seconds')*1000)::bigint);
end $$;
revoke all on function public.new_dawn_commusoft_freshness_current(uuid,uuid),
 public.new_dawn_commusoft_freshness_claim(),
 public.new_dawn_commusoft_freshness_finish(uuid,uuid,jsonb,boolean,bigint,text),
 public.new_dawn_commusoft_freshness_fail(uuid,uuid,text),
 public.new_dawn_commusoft_freshness_read(uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.new_dawn_commusoft_freshness_current(uuid,uuid),
 public.new_dawn_commusoft_freshness_claim(),
 public.new_dawn_commusoft_freshness_finish(uuid,uuid,jsonb,boolean,bigint,text),
 public.new_dawn_commusoft_freshness_fail(uuid,uuid,text) to service_role;
grant execute on function public.new_dawn_commusoft_freshness_read(uuid,text)
 to authenticated;
commit;
