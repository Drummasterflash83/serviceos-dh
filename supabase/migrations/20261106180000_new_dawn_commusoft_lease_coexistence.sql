-- Prepare a default-OFF, lease-governed overlap of one manual Commusoft read
-- and the source worker. No flag is inserted or enabled by this migration.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- A queue guard may be bypassed only by a separate, explicitly true tenant
-- flag. The absence of the flag preserves every existing queue exclusion.
create function public.new_dawn_commusoft_coexistence_enabled(p_tenant uuid)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.m2_commusoft_coexistence' and value='true'::jsonb);
$$;
revoke all on function public.new_dawn_commusoft_coexistence_enabled(uuid)
 from public,anon,authenticated,service_role;

do $patch$
declare d text;old text;replacement text;signature text;
begin
 -- The source worker distinguishes a lease wait from a provider quota wait.
 signature:='public.learn_commusoft_shared_lease_acquire(text,text,text)';
 d:=pg_get_functiondef(signature::regprocedure);
 old:=$old$  return jsonb_build_object('state','wait','retryAt',ceil(extract(epoch from wait_until)*1000)::bigint);$old$;
 replacement:=$new$  return jsonb_build_object('state','wait','retryAt',ceil(extract(epoch from wait_until)*1000)::bigint,
   'waitKind',case when g.lease_expires_at>now_at or g.manual_waiter_expires_at>now_at
    then 'lease' else 'quota' end);$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then
  raise exception 'commusoft_wait_kind_contract_changed';end if;
 execute replace(d,old,replacement);

 -- The exact-job HTTP route may surface a long lease wait as a pending request.
 signature:='public.new_dawn_commusoft_job_detail_acquire(uuid)';
 d:=pg_get_functiondef(signature::regprocedure);
 old:=$old$  return jsonb_build_object('state','wait','retry_at',(lease->>'retryAt')::bigint);$old$;
 replacement:=$new$  return jsonb_build_object('state','wait','retry_at',(lease->>'retryAt')::bigint,
   'wait_kind',lease->>'waitKind');$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then
  raise exception 'job_detail_wait_contract_changed';end if;
 execute replace(d,old,replacement);

 -- Exact-job start and current checks remain fail-closed when the flag is off.
 for signature,old,replacement in select * from (values
  ('public.new_dawn_commusoft_job_detail_start(uuid,uuid,uuid,text)',
   $old$and job_type='commusoft.source_sync' and status in ('queued','running','retrying') for share;$old$,
   $new$and job_type='commusoft.source_sync' and status in ('queued','running','retrying')
  and not public.new_dawn_commusoft_coexistence_enabled(p_tenant) for share;$new$),
  ('public.new_dawn_commusoft_job_detail_current(uuid)',
   $old$and job_type='commusoft.source_sync' and status in ('queued','running','retrying') for share;$old$,
   $new$and job_type='commusoft.source_sync' and status in ('queued','running','retrying')
  and not public.new_dawn_commusoft_coexistence_enabled(r.tenant_id) for share;$new$),
  ('public.learn_commusoft_verification_authority(public.learn_commusoft_verification_requests)',
   $old$if exists(select 1 from public.platform_jobs where tenant_id=r.tenant_id and job_type='commusoft.source_sync' and status in ('queued','running','retrying')) then return false;end if;$old$,
   $new$if not public.new_dawn_commusoft_coexistence_enabled(r.tenant_id) and
  exists(select 1 from public.platform_jobs where tenant_id=r.tenant_id and job_type='commusoft.source_sync' and status in ('queued','running','retrying')) then return false;end if;$new$),
  ('public.learn_commusoft_verify_request(uuid,uuid,uuid,jsonb,text)',
   $old$if exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync' and status in ('queued','running','retrying')) then
  raise exception 'learn_verification_import_active' using errcode='55000';end if;$old$,
   $new$if not public.new_dawn_commusoft_coexistence_enabled(p_tenant) and
  exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync' and status in ('queued','running','retrying')) then
  raise exception 'learn_verification_import_active' using errcode='55000';end if;$new$)
 ) as guard(signature,old,replacement) loop
  d:=pg_get_functiondef(signature::regprocedure);
  if (length(d)-length(replace(d,old,'')))/length(old)<>1 then
   raise exception 'commusoft_queue_guard_contract_changed:%',signature;end if;
  execute replace(d,old,replacement);
 end loop;

 -- The HTTP caller can retry the same bounded, still-prepared exact request
 -- after a long lease wait. A different actor/scope never inherits it.
 d:=pg_get_functiondef('public.new_dawn_commusoft_job_detail_start(uuid,uuid,uuid,text)'::regprocedure);
 old:=$old$ insert into public.new_dawn_commusoft_job_detail_reads
 (id,tenant_id,actor_id,job_id,connection_id,connection_revision,secret_id,source_version_id,external_id,reason)$old$;
 replacement:=$new$ if exists(select 1 from public.new_dawn_commusoft_job_detail_reads where id=p_request) then
  perform 1 from public.new_dawn_commusoft_job_detail_reads where id=p_request
   and tenant_id=p_tenant and actor_id=actor and job_id=p_job and connection_id=cid
   and source_version_id=vid and external_id=external and reason=btrim(p_reason)
   and state='prepared' and created_at>clock_timestamp()-interval '5 minutes';
  if found then return jsonb_build_object('request_id',p_request,'state','prepared');end if;
  raise exception 'job_detail_request_conflict' using errcode='PT409';
 end if;
 insert into public.new_dawn_commusoft_job_detail_reads
 (id,tenant_id,actor_id,job_id,connection_id,connection_revision,secret_id,source_version_id,external_id,reason)$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then
  raise exception 'job_detail_replay_contract_changed';end if;
 execute replace(d,old,replacement);
end $patch$;

-- Claimed source jobs yield the same page after a lease wait. This is not a
-- failure: no attempt or error count is consumed, and the 60-second failure
-- backoff does not apply. The caller must first prove there is no saved page.
-- Each committed page has a unique job; a later page has a new successor job.
create function public.learn_commusoft_yield_job(
 p_tenant uuid,p_job uuid,p_claimed_by text,p_attempt integer,p_retry_at timestamptz
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;next_at timestamptz;
begin
 if auth.role() is distinct from 'service_role' or p_claimed_by is null
  or p_attempt is null or p_attempt<1 or p_retry_at is null or not isfinite(p_retry_at)
  or p_retry_at<=clock_timestamp() or p_retry_at>clock_timestamp()+interval '90 seconds' then
  raise exception 'commusoft_yield_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant for update;
 if not found or j.job_type<>'commusoft.source_sync' or j.status<>'running'
  or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_attempt
  or j.lease_expires_at<=clock_timestamp() or exists(select 1 from public.learn_business_input_pages
   where job_id=p_job and tenant_id=p_tenant) or exists(select 1 from public.learn_business_input_request_permits
   where job_id=p_job and attempt_count=p_attempt) then
  raise exception 'commusoft_yield_not_owned' using errcode='PT409';end if;
 next_at:=greatest(clock_timestamp()+interval '250 milliseconds',
  least(p_retry_at,clock_timestamp()+interval '3 seconds'));
 update public.platform_jobs set status='queued',claimed_by=null,claimed_at=null,
  lease_expires_at=null,attempt_count=p_attempt-1,available_at=next_at
  where id=j.id;
 return jsonb_build_object('job_id',j.id,'status','queued','retry_at',
  ceil(extract(epoch from next_at)*1000)::bigint);
end $$;
revoke all on function public.learn_commusoft_yield_job(uuid,uuid,text,integer,timestamptz)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_yield_job(uuid,uuid,text,integer,timestamptz)
 to service_role;

-- A late manual 429 extends the shared gate using the retained request/permit
-- fingerprint, even if the actor or provider connection was revoked meanwhile.
alter table public.new_dawn_commusoft_job_detail_reads add column credential_fingerprint text
 references public.learn_business_input_request_gates(credential_fingerprint);
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('public.new_dawn_commusoft_job_detail_acquire(uuid)'::regprocedure);
 old:=$old$ if lease->>'state'<>'ready' then raise exception 'job_detail_lease_unavailable' using errcode='55000';end if;$old$;
 replacement:=$new$ if lease->>'state'<>'ready' then raise exception 'job_detail_lease_unavailable' using errcode='55000';end if;
 update public.new_dawn_commusoft_job_detail_reads set credential_fingerprint=fingerprint where id=p_request;$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then
  raise exception 'job_detail_fingerprint_contract_changed';end if;
 execute replace(d,old,replacement);
end $patch$;

-- Keep existing two-argument calls valid alongside a three-argument retry form.
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('public.new_dawn_commusoft_job_detail_fail(uuid,text)'::regprocedure);
 d:=replace(d,'new_dawn_commusoft_job_detail_fail(p_request uuid, p_code text)',
  'new_dawn_commusoft_job_detail_fail(p_request uuid, p_code text, p_retry_at timestamptz)');
 d:=replace(d,$old$'provider_unavailable','response_too_large'$old$,
  $new$'provider_unavailable','rate_limited','response_too_large'$new$);
 old:=$old$ if not found or r.state not in('prepared','claimed') then return;end if;$old$;
 replacement:=$new$ if found and p_code='rate_limited' and r.credential_fingerprint is not null then
  if p_retry_at is null or not isfinite(p_retry_at) or p_retry_at<=clock_timestamp()
   or p_retry_at>clock_timestamp()+interval '1 day' then
   raise exception 'job_detail_retry_invalid' using errcode='22023';end if;
  update public.learn_business_input_request_gates
   set next_allowed_at=greatest(next_allowed_at,p_retry_at)
   where credential_fingerprint=r.credential_fingerprint;
 end if;
 if r.id is null or r.state not in('prepared','claimed') then return;end if;$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 or
  position('p_retry_at timestamptz' in d)=0 then
  raise exception 'job_detail_retry_contract_changed';end if;
 execute replace(d,old,replacement);
end $patch$;
revoke all on function public.new_dawn_commusoft_job_detail_fail(uuid,text,timestamptz)
 from public,anon,authenticated,service_role;
grant execute on function public.new_dawn_commusoft_job_detail_fail(uuid,text,timestamptz)
 to service_role;

do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('public.new_dawn_commusoft_opportunity_probe_fail(uuid,text)'::regprocedure);
 d:=replace(d,'new_dawn_commusoft_opportunity_probe_fail(p_request uuid, p_code text)',
  'new_dawn_commusoft_opportunity_probe_fail(p_request uuid, p_code text, p_retry_at timestamptz)');
 old:=$old$ if not found or r.state not in ('prepared','claimed') then return;end if;$old$;
 replacement:=$new$ if found and p_code='rate_limited' and r.credential_fingerprint is not null then
  if p_retry_at is null or not isfinite(p_retry_at) or p_retry_at<=clock_timestamp()
   or p_retry_at>clock_timestamp()+interval '1 day' then
   raise exception 'opportunity_retry_invalid' using errcode='22023';end if;
  update public.learn_business_input_request_gates
   set next_allowed_at=greatest(next_allowed_at,p_retry_at)
   where credential_fingerprint=r.credential_fingerprint;
 end if;
 if r.id is null or r.state not in ('prepared','claimed') then return;end if;$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 or
  position('p_retry_at timestamptz' in d)=0 then
  raise exception 'opportunity_retry_contract_changed';end if;
 execute replace(d,old,replacement);
end $patch$;
revoke all on function public.new_dawn_commusoft_opportunity_probe_fail(uuid,text,timestamptz)
 from public,anon,authenticated,service_role;
grant execute on function public.new_dawn_commusoft_opportunity_probe_fail(uuid,text,timestamptz)
 to service_role;
commit;
