-- Existing backlog selector must recover committed pages without the import's response.
insert into phone_sync_runs(id,tenant_id,sync_type) values(fixture_id(31),fixture_id(1),'recordings');
do $$declare rows jsonb;rec uuid;answer jsonb;n integer;begin
 rows:=jsonb_build_array(jsonb_build_object('tenant_id',fixture_id(1),'provider','simwood',
  'provider_recording_id','interrupted-response','started_at',now()-interval '10 minutes','raw_payload','{}'::jsonb));
 answer:=learn_phone_publish_page(fixture_id(1),fixture_id(31),fixture_id(4),fixture_id(3),'3950','recordings',1,rows);
 rec:=(answer->'newRecordingIds'->>0)::uuid;
 update phone_sync_runs set status='failed',metadata='{"publication_unconfirmed":true}' where id=fixture_id(31);
 assert exists(select 1 from phone_select_pending(fixture_id(1),50,120) where id=rec and stage='download');
 assert answer=learn_phone_publish_page(fixture_id(1),fixture_id(31),fixture_id(4),fixture_id(3),'3950','recordings',1,rows);
 -- Pause holds provider work, but cannot hide the retained backlog from recovery.
 update feature_flags set value='false';
 assert not learn_capture_allowed(fixture_id(1),'phone');
 assert exists(select 1 from phone_select_pending(fixture_id(1),50,120) where id=rec);
 update feature_flags set value='true';
 for n in 1..5 loop
  insert into phone_sync_runs(tenant_id,sync_type,status,started_at,metadata)
  values(fixture_id(1),'pipeline','failed',now()-make_interval(mins=>n),
   jsonb_build_object('recording_id',rec,'failed_step','download','error_code','provider_timeout'));
 end loop;
 assert(select retry_state from phone_pending_readiness(fixture_id(1)) where recording_id=rec)='needs_review';
 assert not exists(select 1 from phone_select_pending(fixture_id(1),50,120) where id=rec);
 assert exists(select 1 from phone_recording_pipeline_state where id=rec and is_incomplete);
 -- An explicit correction advancing the stage releases the old-stage hold.
 update phone_recordings set storage_path='retained-recovery.wav' where id=rec;
 assert exists(select 1 from phone_select_pending(fixture_id(1),50,120) where id=rec and stage='transcribe');
 insert into phone_transcripts(tenant_id,recording_id,status) values(fixture_id(1),rec,'completed');
 assert exists(select 1 from phone_select_pending(fixture_id(1),50,120) where id=rec and stage='analyse');
 insert into phone_ai_insights(tenant_id,recording_id) values(fixture_id(1),rec);
 assert not exists(select 1 from phone_select_pending(fixture_id(1),50,120) where id=rec);
 assert(select count(*) from phone_sync_runs where metadata->>'recording_id'=rec::text and status='failed')=5;
 assert(select storage_path from phone_recordings where id=rec)='retained-recovery.wav';
 assert(select count(*) from learn_phone_capture_pages where run_id=fixture_id(31))=1;
end$$;
insert into phone_recordings(tenant_id,provider_recording_id,started_at) values(fixture_id(2),'foreign-recovery',now()-interval '1 day');
set role service_role;
do $$begin
 assert not exists(select 1 from phone_select_pending(fixture_id(1),50,120) where tenant_id<>fixture_id(1));
 assert exists(select 1 from phone_select_pending(fixture_id(2),50,120) where provider_recording_id='foreign-recovery');
end$$;
reset role;
select 'PASS: interrupted page recovery, replay settlement, pause visibility, retry holds, retained failure/audio history, stage progression and tenant isolation';
