-- Retained result history and exclusive, recoverable transcription/analysis attempts.
-- Additive candidate only; does not configure credentials or activate capture.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
alter table public.phone_transcripts add column source_storage_path text,add column source_sha256 text,add column processing_run_id uuid references public.phone_sync_runs(id);
alter table public.phone_ai_insights add column source_transcript_sha256 text,add column processing_run_id uuid references public.phone_sync_runs(id);
create table public.learn_phone_result_versions(
 run_id uuid primary key references public.phone_sync_runs(id),tenant_id uuid not null references public.tenants(id),
 recording_id uuid not null references public.phone_recordings(id),stage text not null check(stage in ('transcription','analysis')),
 result_id uuid not null,source jsonb not null,result jsonb not null,previous_result jsonb,previous_intelligence jsonb,created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_phone_result_versions enable row level security;
revoke all on public.learn_phone_result_versions from public,anon,authenticated,service_role;
grant select on public.learn_phone_result_versions to service_role;
alter table public.learn_phone_processing_attempts add column dispatch jsonb;
alter table public.learn_phone_processing_attempts drop constraint learn_phone_processing_attempts_state_check;
alter table public.learn_phone_processing_attempts add constraint learn_phone_processing_attempts_state_check
 check(state in ('running','dispatched','prepared','needs_review','succeeded','failed'));
drop index public.learn_phone_one_recording_attempt;
create unique index learn_phone_one_recording_attempt on public.learn_phone_processing_attempts(tenant_id,recording_id)
 where state in ('running','dispatched','prepared','needs_review');

-- Called only inside the analysis publication transaction. Prior identity rows are
-- archived with the result before replacing their current projections.
create function public.learn_phone_apply_intelligence(p_tenant uuid,p_run uuid,p_recording uuid,p_transcript uuid,p_insight uuid,p jsonb)
returns void language plpgsql set search_path=pg_catalog as $$
declare c public.phone_calls%rowtype;r public.phone_recordings%rowtype;d public.call_directions%rowtype;
 participant public.call_participants%rowtype;n public.call_transcript_normalisations%rowtype;old jsonb;item jsonb;v text;
begin
 if p is null or p='null'::jsonb then return;end if;
 if jsonb_typeof(p) is distinct from 'object' or (p-array['callId','callSource','resolverVersion','direction','participants','normalisation','identitySummary'])<>'{}'
 or jsonb_typeof(p->'direction') is distinct from 'object' or jsonb_typeof(p->'participants') is distinct from 'array'
 or jsonb_array_length(p->'participants')>20 or jsonb_typeof(p->'identitySummary') is distinct from 'object'
 or coalesce(p->>'resolverVersion','')!~'^[A-Za-z0-9_.:-]{1,128}$' then raise exception 'phone_intelligence_invalid' using errcode='22023';end if;
 select * into r from public.phone_recordings where tenant_id=p_tenant and id=p_recording;
 select * into c from public.phone_calls where tenant_id=p_tenant and id=(p->>'callId')::uuid for update;
 if not found or c.provider<>r.provider or not coalesce((r.provider_call_id=c.provider_call_id or r.linked_id=c.linked_id),false) then
  raise exception 'phone_intelligence_source_changed' using errcode='PT409';end if;
 if p->'callSource' is distinct from jsonb_build_object('raw_payload',c.raw_payload,'from_number',c.from_number,'to_number',c.to_number) then raise exception 'phone_intelligence_source_changed' using errcode='PT409';end if;
 v:=p->>'resolverVersion';
 old:=jsonb_build_object('direction',(select to_jsonb(x) from public.call_directions x where tenant_id=p_tenant and call_id=c.id),
  'participants',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.call_participants x where tenant_id=p_tenant and call_id=c.id and resolver_version=v),
  'normalisation',(select to_jsonb(x) from public.call_transcript_normalisations x where tenant_id=p_tenant and transcript_id=p_transcript and normalisation_version=p->'normalisation'->>'normalisation_version'));
 update public.learn_phone_result_versions set previous_intelligence=old where run_id=p_run and tenant_id=p_tenant;
 d:=jsonb_populate_record(null::public.call_directions,p->'direction'||jsonb_build_object('id',gen_random_uuid(),'tenant_id',p_tenant,'call_id',c.id,'created_at',clock_timestamp(),'updated_at',clock_timestamp()));
 if d.direction is null or d.direction_confidence is null or d.direction_confidence not between 0 and 1 or d.classifier_version is null then raise exception 'phone_intelligence_invalid' using errcode='22023';end if;
 insert into public.call_directions select (d).* on conflict(tenant_id,call_id) do update set
  direction=excluded.direction,provider_direction=excluded.provider_direction,originating_number=excluded.originating_number,
  destination_number=excluded.destination_number,external_party_number=excluded.external_party_number,originating_extension=excluded.originating_extension,
  answering_extension=excluded.answering_extension,pickup_extension=excluded.pickup_extension,transferred_from_extension=excluded.transferred_from_extension,
  transferred_to_extension=excluded.transferred_to_extension,direction_evidence=excluded.direction_evidence,direction_confidence=excluded.direction_confidence,classifier_version=excluded.classifier_version;
 delete from public.call_participants where tenant_id=p_tenant and call_id=c.id and resolver_version=v;
 for item in select value from jsonb_array_elements(p->'participants') loop
  if item->>'resolver_version' is distinct from v then raise exception 'phone_intelligence_invalid' using errcode='22023';end if;
  participant:=jsonb_populate_record(null::public.call_participants,item||jsonb_build_object('id',gen_random_uuid(),'tenant_id',p_tenant,'call_id',c.id,'created_at',clock_timestamp(),'updated_at',clock_timestamp()));
  if participant.confidence is null or participant.confidence not between 0 and 1 or (participant.resolved_entity_id is not null and not exists(
   select 1 from public.graph_nodes where tenant_id=p_tenant and id=participant.resolved_entity_id)) then raise exception 'phone_intelligence_invalid' using errcode='22023';end if;
  insert into public.call_participants select (participant).*;
 end loop;
 if p->'normalisation' is not null and p->'normalisation'<>'null'::jsonb then
  n:=jsonb_populate_record(null::public.call_transcript_normalisations,p->'normalisation'||jsonb_build_object('id',gen_random_uuid(),'tenant_id',p_tenant,'transcript_id',p_transcript,'created_at',clock_timestamp(),'updated_at',clock_timestamp()));
  insert into public.call_transcript_normalisations select (n).* on conflict(tenant_id,transcript_id,normalisation_version) do update set
   normalised_text=excluded.normalised_text,corrections=excluded.corrections;
 end if;
 update public.phone_ai_insights set identity_summary=p->'identitySummary' where tenant_id=p_tenant and id=p_insight;
end $$;
revoke all on function public.learn_phone_apply_intelligence(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.learn_phone_derived_attempt(p_tenant uuid,p_run uuid,p_recording uuid,p_stage text,p_phase text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a public.learn_phone_processing_attempts%rowtype;r public.phone_recordings%rowtype;run public.phone_sync_runs%rowtype;
 t public.phone_transcripts%rowtype;i public.phone_ai_insights%rowtype;d jsonb;src jsonb;prior jsonb;result jsonb;answer jsonb;
 result_id uuid;cached boolean;code text;next_state text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'phone_attempt_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_run is null or p_recording is null or p_stage is null or p_stage not in ('transcription','analysis')
 or p_phase is null or p_phase not in ('claim','dispatch','prepare','complete','inspect','fail')
 or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>2097152 then raise exception 'phone_attempt_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into r from public.phone_recordings where id=p_recording and tenant_id=p_tenant for update;
 if not found then raise exception 'phone_attempt_recording_changed' using errcode='PT409';end if;
 select * into run from public.phone_sync_runs where id=p_run and tenant_id=p_tenant for update;
 if not found or run.provider<>'openai' or run.sync_type<>(case when p_stage='transcription' then 'transcription' else 'ai_analysis' end)
 or run.metadata->>'recording_id' is distinct from p_recording::text then raise exception 'phone_attempt_run_changed' using errcode='PT409';end if;
 select * into a from public.learn_phone_processing_attempts where run_id=p_run for update;
 if found and (a.tenant_id<>p_tenant or a.recording_id<>p_recording or a.stage<>p_stage) then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
 answer:=jsonb_build_object('version','learn-phone-derived-attempt/1','tenantId',p_tenant,'runId',p_run,'recordingId',p_recording,'stage',p_stage,'transcriptId',run.metadata->>'transcript_id');
 if p_phase='inspect' then
  if a.run_id is null or p_data<>'{}' then raise exception 'phone_attempt_missing' using errcode='PT409';end if;
  return answer||jsonb_build_object('state',a.state,'prepared',a.prepared,'receipt',a.receipt,'replayed',true);
 end if;
 if p_phase='complete' and a.state='succeeded' then
  if a.prepared is distinct from p_data then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;return a.receipt;
 end if;
 if p_phase='claim' and a.run_id is not null then
  if a.definition->'request' is distinct from p_data then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
  return answer||jsonb_build_object('state',a.state,'replayed',true,'receipt',a.receipt);
 end if;
 if p_phase<>'claim' and a.run_id is null then raise exception 'phone_attempt_missing' using errcode='PT409';end if;
 if p_phase='fail' then
  code:=p_data->>'code';
  if (p_data-'code')<>'{}' or code is null or code not in ('missing_audio','empty_audio','audio_too_large','config_error','input_unavailable',
   'openai_rate_limited','openai_auth_failed','openai_quota_exhausted','openai_invalid_request','audio_too_short','invalid_audio',
   'processing_unconfirmed','malformed_response') or a.state not in ('running','dispatched','prepared','needs_review') then
   raise exception 'phone_attempt_error_invalid' using errcode='22023';end if;
  -- Only a confirmed rejection before any saved output releases ownership.
  next_state:=case when a.state='running' or (a.state='dispatched' and code in ('openai_rate_limited','openai_auth_failed',
   'openai_quota_exhausted','openai_invalid_request','audio_too_short','audio_too_large','invalid_audio')) then 'failed' else 'needs_review' end;
  update public.learn_phone_processing_attempts set state=next_state,error_code=code,
   completed_at=case when next_state='failed' then clock_timestamp() end where run_id=p_run;
  update public.phone_sync_runs set status=case when next_state='failed' then 'failed' else 'running' end,
   completed_at=case when next_state='failed' then clock_timestamp() end,error_message=code,
   metadata=metadata||jsonb_build_object('processing_attempt_state',next_state,'error_code',code) where id=p_run;
  return answer||jsonb_build_object('state',next_state,'replayed',false);
 end if;
 if p_phase='prepare' and a.prepared is not null then
  if a.prepared is distinct from p_data then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
  return answer||jsonb_build_object('state',a.state,'prepared',a.prepared,'replayed',true);
 end if;
 if p_phase='dispatch' and a.dispatch is not null then
  if a.dispatch is distinct from p_data then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
  return answer||jsonb_build_object('state',a.state,'replayed',true);
 end if;
 if run.status<>'running' then raise exception 'phone_attempt_closed' using errcode='PT409';end if;
 if p_phase='claim' then
  if p_stage='analysis' and run.metadata->>'transcript_id' is distinct from p_data->>'transcriptId' then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
  if (p_data-array['model','force','transcriptId'])<>'{}' or jsonb_typeof(p_data->'force') is distinct from 'boolean'
   or coalesce(p_data->>'model','')!~'^[A-Za-z0-9_.:-]{1,128}$' or run.metadata->>'model' is distinct from p_data->>'model' then
   raise exception 'phone_attempt_invalid' using errcode='22023';end if;
  d:=jsonb_build_object('request',p_data);
 else d:=a.definition;end if;
 -- Retain an already-returned provider result even after a pause/source change.
 -- Only publication below requires the input and admission to remain current.
 if p_phase='prepare' then
  if a.state<>'dispatched' then raise exception 'phone_attempt_closed' using errcode='PT409';end if;
  if p_stage='transcription' then
   if (p_data-array['text','language','model'])<>'{}' or jsonb_typeof(p_data->'text') is distinct from 'string'
    or coalesce(btrim(p_data->>'text'),'')='' or length(p_data->>'text')>1000000
    or jsonb_typeof(p_data->'language') is distinct from 'string' or length(p_data->>'language')>64
    or p_data->>'model' is distinct from d->'request'->>'model' then raise exception 'phone_attempt_output_invalid' using errcode='22023';end if;
  else
   if (p_data-array['intent','urgency','sentiment','summary','action_required','suggested_owner','confidence','raw_payload'])<>'{}'
    or jsonb_typeof(p_data->'intent') is distinct from 'string' or length(p_data->>'intent') not between 1 and 64
    or coalesce(p_data->>'urgency','') not in ('low','medium','high','emergency')
    or coalesce(p_data->>'sentiment','') not in ('negative','neutral','positive','mixed')
    or jsonb_typeof(p_data->'summary') is distinct from 'string' or length(p_data->>'summary')>20000
    or jsonb_typeof(p_data->'action_required') is distinct from 'boolean'
    or coalesce(p_data->>'suggested_owner','') not in ('office','accounts','engineer','manager','unknown')
    or jsonb_typeof(p_data->'confidence') is distinct from 'number' or (p_data->>'confidence')::numeric not between 0 and 1
    or jsonb_typeof(p_data->'raw_payload') is distinct from 'object' then raise exception 'phone_attempt_output_invalid' using errcode='22023';end if;
  end if;
  update public.learn_phone_processing_attempts set prepared=p_data,state='prepared' where run_id=p_run;
  return answer||jsonb_build_object('state','prepared','prepared',p_data,'replayed',false);
 end if;
 if r.storage_path is null then raise exception 'phone_attempt_source_changed' using errcode='PT409';end if;
 if p_stage='transcription' then
  select * into t from public.phone_transcripts where tenant_id=p_tenant and recording_id=p_recording order by (status='completed') desc,created_at desc,id desc limit 1 for update;
  prior:=case when t.id is null then null else to_jsonb(t) end;
  src:=jsonb_build_object('storagePath',r.storage_path);
  cached:=t.status='completed' and coalesce(btrim(t.transcript_text),'')<>'' and (t.source_storage_path=r.storage_path or (t.source_storage_path is null and
   not exists(select 1 from public.learn_phone_processing_attempts where tenant_id=p_tenant and recording_id=p_recording and stage='download' and state='succeeded')));
  result_id:=t.id;result:=jsonb_build_object('text',t.transcript_text,'language',t.language,'model',t.model);
 else
  select * into t from public.phone_transcripts where id=(d->'request'->>'transcriptId')::uuid and tenant_id=p_tenant and recording_id=p_recording for update;
  if not found or t.status<>'completed' or coalesce(btrim(t.transcript_text),'')='' or not coalesce(t.source_storage_path=r.storage_path or (t.source_storage_path is null and
   not exists(select 1 from public.learn_phone_processing_attempts where tenant_id=p_tenant and recording_id=p_recording and stage='download' and state='succeeded')),false) then
   raise exception 'phone_attempt_source_changed' using errcode='PT409';end if;
  src:=jsonb_build_object('storagePath',r.storage_path,'transcriptId',t.id,'transcriptSha256',encode(sha256(convert_to(t.transcript_text,'UTF8')),'hex'),'text',t.transcript_text);
  select * into i from public.phone_ai_insights where tenant_id=p_tenant and recording_id=p_recording for update;
  prior:=case when i.id is null then null else to_jsonb(i) end;
  cached:=i.id is not null and ((i.transcript_id=t.id and i.source_transcript_sha256=src->>'transcriptSha256') or
   (i.source_transcript_sha256 is null and t.processing_run_id is null and (i.transcript_id is null or i.transcript_id=t.id)));
  result_id:=i.id;result:=to_jsonb(i);
 end if;
 if p_phase='claim' then
  if exists(select 1 from public.learn_phone_processing_attempts where tenant_id=p_tenant and recording_id=p_recording and state in ('running','dispatched','prepared','needs_review')) then
   raise exception 'phone_recording_processing_held' using errcode='PT409';end if;
  d:=d||jsonb_build_object('source',src,'previous',prior);
  if coalesce(cached,false) and p_data->'force'='false' then
   answer:=answer||jsonb_build_object('state','succeeded','cached',true,'resultId',result_id,'result',result,'replayed',false,'intelligencePublished',p_stage='analysis' and exists(select 1 from public.learn_phone_result_versions v where v.run_id=i.processing_run_id and v.tenant_id=p_tenant and v.previous_intelligence is not null and v.result->'raw_payload'=i.raw_payload));
   insert into public.learn_phone_processing_attempts(run_id,tenant_id,recording_id,stage,state,definition,receipt,completed_at)
    values(p_run,p_tenant,p_recording,p_stage,'succeeded',d,answer,clock_timestamp());
   update public.phone_sync_runs set status='success',completed_at=clock_timestamp(),records_processed=0,
    metadata=metadata||jsonb_build_object('already_processed',true,'result_id',result_id) where id=p_run;
   return answer;
  end if;
 else
  if d->'source' is distinct from src or d->'previous' is distinct from coalesce(prior,'null'::jsonb) then raise exception 'phone_attempt_source_changed' using errcode='PT409';end if;
 end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found or not public.learn_capture_allowed(p_tenant,'phone') then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 if p_phase='claim' then
  insert into public.learn_phone_processing_attempts(run_id,tenant_id,recording_id,stage,state,definition) values(p_run,p_tenant,p_recording,p_stage,'running',d);
  return answer||jsonb_build_object('state','running','source',src,'replayed',false);
 end if;
 if p_phase='dispatch' then
  if a.state<>'running' or (p_data-array['sha256','bytes'])<>'{}' or jsonb_typeof(p_data->'sha256') is distinct from 'string'
   or p_data->>'sha256'!~'^[a-f0-9]{64}$' or jsonb_typeof(p_data->'bytes') is distinct from 'number'
   or (p_data->>'bytes')::numeric not between 1 and 67108864 then raise exception 'phone_attempt_invalid' using errcode='22023';end if;
  update public.learn_phone_processing_attempts set dispatch=p_data,state='dispatched' where run_id=p_run;
  return answer||jsonb_build_object('state','dispatched','replayed',false);
 end if;
 if a.state not in ('prepared','needs_review') or a.prepared is null or a.prepared is distinct from p_data then raise exception 'phone_attempt_conflict' using errcode='PT409';end if;
 result_id:=coalesce(result_id,gen_random_uuid());
 insert into public.learn_phone_result_versions(run_id,tenant_id,recording_id,stage,result_id,source,result,previous_result)
 values(p_run,p_tenant,p_recording,p_stage,result_id,src||jsonb_build_object('request',a.dispatch),p_data,prior);
 if p_stage='transcription' then
  insert into public.phone_transcripts(id,tenant_id,recording_id,transcript_text,language,model,status,source_storage_path,source_sha256,processing_run_id)
  values(result_id,p_tenant,p_recording,p_data->>'text',p_data->>'language',p_data->>'model','completed',r.storage_path,a.dispatch->>'sha256',p_run)
  on conflict(id) do update set transcript_text=excluded.transcript_text,language=excluded.language,model=excluded.model,status='completed',
   source_storage_path=excluded.source_storage_path,source_sha256=excluded.source_sha256,processing_run_id=p_run;
 else
  insert into public.phone_ai_insights(id,tenant_id,recording_id,transcript_id,intent,urgency,sentiment,summary,action_required,suggested_owner,confidence,raw_payload,source_transcript_sha256,processing_run_id)
  values(result_id,p_tenant,p_recording,t.id,p_data->>'intent',p_data->>'urgency',p_data->>'sentiment',p_data->>'summary',(p_data->>'action_required')::boolean,
   p_data->>'suggested_owner',(p_data->>'confidence')::numeric,p_data->'raw_payload',src->>'transcriptSha256',p_run)
  on conflict(id) do update set transcript_id=excluded.transcript_id,intent=excluded.intent,urgency=excluded.urgency,sentiment=excluded.sentiment,
   summary=excluded.summary,action_required=excluded.action_required,suggested_owner=excluded.suggested_owner,confidence=excluded.confidence,
   raw_payload=excluded.raw_payload,source_transcript_sha256=excluded.source_transcript_sha256,processing_run_id=p_run,identity_summary='{}'::jsonb;
  perform public.learn_phone_apply_intelligence(p_tenant,p_run,p_recording,t.id,result_id,p_data->'raw_payload'->'phone_intelligence');
 end if;
 answer:=answer||jsonb_build_object('state','succeeded','cached',false,'resultId',result_id,'result',p_data,'intelligencePublished',p_stage='analysis' and jsonb_typeof(p_data->'raw_payload'->'phone_intelligence')='object');
 update public.phone_sync_runs set status='success',completed_at=clock_timestamp(),records_processed=1,error_message=null,
  metadata=metadata||jsonb_build_object('result_id',result_id,'processing_attempt_state','succeeded') where id=p_run;
 update public.learn_phone_processing_attempts set state='succeeded',receipt=answer,completed_at=clock_timestamp() where run_id=p_run;
 return answer;
end $$;
revoke all on function public.learn_phone_derived_attempt(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_derived_attempt(uuid,uuid,uuid,text,text,jsonb) to service_role;
-- Keep legacy observations available without inventing historical content hashes.
-- Once a versioned input changes, its earlier result no longer counts as current.
create or replace view phone_recording_pipeline_state
with (security_invoker = on) as
select
  r.id,
  r.tenant_id,
  r.provider,
  r.provider_recording_id,
  r.provider_call_id,
  r.recording_uri,
  r.storage_path,
  r.started_at,
  r.created_at,
  coalesce(r.started_at, r.created_at)               as sort_at,
  (r.provider_recording_id is not null)              as has_provider_id,
  (r.storage_path is not null)                       as has_download,
  (ct.recording_id is not null)                      as has_transcript,
  (ins.recording_id is not null)                     as has_insight,
  case
    when r.storage_path is null            then 'download'
    when ct.recording_id is null           then 'transcribe'
    when ins.recording_id is null          then 'analyse'
    else 'complete'
  end                                                as stage,
  (
    r.storage_path is null
    or ct.recording_id is null
    or ins.recording_id is null
  )                                                  as is_incomplete
from phone_recordings r
left join lateral (
  select t.recording_id,t.id,t.transcript_text,t.processing_run_id
  from phone_transcripts t
  where t.recording_id = r.id
    and t.tenant_id = r.tenant_id
    and t.status = 'completed'
    and (t.source_storage_path=r.storage_path or (t.source_storage_path is null and not exists(
      select 1 from public.learn_phone_processing_attempts a where a.tenant_id=r.tenant_id and a.recording_id=r.id and a.stage='download' and a.state='succeeded')))

  limit 1
) ct on true
left join lateral (
  select i.recording_id
  from phone_ai_insights i
  where i.recording_id = r.id
    and i.tenant_id = r.tenant_id
    and ct.id is not null
    and ((i.transcript_id=ct.id and i.source_transcript_sha256=encode(sha256(convert_to(ct.transcript_text,'UTF8')),'hex'))
      or (i.source_transcript_sha256 is null and ct.processing_run_id is null and (i.transcript_id is null or i.transcript_id=ct.id)))
  limit 1
) ins on true;

-- The server reads current results and their provenance, including insight ID
-- and created_at for the attribution loader. Result writes still use the atomic
-- definer RPC; this grants no INSERT/UPDATE/DELETE or browser access.
grant select on public.phone_transcripts,public.phone_ai_insights to service_role;
-- These configuration tables may be newly created under hardened default ACLs.
-- Without explicit read access a permission error can look like empty context.
grant select on public.telephony_directory,public.tenant_vocabulary to service_role;
commit;
