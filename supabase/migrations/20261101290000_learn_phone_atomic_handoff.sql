-- Atomic phone -> canonical interaction/event publication. Requires the existing
-- platform event and phone projection migrations. No capture activation or raw
-- DML grants. Retained/legacy sources without exact provenance stay untouched.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
-- The legacy SQL version helper uses unqualified table names. Pin its resolution
-- when called from this publisher's restricted search path; retain invoker security.
alter function public.phone_projection_version(uuid,uuid) set search_path=pg_catalog,public;
create table public.learn_phone_handoff_receipts(
 run_id uuid primary key references public.phone_sync_runs(id),
 tenant_id uuid not null references public.tenants(id),
 recording_id uuid not null references public.phone_recordings(id),
 transcript_id uuid not null references public.phone_transcripts(id),
 insight_id uuid not null references public.phone_ai_insights(id),
 call_id uuid not null references public.phone_calls(id),
 interaction_id uuid not null references public.interactions(id),
 event_id uuid references public.platform_events(id),
 source_fingerprint text not null check(source_fingerprint ~ '^[a-f0-9]{64}$'),
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_phone_handoff_receipts enable row level security;
revoke all on public.learn_phone_handoff_receipts from public,anon,authenticated,service_role;
create trigger learn_phone_handoff_receipts_immutable before update or delete
 on public.learn_phone_handoff_receipts for each row execute function public.learn_operator_input_immutable();

create function public.learn_phone_handoff(p_tenant uuid,p_run uuid,p_recording uuid,p_transcript uuid,p_insight uuid,p_phase text)
returns jsonb language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare r public.phone_recordings%rowtype;t public.phone_transcripts%rowtype;
 a public.phone_ai_insights%rowtype;c public.phone_calls%rowtype;run public.phone_sync_runs%rowtype;
 old public.interactions%rowtype;saved public.learn_phone_handoff_receipts%rowtype;
 v text;fingerprint text;transcript_hash text;latest uuid;interaction_id uuid;event_id uuid;
 same_source boolean;enriched boolean;answer jsonb;projection_metadata jsonb;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'phone_handoff_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_run is null or p_recording is null or p_transcript is null or p_insight is null
 or p_phase is null or p_phase not in('publish','inspect') then raise exception 'phone_handoff_invalid' using errcode='22023';end if;
 -- An immutable receipt is historical evidence, available after a lost reply or
 -- later pause. It is not a claim that source data or downstream cards are current.
 select * into saved from public.learn_phone_handoff_receipts where run_id=p_run;
 if found then
  if saved.tenant_id<>p_tenant or saved.recording_id<>p_recording or saved.transcript_id<>p_transcript or saved.insight_id<>p_insight
  then raise exception 'phone_handoff_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 if p_phase='inspect' then raise exception 'phone_handoff_missing' using errcode='PT409';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 -- Match the existing processing lock order: recording, run, transcript, insight,
 -- then call. All publications for recordings of the same call serialize there.
 select * into r from public.phone_recordings where tenant_id=p_tenant and id=p_recording for update;
 if not found then raise exception 'phone_handoff_source_changed' using errcode='PT409';end if;
 select * into run from public.phone_sync_runs where tenant_id=p_tenant and id=p_run for update;
 if not found or run.provider<>'pipeline' or run.sync_type<>'pipeline' or run.metadata->>'recording_id' is distinct from p_recording::text
 then raise exception 'phone_handoff_run_changed' using errcode='PT409';end if;
 -- A concurrent publisher may have committed while this request waited for locks.
 select * into saved from public.learn_phone_handoff_receipts where run_id=p_run;
 if found then
  if saved.tenant_id<>p_tenant or saved.recording_id<>p_recording or saved.transcript_id<>p_transcript or saved.insight_id<>p_insight
  then raise exception 'phone_handoff_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 if run.status<>'running' then raise exception 'phone_handoff_run_changed' using errcode='PT409';end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found or not public.learn_capture_allowed(p_tenant,'phone') then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 select * into t from public.phone_transcripts where tenant_id=p_tenant and id=p_transcript and recording_id=p_recording for share;
 select * into a from public.phone_ai_insights where tenant_id=p_tenant and id=p_insight and recording_id=p_recording for update;
 if t.id is null or a.id is null or r.storage_path is null or t.status<>'completed' or coalesce(btrim(t.transcript_text),'')=''
 or t.source_storage_path is distinct from r.storage_path or coalesce(t.source_sha256,'') !~ '^[a-f0-9]{64}$'
 or a.transcript_id is distinct from t.id then raise exception 'phone_handoff_source_unverified' using errcode='PT409';end if;
 transcript_hash:=encode(sha256(convert_to(t.transcript_text,'UTF8')),'hex');
 if a.source_transcript_sha256 is distinct from transcript_hash then raise exception 'phone_handoff_source_changed' using errcode='PT409';end if;
 select * into c from public.phone_calls where tenant_id=p_tenant and provider=r.provider and provider_call_id=r.provider_call_id for update;
 if not found or (a.call_id is not null and a.call_id<>c.id) then raise exception 'phone_handoff_call_changed' using errcode='PT409';end if;
 -- Do not let an older recording overwrite a later analysis of this call.
 select i.id into latest from public.phone_ai_insights i
 left join public.phone_recordings pr on pr.id=i.recording_id and pr.tenant_id=i.tenant_id
 where i.tenant_id=p_tenant and (i.call_id=c.id or (pr.provider=c.provider and pr.provider_call_id=c.provider_call_id))
 order by i.created_at desc,i.id desc limit 1;
 if latest is distinct from a.id or exists(select 1 from public.phone_ai_insights i where i.tenant_id=p_tenant and i.call_id=c.id and i.id<>a.id and i.created_at=a.created_at)
 then raise exception 'phone_handoff_superseded' using errcode='PT409';end if;
 if a.call_id is null then update public.phone_ai_insights set call_id=c.id where tenant_id=p_tenant and id=a.id;end if;
 v:=public.phone_projection_version(p_tenant,c.id);
 if v is null then raise exception 'phone_handoff_source_changed' using errcode='PT409';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('version',v,'recordingId',r.id,'storagePath',r.storage_path,
  'audioSha256',t.source_sha256,'transcriptId',t.id,'transcriptSha256',transcript_hash,'insightId',a.id,
  'intent',a.intent,'urgency',a.urgency,'actionRequired',a.action_required,'suggestedOwner',a.suggested_owner,'confidence',a.confidence)::text,'UTF8')),'hex');
 select * into old from public.interactions where tenant_id=p_tenant and source_table='phone_calls' and source_id=c.id for update;
 same_source:=coalesce(old.metadata->'phone_handoff'->>'sourceFingerprint'=fingerprint,false) and old.source_version is not distinct from v;
 enriched:=same_source and old.processing_status='enriched';
 projection_metadata:=jsonb_build_object('duration_seconds',c.duration_seconds,'outcome',c.outcome,'has_ai_insight',true,'recording_id',r.id,
  'phone_handoff',jsonb_build_object('version','learn-phone-handoff/1','sourceFingerprint',fingerprint,'recordingId',r.id,'transcriptId',t.id,'insightId',a.id,
   'audioSha256',t.source_sha256,'transcriptSha256',transcript_hash,'provenance','source_linked','coverage','unverified'));
 if same_source then interaction_id:=old.id;
 else
  insert into public.interactions as target(tenant_id,source_connector_id,source_type,source_table,source_id,source_external_id,
   interaction_type,direction,occurred_at,summary,body_preview,phone_from,phone_to,sentiment,related_thread_id,source_version,processing_status,metadata)
  values(p_tenant,r.provider,'phone','phone_calls',c.id,c.provider_call_id,'phone_call',case c.direction when 'IN' then 'inbound' when 'OUT' then 'outbound' else 'unknown' end,
   coalesce(c.started_at,c.created_at),a.summary,coalesce(a.summary,'Call recording; analysis summary unavailable'),c.from_number,c.to_number,a.sentiment,c.linked_id,v,'ready',projection_metadata)
  on conflict(tenant_id,source_table,source_id) do update set source_connector_id=excluded.source_connector_id,source_type=excluded.source_type,
   source_external_id=excluded.source_external_id,interaction_type=excluded.interaction_type,direction=excluded.direction,occurred_at=excluded.occurred_at,
   summary=excluded.summary,body_preview=excluded.body_preview,phone_from=excluded.phone_from,phone_to=excluded.phone_to,sentiment=excluded.sentiment,
   related_thread_id=excluded.related_thread_id,source_version=excluded.source_version,processing_status='ready',metadata=target.metadata||excluded.metadata
  returning id into interaction_id;
 end if;
 if not enriched then
  insert into public.platform_events as event(tenant_id,event_type,subject_type,subject_id,source,status,payload)
   values(p_tenant,'interaction.ready','interaction',interaction_id,'phone-process-pipeline','pending',
    jsonb_build_object('source_type','phone','call_id',c.id,'recording_id',r.id,'source_fingerprint',fingerprint))
   on conflict(tenant_id,event_type,subject_id) where status='pending' do update set payload=event.payload||excluded.payload
   returning id into event_id;
 end if;
 answer:=jsonb_build_object('version','learn-phone-handoff/1','tenantId',p_tenant,'runId',p_run,'recordingId',r.id,
  'transcriptId',t.id,'insightId',a.id,'callId',c.id,'interactionId',interaction_id,'eventId',event_id,
  'sourceFingerprint',fingerprint,'eventPublished',event_id is not null,'alreadyEnriched',enriched,'state','committed');
 insert into public.learn_phone_handoff_receipts(run_id,tenant_id,recording_id,transcript_id,insight_id,call_id,interaction_id,event_id,source_fingerprint,receipt)
  values(p_run,p_tenant,r.id,t.id,a.id,c.id,interaction_id,event_id,fingerprint,answer);
 return answer;
end$$;
revoke all on function public.learn_phone_handoff(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_handoff(uuid,uuid,uuid,uuid,uuid,text) to service_role;
commit;
