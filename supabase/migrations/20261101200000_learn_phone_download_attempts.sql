-- Exclusive recording download attempts and immutable audio versions. No capture is activated.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.learn_phone_processing_attempts (
 run_id uuid primary key references public.phone_sync_runs(id),
 tenant_id uuid not null references public.tenants(id),
 recording_id uuid not null references public.phone_recordings(id),
 stage text not null check(stage in ('download','transcription','analysis')),
 state text not null check(state in ('running','prepared','needs_review','succeeded','failed')),
 definition jsonb not null,
 prepared jsonb,
 receipt jsonb,
 started_at timestamptz not null default clock_timestamp(),
 review_after timestamptz not null default clock_timestamp()+interval '10 minutes',
 completed_at timestamptz,
 error_code text
);
create unique index learn_phone_one_recording_attempt on public.learn_phone_processing_attempts(tenant_id,recording_id)
 where state in ('running','prepared','needs_review');
alter table public.learn_phone_processing_attempts enable row level security;
revoke all on public.learn_phone_processing_attempts from public,anon,authenticated,service_role;
grant select on public.learn_phone_processing_attempts to service_role;
-- Only the definer RPC can mutate this journal. Expiry never grants a replacement owner.
create function public.learn_phone_download_attempt(
 p_tenant uuid,p_run uuid,p_recording uuid,p_phase text,p_data jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a public.learn_phone_processing_attempts%rowtype;r public.phone_recordings%rowtype;
 run public.phone_sync_runs%rowtype;account public.connector_accounts%rowtype;connector public.tenant_connectors%rowtype;
 d jsonb;src jsonb;answer jsonb;key text;code text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'phone_attempt_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_run is null or p_recording is null or p_phase is null
 or p_phase not in ('claim','prepare','complete','fail','inspect') or jsonb_typeof(p_data) is distinct from 'object'
 or octet_length(p_data::text)>16384 then raise exception 'phone_attempt_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 -- One recording lock precedes every attempt/run lock, including direct step calls.
 select * into r from public.phone_recordings where id=p_recording and tenant_id=p_tenant for update;
 if not found or r.provider<>'simwood' then raise exception 'phone_attempt_recording_changed' using errcode='PT409';end if;
 select * into run from public.phone_sync_runs where id=p_run and tenant_id=p_tenant for update;
 if not found or run.provider<>'simwood' or run.sync_type<>'recording_download'
 or run.metadata->>'recording_id' is distinct from p_recording::text then
  raise exception 'phone_attempt_run_changed' using errcode='PT409';end if;
 select * into a from public.learn_phone_processing_attempts where run_id=p_run for update;
 if found and (a.tenant_id<>p_tenant or a.recording_id<>p_recording or a.stage<>'download') then
  raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
 if p_phase='inspect' then
  if p_data<>'{}'::jsonb or a.run_id is null then raise exception 'phone_attempt_missing' using errcode='PT409';end if;
  return jsonb_build_object('version','learn-phone-download-attempt/1','tenantId',p_tenant,'runId',p_run,
   'recordingId',p_recording,'state',a.state,'replayed',true,'prepared',a.prepared);
 end if;
 src:=jsonb_build_object('providerRecordingId',r.provider_recording_id,'recordingUri',r.recording_uri,
  'storagePath',r.storage_path,'fileSize',r.file_size);
 if p_phase='claim' then
  if (p_data-array['accountId','connectorId','customerId','source'])<>'{}'::jsonb
   or jsonb_typeof(p_data->'source') is distinct from 'object'
   or p_data->>'customerId' is null or p_data->>'customerId'!~'^[A-Za-z0-9_-]{1,128}$' then
   raise exception 'phone_attempt_invalid' using errcode='22023';end if;
  if a.run_id is not null then
   if a.definition<>p_data then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
   return jsonb_build_object('version','learn-phone-download-attempt/1','tenantId',p_tenant,'runId',p_run,
    'recordingId',p_recording,'state',a.state,'replayed',true);
  end if;
  if run.status<>'running' or p_data->'source'<>src then raise exception 'phone_attempt_source_changed' using errcode='PT409';end if;
  if exists(select 1 from public.learn_phone_processing_attempts where tenant_id=p_tenant and recording_id=p_recording
   and state in ('running','prepared','needs_review')) then raise exception 'phone_recording_processing_held' using errcode='PT409';end if;
  d:=p_data;
 else
  if a.run_id is null then raise exception 'phone_attempt_missing' using errcode='PT409';end if;
  d:=a.definition;
  if p_phase='complete' and a.state='succeeded' then
   if a.prepared<>p_data then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
   return a.receipt;
  end if;
  if p_phase='prepare' and a.prepared is not null then
   if a.prepared<>p_data or a.state not in ('prepared','needs_review','succeeded') then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
   return jsonb_build_object('version','learn-phone-download-attempt/1','tenantId',p_tenant,'runId',p_run,
    'recordingId',p_recording,'state',a.state,'replayed',true,'prepared',a.prepared);
  end if;
  if p_phase='fail' then
   code:=p_data->>'code';
   if (p_data-'code')<>'{}' or code is null or code not in ('provider_rate_limited','provider_timeout','download_failed',
    'provider_recording_missing','recording_not_ready','auth_failed','empty_audio','audio_too_large',
    'storage_unconfirmed','download_integrity_unconfirmed','source_changed','unexpected_failure') then
    raise exception 'phone_attempt_error_invalid' using errcode='22023';end if;
   if a.state in ('succeeded','failed') then raise exception 'phone_attempt_closed' using errcode='PT409';end if;
   update public.learn_phone_processing_attempts set state=case when prepared is null then 'failed' else 'needs_review' end,
    error_code=code,completed_at=case when prepared is null then clock_timestamp() end where run_id=p_run returning * into a;
   update public.phone_sync_runs set status=case when a.state='failed' then 'failed' else 'running' end,
    completed_at=a.completed_at,error_message=code,metadata=metadata||jsonb_build_object('processing_attempt_state',a.state,'error_code',code)
    where id=p_run;
   return jsonb_build_object('version','learn-phone-download-attempt/1','tenantId',p_tenant,'runId',p_run,
    'recordingId',p_recording,'state',a.state,'replayed',false);
  end if;
  if run.status<>'running' or a.state not in ('running','prepared','needs_review') or d->'source'<>src then
   raise exception 'phone_attempt_source_changed' using errcode='PT409';end if;
 end if;
 -- New provider/upload/publication work must still be admitted. Receipt replay above is read-only.
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found or not public.learn_capture_allowed(p_tenant,'phone') then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 select * into connector from public.tenant_connectors where id=(d->>'connectorId')::uuid and tenant_id=p_tenant for share;
 if not found or connector.connector_id<>'simwood' or connector.provider<>'simwood' or not connector.enabled
 or connector.status not in ('active','error') then raise exception 'phone_account_unavailable' using errcode='PT409';end if;
 select * into account from public.connector_accounts where id=(d->>'accountId')::uuid and tenant_id=p_tenant for share;
 if not found or account.tenant_connector_id<>connector.id or account.status<>'active'
 or coalesce(nullif(btrim(account.settings->>'provider_customer_id'),''),account.account_key) is distinct from d->>'customerId' then
  raise exception 'phone_account_unavailable' using errcode='PT409';end if;
 if p_phase='claim' then
  insert into public.learn_phone_processing_attempts(run_id,tenant_id,recording_id,stage,state,definition)
  values(p_run,p_tenant,p_recording,'download','running',d);
  return jsonb_build_object('version','learn-phone-download-attempt/1','tenantId',p_tenant,'runId',p_run,
   'recordingId',p_recording,'state','running','replayed',false);
 end if;
 key:=p_tenant::text||'/simwood/recordings/versions/'||p_recording::text||'/'||p_run::text||'.wav';
 if (p_data-array['storagePath','sha256','bytes'])<>'{}' or p_data->>'storagePath' is distinct from key
 or jsonb_typeof(p_data->'sha256') is distinct from 'string' or p_data->>'sha256'!~'^[a-f0-9]{64}$'
 or jsonb_typeof(p_data->'bytes') is distinct from 'number' or (p_data->>'bytes')::numeric<>trunc((p_data->>'bytes')::numeric)
 or (p_data->>'bytes')::numeric not between 1 and 67108864 then raise exception 'phone_attempt_output_invalid' using errcode='22023';end if;
 if p_phase='prepare' then
  if a.state<>'running' then raise exception 'phone_attempt_closed' using errcode='PT409';end if;
  update public.learn_phone_processing_attempts set prepared=p_data,state='prepared' where run_id=p_run;
  return jsonb_build_object('version','learn-phone-download-attempt/1','tenantId',p_tenant,'runId',p_run,
   'recordingId',p_recording,'state','prepared','replayed',false,'prepared',p_data);
 end if;
 if a.prepared is null or a.prepared<>p_data then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
 answer:=jsonb_build_object('version','learn-phone-download-attempt/1','tenantId',p_tenant,'runId',p_run,
  'recordingId',p_recording,'state','succeeded','prepared',p_data,'previousStoragePath',r.storage_path);
 update public.phone_recordings set storage_path=key where id=p_recording and tenant_id=p_tenant;
 update public.phone_sync_runs set status='success',completed_at=clock_timestamp(),records_processed=1,error_message=null,
  metadata=metadata||jsonb_build_object('storage_path',key,'downloaded_bytes',p_data->'bytes','sha256',p_data->>'sha256','processing_attempt_state','succeeded')
  where id=p_run and tenant_id=p_tenant;
 update public.learn_phone_processing_attempts set state='succeeded',receipt=answer,completed_at=clock_timestamp() where run_id=p_run;
 return answer;
end $$;
revoke all on function public.learn_phone_download_attempt(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_download_attempt(uuid,uuid,uuid,text,jsonb) to service_role;

-- Hold later scheduled/manual selections as well as the current job. Retained
-- completed recordings remain readable; this only changes new processing eligibility.
create or replace function public.phone_pending_readiness(p_tenant_id uuid)
returns table(recording_id uuid,stage text,sort_at timestamptz,retry_state text)
language sql stable set search_path=pg_catalog as $$
 select s.id,s.stage,s.sort_at,
  case when a.run_id is not null then
   case when a.state='needs_review' or a.review_after<=now() then 'needs_review' else 'in_progress' end
  else public.phone_retry_state(s.stage,coalesce(r.runs,'[]'::jsonb),now()) end
 from public.phone_recording_pipeline_state s
 left join public.learn_phone_processing_attempts a on a.tenant_id=s.tenant_id and a.recording_id=s.id
  and a.state in ('running','prepared','needs_review')
 left join lateral (
  select jsonb_agg(jsonb_build_object('status',x.status,'started_at',x.started_at,
   'failed_step',x.metadata->>'failed_step','error_code',x.metadata->>'error_code') order by x.started_at desc) runs
  from (select status,started_at,metadata from public.phone_sync_runs where tenant_id=s.tenant_id and sync_type='pipeline'
   and metadata->>'recording_id'=s.id::text order by started_at desc limit 5)x
 )r on true where s.tenant_id=p_tenant_id and s.is_incomplete;
$$;
commit;
