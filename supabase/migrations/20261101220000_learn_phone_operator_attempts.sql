-- OpenFolk attempt review and saved-result reconciliation. No provider dispatch,
-- automatic abandonment, source deletion or raw-content access is introduced.
begin;
create index learn_phone_attempt_review_page on public.learn_phone_processing_attempts(tenant_id,started_at desc,run_id desc);
create table public.learn_phone_operator_reconciliations(
 id uuid primary key,tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),run_id uuid not null references public.phone_sync_runs(id),
 reason text not null check(length(btrim(reason)) between 1 and 1000),
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_phone_operator_reconciliations enable row level security;
revoke all on public.learn_phone_operator_reconciliations from public,anon,authenticated,service_role;
create trigger learn_phone_reconciliation_immutable before update or delete on public.learn_phone_operator_reconciliations
 for each row execute function public.learn_operator_input_immutable();

create function public.learn_operator_phone_attempts(p_tenant uuid,p_recording uuid default null,p_after uuid default null,p_held_only boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare rows jsonb;more boolean;last_id uuid;after_time timestamptz;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 if p_held_only is null then raise exception 'phone_review_filter_invalid' using errcode='22023';end if;
 if p_recording is not null and not exists(select 1 from public.phone_recordings where tenant_id=p_tenant and id=p_recording) then
  raise exception 'phone_review_recording_unavailable' using errcode='42501';end if;
 if p_after is not null then
  select started_at into after_time from public.learn_phone_processing_attempts where tenant_id=p_tenant and run_id=p_after
   and (p_recording is null or recording_id=p_recording);
  if not found then raise exception 'phone_review_cursor_invalid' using errcode='22023';end if;
 end if;
 with bounded as materialized(
  select a.* from public.learn_phone_processing_attempts a where tenant_id=p_tenant
   and (p_recording is null or recording_id=p_recording)
   and (not p_held_only or state in ('running','dispatched','prepared','needs_review'))
   and (p_after is null or (started_at,run_id)<(after_time,p_after))
  order by started_at desc,run_id desc limit 31
 ), page as materialized(select * from bounded order by started_at desc,run_id desc limit 30)
 select coalesce((select jsonb_agg(jsonb_build_object(
  'run_id',a.run_id,'recording_id',a.recording_id,'stage',a.stage,'state',a.state,
  'started_at',a.started_at,'completed_at',a.completed_at,'review_after',a.review_after,
  'has_prepared_result',a.prepared is not null,'has_receipt',a.receipt is not null,
  'error_code',case when a.error_code in ('missing_audio','empty_audio','audio_too_large','config_error','input_unavailable',
   'openai_rate_limited','openai_auth_failed','openai_quota_exhausted','openai_invalid_request','audio_too_short','invalid_audio',
   'processing_unconfirmed','malformed_response','provider_rate_limited','provider_timeout','download_failed',
   'provider_recording_missing','recording_not_ready','auth_failed','storage_unconfirmed','download_integrity_unconfirmed','source_changed','unexpected_failure') then a.error_code else null end,
  'retained_previous_result',coalesce(v.previous_result is not null and v.previous_result<>'null'::jsonb,false),
  'retained_previous_attribution',v.previous_intelligence is not null,
  'can_reconcile',a.stage in ('transcription','analysis') and a.prepared is not null and a.state in ('prepared','needs_review') and public.learn_capture_allowed(p_tenant,'phone')
 ) order by a.started_at desc,a.run_id desc) from page a left join public.learn_phone_result_versions v on v.run_id=a.run_id and v.tenant_id=p_tenant),'[]'),
 (select count(*)>30 from bounded),(select run_id from page order by started_at,run_id limit 1) into rows,more,last_id;
 return jsonb_build_object('version','learn-operator-phone-attempts/1','tenant_id',p_tenant,'recording_id',p_recording,
  'held_only',p_held_only,'checked_at',clock_timestamp(),'capture_allowed',public.learn_capture_allowed(p_tenant,'phone'),
  'rows',rows,'next_cursor',case when more then last_id else null end);
end $$;
revoke all on function public.learn_operator_phone_attempts(uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_phone_attempts(uuid,uuid,uuid,boolean) to authenticated;

-- The request ID is durable across response loss. Check and cancel never publish.
-- Cancel leaves a tombstone so a delayed original apply cannot publish afterward.
create function public.learn_operator_phone_reconcile(p_tenant uuid,p_request uuid,p_actor uuid,p_run uuid,p_reason text,p_mode text default 'apply')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.learn_phone_operator_reconciliations%rowtype;a public.learn_phone_processing_attempts%rowtype;
 answer jsonb;published jsonb;already boolean;begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_run is null or p_mode is null or p_mode not in ('apply','check','cancel')
  or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'phone_reconciliation_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('phone-operator-reconciliation:'||p_request::text,0));
 select * into prior from public.learn_phone_operator_reconciliations where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.run_id<>p_run or prior.reason<>btrim(p_reason) then
   raise exception 'phone_reconciliation_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 -- Read without taking an attempt lock: the publication RPC acquires recording,
 -- run and attempt locks in that order, shared with every processing path.
 select * into a from public.learn_phone_processing_attempts where tenant_id=p_tenant and run_id=p_run;
 if not found then raise exception 'phone_review_attempt_unavailable' using errcode='42501';end if;
 answer:=jsonb_build_object('version','learn-operator-phone-reconciliation/1','tenant_id',p_tenant,'request_id',p_request,'run_id',p_run);
 if p_mode='check' then return answer||jsonb_build_object('state','pending');end if;
 if p_mode='cancel' then answer:=answer||jsonb_build_object('state','cancelled');
 else
  if a.stage not in ('transcription','analysis') then raise exception 'phone_download_verification_required' using errcode='PT409';end if;
  already:=a.state='succeeded';
  if already then
   if a.receipt->>'state' is distinct from 'succeeded' or a.receipt->>'runId' is distinct from p_run::text
    or a.receipt->>'tenantId' is distinct from p_tenant::text then raise exception 'phone_completion_unconfirmed' using errcode='PT409';end if;
  else
   if a.state not in ('prepared','needs_review') or a.prepared is null then raise exception 'phone_saved_result_unavailable' using errcode='PT409';end if;
   published:=public.learn_phone_derived_attempt(p_tenant,p_run,a.recording_id,a.stage,'complete',a.prepared);
   if published->>'state' is distinct from 'succeeded' then raise exception 'phone_completion_unconfirmed' using errcode='PT409';end if;
  end if;
  -- Return only a processing receipt, never transcript, summary or attribution.
  answer:=answer||jsonb_build_object('state','recorded','stage',a.stage,'recording_id',a.recording_id,'already_completed',already);
 end if;
 insert into public.learn_phone_operator_reconciliations(id,tenant_id,actor_id,run_id,reason,receipt)
  values(p_request,p_tenant,p_actor,p_run,btrim(p_reason),answer);
 return answer;
end $$;
revoke all on function public.learn_operator_phone_reconcile(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_phone_reconcile(uuid,uuid,uuid,uuid,text,text) to authenticated;
commit;
