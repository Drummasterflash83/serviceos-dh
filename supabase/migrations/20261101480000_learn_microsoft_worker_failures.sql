-- Microsoft worker failures and pause deferral are owned, atomic queue outcomes.
-- No new jobs, credentials or schedules are seeded.
begin;
create table public.learn_microsoft_job_stops (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.platform_jobs(id),
 tenant_id uuid not null, worker text not null, attempt integer not null,
 lease_end timestamptz not null, definition jsonb not null, request jsonb not null,
 result jsonb not null, recorded_at timestamptz not null default clock_timestamp(),
 unique(job_id,worker,attempt,lease_end)
);
alter table public.learn_microsoft_job_stops enable row level security;
revoke all on public.learn_microsoft_job_stops from public,anon,authenticated,service_role;
create trigger learn_microsoft_stops_immutable before update or delete on public.learn_microsoft_job_stops
 for each row execute function public.learn_microsoft_journal_immutable();
create trigger learn_microsoft_stops_no_truncate before truncate on public.learn_microsoft_job_stops
 for each statement execute function public.learn_microsoft_journal_immutable();

create function public.learn_microsoft_job_stop(p_tenant uuid,p_job uuid,p_worker text,p_claim integer,p_code text,p_retry_after integer default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;prior public.learn_microsoft_job_stops%rowtype;
 definition jsonb;request jsonb;answer jsonb;owned jsonb;outcome text;code text;delay integer;
 due timestamptz;new_attempt integer;at_time timestamptz;paused boolean;retryable boolean;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'learn_microsoft_stop_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' or p_tenant is null or p_job is null
  or nullif(p_worker,'') is null or length(p_worker)>256 or p_claim is null or p_claim<1
  or p_code is null or p_code not in ('invalid_scope','invalid_continuation','fetch_failed','invalid_response','response_too_large',
   'auth_required','access_denied','folder_unavailable','delta_expired','throttled','provider_unavailable','pagination_no_progress',
   'invalid_discovery_state','hierarchy_conflict','discovery_limit','credential_unavailable','refresh_failed',
   'reauthorization_required','capture_unconfirmed','retry_delay_requires_review')
  or (p_retry_after is not null and (p_retry_after<0 or p_retry_after>31536000))
 then raise exception 'learn_microsoft_stop_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found or j.job_type not in ('email.microsoft_discovery','email.microsoft_sync')
  or j.connector_id is distinct from 'microsoft-365' or j.module_id is distinct from 'communications.email'
 then raise exception 'learn_microsoft_stop_identity_invalid' using errcode='PT409';end if;
 definition:=jsonb_build_object('tenant_id',j.tenant_id,'connector_id',j.connector_id,'module_id',j.module_id,
  'job_type',j.job_type,'job_key',j.job_key,'payload',j.payload);
 request:=jsonb_build_object('code',p_code,'retry_after',p_retry_after);
 if j.status<>'running' then
  select * into prior from public.learn_microsoft_job_stops where job_id=p_job and tenant_id=p_tenant
   and worker=p_worker and attempt=p_claim order by recorded_at desc limit 1;
  if found and prior.definition=definition and prior.request=request and j.result=prior.result
   and j.attempt_count=(prior.result->>'attemptCount')::integer
   and j.status=(case prior.result->>'state' when 'waiting' then 'queued' when 'retrying' then 'retrying' else 'dead_letter' end)
  then return prior.result||jsonb_build_object('historicalReceipt',true);end if;
  -- A late worker may never turn a completed or newly claimed job into failure.
  raise exception 'learn_microsoft_stop_claim_lost' using errcode='PT409';
 end if;
 owned:=public.learn_microsoft_journal_job(p_tenant,p_job,p_worker,p_claim);
 if j.job_key is distinct from j.job_type||':'||(j.payload->>'binding_id')||':'||(j.payload->>'folder_id')
 then raise exception 'learn_microsoft_stop_identity_invalid' using errcode='PT409';end if;
 if owned->'receipt' is distinct from 'null'::jsonb then
  -- Storage may have succeeded despite a lost reply. The page's original
  -- completion path owns it; failure or pause cannot discard/replace this work.
  return jsonb_build_object('contract','microsoft-job-stop/1','tenantId',p_tenant,'jobId',p_job,'state','recover');
 end if;
 at_time:=clock_timestamp();paused:=not public.learn_capture_allowed(p_tenant,'email');
 retryable:=p_code in ('fetch_failed','throttled','provider_unavailable','refresh_failed','capture_unconfirmed');
 new_attempt:=j.attempt_count;
 if paused then
  outcome:='waiting';code:='capture_paused';new_attempt:=p_claim-1;due:=at_time+interval '60 seconds';
 elsif retryable and j.attempt_count<j.max_attempts then
  outcome:='retrying';code:=p_code;
  delay:=greatest(case j.attempt_count when 1 then 60 when 2 then 300 when 3 then 900 else 3600 end,coalesce(p_retry_after,0));
  due:=at_time+make_interval(secs=>delay);
 else outcome:='failed';code:=p_code;due:=null;end if;
 answer:=jsonb_build_object('contract','microsoft-job-stop/1','tenantId',p_tenant,'jobId',p_job,
  'state',outcome,'code',code,'attemptCount',new_attempt,'availableAt',due,'historicalReceipt',false);
 update public.platform_jobs set status=case outcome when 'waiting' then 'queued' when 'retrying' then 'retrying' else 'dead_letter' end,
  attempt_count=new_attempt,claimed_by=null,claimed_at=null,lease_expires_at=null,available_at=due,next_run_at=due,
  dead_lettered_at=case when outcome='failed' then at_time else null end,
  failed_at=case when outcome='failed' then at_time else null end,
  error_code='microsoft_'||code,last_error='Microsoft mail capture: '||code,
  error_count=case when paused then j.error_count else j.attempt_count end,result=answer,updated_at=at_time
 where id=p_job;
 insert into public.learn_microsoft_job_stops(job_id,tenant_id,worker,attempt,lease_end,definition,request,result)
  values(p_job,p_tenant,p_worker,p_claim,j.lease_expires_at,definition,request,answer);
 if j.lease_expires_at<=clock_timestamp() then raise exception 'learn_microsoft_stop_claim_lost' using errcode='PT409';end if;
 return answer;
end $$;
revoke all on function public.learn_microsoft_job_stop(uuid,uuid,text,integer,text,integer) from public,anon,authenticated;
grant execute on function public.learn_microsoft_job_stop(uuid,uuid,text,integer,text,integer) to service_role;

-- Preserve the existing shared capture filter verbatim and add only the two
-- Microsoft types. Retained pages may still be claimed for completion while paused.
create function public.learn_microsoft_job_claimable(p_tenant uuid,p_type text,p_job uuid) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select case when p_type in ('email.microsoft_discovery','email.microsoft_sync') then
  public.learn_capture_allowed(p_tenant,'email') or exists(
   select 1 from public.learn_microsoft_source_pages p join public.platform_jobs j on j.id=p.job_id and j.tenant_id=p.tenant_id
   where p.tenant_id=p_tenant and p.job_id=p_job and j.job_type=p_type and j.connector_id='microsoft-365'
  ) else true end;
$$;
revoke all on function public.learn_microsoft_job_claimable(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.learn_microsoft_job_claimable(uuid,text,uuid) to service_role;
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure);
 needle:='and (p_job_types is null or c.job_type = any(p_job_types))';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_microsoft_claim_shape_changed';end if;
 execute replace(d,needle,needle||E'\n      and public.learn_microsoft_job_claimable(c.tenant_id,c.job_type,c.id)');
end $$;
commit;
