insert into tenants(id) values(fixture_id(1)),(fixture_id(2));
insert into phone_recordings(id,tenant_id,provider,provider_recording_id,storage_path) values(fixture_id(5),fixture_id(1),'simwood','retained','original.wav');
insert into phone_transcripts(id,tenant_id,recording_id,status,transcript_text,language,model) values(fixture_id(6),fixture_id(1),fixture_id(5),'completed','Original transcript','en','old');
insert into phone_ai_insights(id,tenant_id,recording_id,transcript_id,summary) values(fixture_id(7),fixture_id(1),fixture_id(5),fixture_id(6),'Original summary');
insert into phone_sync_runs(id,tenant_id,provider,sync_type,metadata) select fixture_id(n),fixture_id(1),'openai',case when n<200 then 'transcription' else 'ai_analysis' end,
 jsonb_build_object('recording_id',fixture_id(5),'transcript_id',case when n>=200 then fixture_id(6) end,'model','synthetic-model') from generate_series(100,220)n;
create function fixture_derived(n int,phase text,data jsonb default null) returns jsonb language sql as $$
 select learn_phone_derived_attempt(fixture_id(1),fixture_id(n),fixture_id(5),case when n<200 then 'transcription' else 'analysis' end,phase,coalesce(data,
 case when phase='claim' then jsonb_build_object('force',true,'model','synthetic-model')||case when n>=200 then jsonb_build_object('transcriptId',fixture_id(6)) else '{}'::jsonb end
 when phase='dispatch' then jsonb_build_object('sha256',repeat('a',64),'bytes',123)
 when phase in ('prepare','complete') then case when n<200 then '{"text":"New retained transcript","language":"en","model":"synthetic-model"}'::jsonb
 else jsonb_build_object('intent','request','urgency','low','sentiment','neutral','summary','New retained summary','action_required',false,'suggested_owner','office','confidence',0.5,'raw_payload','{}'::jsonb) end
 else '{}'::jsonb end));$$;
set role service_role;
do $$declare r jsonb;begin
 assert (select stage from phone_recording_pipeline_state where id=fixture_id(5))='complete';
 r:=fixture_derived(100,'claim','{"force":false,"model":"synthetic-model"}');assert r->>'state'='succeeded';assert r->'cached'='true';
 assert fixture_derived(101,'claim')->>'state'='running';
 begin perform fixture_derived(102,'claim');raise exception 'Concurrent owner admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_recording_processing_held';end;
 assert fixture_derived(101,'dispatch')->'replayed'='false';assert fixture_derived(101,'dispatch')->'replayed'='true';
 assert fixture_derived(101,'prepare')->>'state'='prepared';
 assert (select transcript_text from phone_transcripts where id=fixture_id(6))='Original transcript';
 r:=fixture_derived(101,'complete');assert r->>'resultId'=fixture_id(6)::text;assert fixture_derived(101,'complete')=r;
 assert (select transcript_text from phone_transcripts where id=fixture_id(6))='New retained transcript';
 assert (select previous_result->>'transcript_text' from learn_phone_result_versions where run_id=fixture_id(101))='Original transcript';
 assert (select source_sha256 from phone_transcripts where id=fixture_id(6))=repeat('a',64);
 assert (select stage from phone_recording_pipeline_state where id=fixture_id(5))='analyse';
 assert (select summary from phone_ai_insights where id=fixture_id(7))='Original summary';
 perform fixture_derived(200,'claim');perform fixture_derived(200,'dispatch');perform fixture_derived(200,'prepare');assert coalesce(fixture_derived(200,'complete')->'intelligencePublished','false'::jsonb) <> 'true';
 assert (select stage from phone_recording_pipeline_state where id=fixture_id(5))='complete';
 assert (select previous_result->>'summary' from learn_phone_result_versions where run_id=fixture_id(200))='Original summary';
 assert (select source_transcript_sha256 from phone_ai_insights where id=fixture_id(7))=encode(sha256(convert_to('New retained transcript','UTF8')),'hex');
end$$;
reset role;
select 'PASS: retained transcript/insight versions, exact input provenance, atomic completion and stale-summary detection';
set role service_role;
do $$begin
 perform fixture_derived(102,'claim');perform fixture_derived(102,'dispatch');
 assert fixture_derived(102,'fail','{"code":"processing_unconfirmed"}')->>'state'='needs_review';
 begin perform fixture_derived(103,'claim');raise exception 'Uncertain paid work repeated';exception when sqlstate 'PT409' then assert SQLERRM='phone_recording_processing_held';end;
end$$;reset role;
update learn_phone_processing_attempts set review_after=clock_timestamp()-interval '1 day' where run_id=fixture_id(102);
set role service_role;
do $$begin
 begin perform fixture_derived(103,'claim');raise exception 'Expired ownership stolen';exception when sqlstate 'PT409' then assert SQLERRM='phone_recording_processing_held';end;
end$$;reset role;
-- Only test-fixture administration closes this unresolvable no-output attempt.
update learn_phone_processing_attempts set state='failed' where run_id=fixture_id(102);
set role service_role;
do $$begin
 perform fixture_derived(103,'claim');perform fixture_derived(103,'dispatch');
 assert fixture_derived(103,'fail','{"code":"openai_rate_limited"}')->>'state'='failed';
 perform fixture_derived(104,'claim');perform fixture_derived(104,'dispatch');perform fixture_derived(104,'prepare');
end$$;reset role;
insert into feature_flags values(fixture_id(1),'learn.inputs.phone.enabled','false');
set role service_role;
do $$begin
 assert fixture_derived(104,'inspect')->>'state'='prepared';
 begin perform fixture_derived(104,'complete');raise exception 'Paused output published';exception when sqlstate 'PT409' then assert SQLERRM='learn_capture_paused';end;
 assert fixture_derived(101,'complete')->>'state'='succeeded';
end$$;reset role;update feature_flags set value='true';
create function fixture_derived_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic rollback' using errcode='P0002';end$$;
create trigger fixture_derived_failure before update on phone_sync_runs for each row when(new.id=fixture_id(104) and new.status='success') execute function fixture_derived_failure();
set role service_role;
do $$begin
 begin perform fixture_derived(104,'complete');raise exception 'Partial publication accepted';exception when sqlstate 'P0002' then null;end;
 assert not exists(select 1 from learn_phone_result_versions where run_id=fixture_id(104));
 assert (select processing_run_id from phone_transcripts where id=fixture_id(6))=fixture_id(101);
end$$;reset role;drop trigger fixture_derived_failure on phone_sync_runs;
set role service_role;
do $$begin
 assert fixture_derived(104,'complete')->>'state'='succeeded';
 begin perform learn_phone_derived_attempt(fixture_id(2),fixture_id(104),fixture_id(5),'transcription','inspect','{}');raise exception 'Foreign attempt inspected';exception when sqlstate 'PT409' then null;end;
end$$;reset role;
update phone_recordings set storage_path='replacement.wav' where id=fixture_id(5);
set role service_role;
do $$begin
 assert (select stage from phone_recording_pipeline_state where id=fixture_id(5))='transcribe';
 begin perform fixture_derived(201,'claim');raise exception 'Old transcript reused for new audio';exception when sqlstate 'PT409' then assert SQLERRM='phone_attempt_source_changed';end;
end$$;reset role;
do $$begin
 assert not has_table_privilege('authenticated','learn_phone_result_versions','select');
 assert not has_table_privilege('service_role','learn_phone_result_versions','update');
 assert not has_function_privilege('authenticated','learn_phone_derived_attempt(uuid,uuid,uuid,text,text,jsonb)','execute');
end$$;
select 'PASS: uncertain paid-request hold, confirmed rejection release, pause, exact replay, rollback, tenant and stale-audio guards';
-- Identity data and old normalisations are retained in the SAME result transaction.
update phone_recordings set storage_path='original.wav',provider_call_id='call-1' where id=fixture_id(5);
insert into phone_calls(id,tenant_id,provider,provider_call_id) values(fixture_id(8),fixture_id(1),'simwood','call-1');
insert into call_directions(tenant_id,call_id,direction) values(fixture_id(1),fixture_id(8),'unknown');
insert into call_participants(tenant_id,call_id,display_name) values(fixture_id(1),fixture_id(8),'Old participant');
insert into call_transcript_normalisations(tenant_id,transcript_id,normalised_text) values(fixture_id(1),fixture_id(6),'Old normalised text');
create function fixture_intelligence_output() returns jsonb language sql as $$select jsonb_build_object(
 'intent','request','urgency','low','sentiment','neutral','summary','Atomic identity summary','action_required',false,'suggested_owner','office','confidence',0.5,
 'raw_payload',jsonb_build_object('phone_intelligence',jsonb_build_object('callId',fixture_id(8),'callSource',jsonb_build_object('raw_payload','{}'::jsonb,'from_number',null,'to_number',null),'resolverVersion','v1',
 'direction',jsonb_build_object('direction','inbound','direction_evidence','[]'::jsonb,'direction_confidence',1,'classifier_version','v1'),
 'participants',jsonb_build_array(jsonb_build_object('participant_role','internal','resolved_entity_id',null,'display_name','New participant','confidence',0.8,'evidence','[]'::jsonb,'conflicts','[]'::jsonb,'source_fields','{}'::jsonb,'resolver_version','v1')),
 'normalisation',jsonb_build_object('normalised_text','New normalised text','corrections','[]'::jsonb,'normalisation_version','v1'),'identitySummary','{"confirmed":true}'::jsonb)));
$$;
set role service_role;
do $$begin
 perform fixture_derived(202,'claim');perform fixture_derived(202,'dispatch');perform fixture_derived(202,'prepare',fixture_intelligence_output());
end$$;reset role;
create function fixture_identity_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic identity failure' using errcode='P0002';end$$;
create trigger fixture_identity_failure before insert on call_participants for each row execute function fixture_identity_failure();
set role service_role;
do $$begin
 begin perform fixture_derived(202,'complete',fixture_intelligence_output());raise exception 'Partial identity publication';exception when sqlstate 'P0002' then null;end;
 assert (select processing_run_id from phone_ai_insights where id=fixture_id(7))=fixture_id(200);
 assert not exists(select 1 from learn_phone_result_versions where run_id=fixture_id(202));
end$$;reset role;
do $$begin
 assert (select display_name from call_participants where call_id=fixture_id(8))='Old participant';
 assert (select direction from call_directions where call_id=fixture_id(8))='unknown';
end$$;
drop trigger fixture_identity_failure on call_participants;
set role service_role;do $$begin assert fixture_derived(202,'complete',fixture_intelligence_output())->'intelligencePublished'='true';end$$;reset role;
do $$declare v jsonb;begin
 select previous_intelligence into v from learn_phone_result_versions where run_id=fixture_id(202);
 assert v->'participants'->0->>'display_name'='Old participant';
 assert v->'normalisation'->>'normalised_text'='Old normalised text';
 assert (select display_name from call_participants where call_id=fixture_id(8))='New participant';
 assert (select identity_summary from phone_ai_insights where id=fixture_id(7))='{"confirmed":true}'::jsonb;
 assert not has_function_privilege('service_role','learn_phone_apply_intelligence(uuid,uuid,uuid,uuid,uuid,jsonb)','execute');
end$$;
select 'PASS: attribution, participants and normalisation publish atomically with retained previous rows; partial failure rolls back all writes';
set role service_role;
do $$begin perform fixture_derived(106,'claim');perform fixture_derived(106,'dispatch');end$$;reset role;
update feature_flags set value='false';
set role service_role;
do $$begin
 assert fixture_derived(106,'prepare')->>'state'='prepared';
 begin perform fixture_derived(106,'complete');raise exception 'Paused returned result published';exception when sqlstate 'PT409' then assert SQLERRM='learn_capture_paused';end;
 assert fixture_derived(106,'inspect')->'prepared'->>'text'='New retained transcript';
end$$;reset role;update feature_flags set value='true';
set role service_role;do $$begin assert fixture_derived(106,'complete')->>'state'='succeeded';end$$;reset role;
select 'PASS: output returned after a pause is retained privately and publishes only after admission resumes';

