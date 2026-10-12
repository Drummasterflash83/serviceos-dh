-- Actual production schema, isolated synthetic operator identities and grants.

set local plpgsql.check_asserts=on;
create function pg_temp.fixture_id(n integer) returns uuid language sql immutable as $$
 select ('fae019ce-714a-4f0f-971b-'||lpad(n::text,12,'0'))::uuid;
$$;
do $$begin
 if exists(select 1 from public.tenants where id in(pg_temp.fixture_id(1),pg_temp.fixture_id(2)))
 then raise exception 'Synthetic rollback identities already present';end if;
end$$;
insert into tenants(id,slug,display_name,metadata)
     select pg_temp.fixture_id(n),'phone-processing-rollback-'||n,'Synthetic Phone rollback probe',
     '{"synthetic":true,"purpose":"phone-processing-rollback-probe"}'::jsonb from generate_series(1,2)n;
insert into phone_recordings(id,tenant_id,provider,provider_recording_id,storage_path) values(pg_temp.fixture_id(5),pg_temp.fixture_id(1),'simwood','retained','original.wav');
insert into phone_transcripts(id,tenant_id,recording_id,status,transcript_text,language,model) values(pg_temp.fixture_id(6),pg_temp.fixture_id(1),pg_temp.fixture_id(5),'completed','Original transcript','en','old');
insert into phone_ai_insights(id,tenant_id,recording_id,transcript_id,summary) values(pg_temp.fixture_id(7),pg_temp.fixture_id(1),pg_temp.fixture_id(5),pg_temp.fixture_id(6),'Original summary');
insert into phone_sync_runs(id,tenant_id,provider,sync_type,metadata) select pg_temp.fixture_id(n),pg_temp.fixture_id(1),'openai',case when n<200 then 'transcription' else 'ai_analysis' end,
 jsonb_build_object('recording_id',pg_temp.fixture_id(5),'transcript_id',case when n>=200 then pg_temp.fixture_id(6) end,'model','synthetic-model') from generate_series(100,220)n;
create function pg_temp.fixture_derived(n int,phase text,data jsonb default null) returns jsonb language sql as $$
 select learn_phone_derived_attempt(pg_temp.fixture_id(1),pg_temp.fixture_id(n),pg_temp.fixture_id(5),case when n<200 then 'transcription' else 'analysis' end,phase,coalesce(data,
 case when phase='claim' then jsonb_build_object('force',true,'model','synthetic-model')||case when n>=200 then jsonb_build_object('transcriptId',pg_temp.fixture_id(6)) else '{}'::jsonb end
 when phase='dispatch' then jsonb_build_object('sha256',repeat('a',64),'bytes',123)
 when phase in ('prepare','complete') then case when n<200 then '{"text":"New retained transcript","language":"en","model":"synthetic-model"}'::jsonb
 else jsonb_build_object('intent','request','urgency','low','sentiment','neutral','summary','New retained summary','action_required',false,'suggested_owner','office','confidence',0.5,'raw_payload','{}'::jsonb) end
 else '{}'::jsonb end));$$;
do $grant_probe$declare fn record;begin
    for fn in select p.oid::regprocedure as signature from pg_proc p
      where p.pronamespace=pg_my_temp_schema() and p.proname like 'fixture_%'
    loop execute format('grant execute on function %s to service_role',fn.signature);end loop;
  end $grant_probe$;set local role service_role;
do $$declare r jsonb;begin
 assert (select stage from phone_recording_pipeline_state where id=pg_temp.fixture_id(5))='complete';
 r:=pg_temp.fixture_derived(100,'claim','{"force":false,"model":"synthetic-model"}');assert r->>'state'='succeeded';assert r->'cached'='true';
 assert pg_temp.fixture_derived(101,'claim')->>'state'='running';
 begin perform pg_temp.fixture_derived(102,'claim');raise exception 'Concurrent owner admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_recording_processing_held';end;
 assert pg_temp.fixture_derived(101,'dispatch')->'replayed'='false';assert pg_temp.fixture_derived(101,'dispatch')->'replayed'='true';
 assert pg_temp.fixture_derived(101,'prepare')->>'state'='prepared';
 assert (select transcript_text from phone_transcripts where id=pg_temp.fixture_id(6))='Original transcript';
 r:=pg_temp.fixture_derived(101,'complete');assert r->>'resultId'=pg_temp.fixture_id(6)::text;assert pg_temp.fixture_derived(101,'complete')=r;
 assert (select transcript_text from phone_transcripts where id=pg_temp.fixture_id(6))='New retained transcript';
 assert (select previous_result->>'transcript_text' from learn_phone_result_versions where run_id=pg_temp.fixture_id(101))='Original transcript';
 assert (select source_sha256 from phone_transcripts where id=pg_temp.fixture_id(6))=repeat('a',64);
 assert (select stage from phone_recording_pipeline_state where id=pg_temp.fixture_id(5))='analyse';
 assert (select summary from phone_ai_insights where id=pg_temp.fixture_id(7))='Original summary';
 perform pg_temp.fixture_derived(200,'claim');perform pg_temp.fixture_derived(200,'dispatch');perform pg_temp.fixture_derived(200,'prepare');assert coalesce(pg_temp.fixture_derived(200,'complete')->'intelligencePublished','false'::jsonb) <> 'true';
 assert (select stage from phone_recording_pipeline_state where id=pg_temp.fixture_id(5))='complete';
 assert (select previous_result->>'summary' from learn_phone_result_versions where run_id=pg_temp.fixture_id(200))='Original summary';
 assert (select source_transcript_sha256 from phone_ai_insights where id=pg_temp.fixture_id(7))=encode(sha256(convert_to('New retained transcript','UTF8')),'hex');
end$$;
reset role;

do $grant_probe$declare fn record;begin
    for fn in select p.oid::regprocedure as signature from pg_proc p
      where p.pronamespace=pg_my_temp_schema() and p.proname like 'fixture_%'
    loop execute format('grant execute on function %s to service_role',fn.signature);end loop;
  end $grant_probe$;set local role service_role;
do $$begin
 perform pg_temp.fixture_derived(102,'claim');perform pg_temp.fixture_derived(102,'dispatch');
 assert pg_temp.fixture_derived(102,'fail','{"code":"processing_unconfirmed"}')->>'state'='needs_review';
 begin perform pg_temp.fixture_derived(103,'claim');raise exception 'Uncertain paid work repeated';exception when sqlstate 'PT409' then assert SQLERRM='phone_recording_processing_held';end;
end$$;reset role;
update learn_phone_processing_attempts set review_after=clock_timestamp()-interval '1 day' where run_id=pg_temp.fixture_id(102);
do $grant_probe$declare fn record;begin
    for fn in select p.oid::regprocedure as signature from pg_proc p
      where p.pronamespace=pg_my_temp_schema() and p.proname like 'fixture_%'
    loop execute format('grant execute on function %s to service_role',fn.signature);end loop;
  end $grant_probe$;set local role service_role;
do $$begin
 begin perform pg_temp.fixture_derived(103,'claim');raise exception 'Expired ownership stolen';exception when sqlstate 'PT409' then assert SQLERRM='phone_recording_processing_held';end;
end$$;reset role;
-- Only test-fixture administration closes this unresolvable no-output attempt.
update learn_phone_processing_attempts set state='failed' where run_id=pg_temp.fixture_id(102);
do $grant_probe$declare fn record;begin
    for fn in select p.oid::regprocedure as signature from pg_proc p
      where p.pronamespace=pg_my_temp_schema() and p.proname like 'fixture_%'
    loop execute format('grant execute on function %s to service_role',fn.signature);end loop;
  end $grant_probe$;set local role service_role;
do $$begin
 perform pg_temp.fixture_derived(103,'claim');perform pg_temp.fixture_derived(103,'dispatch');
 assert pg_temp.fixture_derived(103,'fail','{"code":"openai_rate_limited"}')->>'state'='failed';
 perform pg_temp.fixture_derived(104,'claim');perform pg_temp.fixture_derived(104,'dispatch');perform pg_temp.fixture_derived(104,'prepare');
end$$;reset role;
insert into feature_flags(tenant_id,flag,value) values(pg_temp.fixture_id(1),'learn.inputs.phone.enabled','false');
do $grant_probe$declare fn record;begin
    for fn in select p.oid::regprocedure as signature from pg_proc p
      where p.pronamespace=pg_my_temp_schema() and p.proname like 'fixture_%'
    loop execute format('grant execute on function %s to service_role',fn.signature);end loop;
  end $grant_probe$;set local role service_role;
do $$begin
 assert pg_temp.fixture_derived(104,'inspect')->>'state'='prepared';
 begin perform pg_temp.fixture_derived(104,'complete');raise exception 'Paused output published';exception when sqlstate 'PT409' then assert SQLERRM='learn_capture_paused';end;
 assert pg_temp.fixture_derived(101,'complete')->>'state'='succeeded';
end$$;reset role;update feature_flags set value='true' where tenant_id=pg_temp.fixture_id(1) and flag='learn.inputs.phone.enabled';
create function pg_temp.fixture_derived_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic rollback' using errcode='P0002';end$$;
create trigger fixture_derived_failure before update on phone_sync_runs for each row when(new.id=pg_temp.fixture_id(104) and new.status='success') execute function pg_temp.fixture_derived_failure();
do $grant_probe$declare fn record;begin
    for fn in select p.oid::regprocedure as signature from pg_proc p
      where p.pronamespace=pg_my_temp_schema() and p.proname like 'fixture_%'
    loop execute format('grant execute on function %s to service_role',fn.signature);end loop;
  end $grant_probe$;set local role service_role;
do $$begin
 begin perform pg_temp.fixture_derived(104,'complete');raise exception 'Partial publication accepted';exception when sqlstate 'P0002' then null;end;
 assert not exists(select 1 from learn_phone_result_versions where run_id=pg_temp.fixture_id(104));
 assert (select processing_run_id from phone_transcripts where id=pg_temp.fixture_id(6))=pg_temp.fixture_id(101);
end$$;reset role;drop trigger fixture_derived_failure on phone_sync_runs;
do $grant_probe$declare fn record;begin
    for fn in select p.oid::regprocedure as signature from pg_proc p
      where p.pronamespace=pg_my_temp_schema() and p.proname like 'fixture_%'
    loop execute format('grant execute on function %s to service_role',fn.signature);end loop;
  end $grant_probe$;set local role service_role;
do $$begin
 assert pg_temp.fixture_derived(104,'complete')->>'state'='succeeded';
 begin perform learn_phone_derived_attempt(pg_temp.fixture_id(2),pg_temp.fixture_id(104),pg_temp.fixture_id(5),'transcription','inspect','{}');raise exception 'Foreign attempt inspected';exception when sqlstate 'PT409' then null;end;
end$$;reset role;
update phone_recordings set storage_path='replacement.wav' where id=pg_temp.fixture_id(5);
do $grant_probe$declare fn record;begin
    for fn in select p.oid::regprocedure as signature from pg_proc p
      where p.pronamespace=pg_my_temp_schema() and p.proname like 'fixture_%'
    loop execute format('grant execute on function %s to service_role',fn.signature);end loop;
  end $grant_probe$;set local role service_role;
do $$begin
 assert (select stage from phone_recording_pipeline_state where id=pg_temp.fixture_id(5))='transcribe';
 begin perform pg_temp.fixture_derived(201,'claim');raise exception 'Old transcript reused for new audio';exception when sqlstate 'PT409' then assert SQLERRM='phone_attempt_source_changed';end;
end$$;reset role;
do $$begin
 assert not has_table_privilege('authenticated','learn_phone_result_versions','select');
 assert not has_table_privilege('service_role','learn_phone_result_versions','update');
 assert not has_function_privilege('authenticated','learn_phone_derived_attempt(uuid,uuid,uuid,text,text,jsonb)','execute');
end$$;

-- Identity data and old normalisations are retained in the SAME result transaction.
update phone_recordings set storage_path='original.wav',provider_call_id='call-1' where id=pg_temp.fixture_id(5);
insert into phone_calls(id,tenant_id,provider,provider_call_id) values(pg_temp.fixture_id(8),pg_temp.fixture_id(1),'simwood','call-1');
insert into call_directions(tenant_id,call_id,direction) values(pg_temp.fixture_id(1),pg_temp.fixture_id(8),'unknown');
insert into call_participants(tenant_id,call_id,display_name) values(pg_temp.fixture_id(1),pg_temp.fixture_id(8),'Old participant');
insert into call_transcript_normalisations(tenant_id,transcript_id,normalised_text) values(pg_temp.fixture_id(1),pg_temp.fixture_id(6),'Old normalised text');
create function pg_temp.fixture_intelligence_output() returns jsonb language sql as $$select jsonb_build_object(
 'intent','request','urgency','low','sentiment','neutral','summary','Atomic identity summary','action_required',false,'suggested_owner','office','confidence',0.5,
 'raw_payload',jsonb_build_object('phone_intelligence',jsonb_build_object('callId',pg_temp.fixture_id(8),'callSource',jsonb_build_object('raw_payload','{}'::jsonb,'from_number',null,'to_number',null),'resolverVersion','v1',
 'direction',jsonb_build_object('direction','inbound','direction_evidence','[]'::jsonb,'direction_confidence',1,'classifier_version','v1'),
 'participants',jsonb_build_array(jsonb_build_object('participant_role','internal','resolved_entity_id',null,'display_name','New participant','confidence',0.8,'evidence','[]'::jsonb,'conflicts','[]'::jsonb,'source_fields','{}'::jsonb,'resolver_version','v1')),
 'normalisation',jsonb_build_object('normalised_text','New normalised text','corrections','[]'::jsonb,'normalisation_version','v1'),'identitySummary','{"confirmed":true}'::jsonb)));
$$;
do $grant_probe$declare fn record;begin
    for fn in select p.oid::regprocedure as signature from pg_proc p
      where p.pronamespace=pg_my_temp_schema() and p.proname like 'fixture_%'
    loop execute format('grant execute on function %s to service_role',fn.signature);end loop;
  end $grant_probe$;set local role service_role;
do $$begin
 perform pg_temp.fixture_derived(202,'claim');perform pg_temp.fixture_derived(202,'dispatch');perform pg_temp.fixture_derived(202,'prepare',pg_temp.fixture_intelligence_output());
end$$;reset role;
create function pg_temp.fixture_identity_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic identity failure' using errcode='P0002';end$$;
create trigger fixture_identity_failure before insert on call_participants for each row execute function pg_temp.fixture_identity_failure();
do $grant_probe$declare fn record;begin
    for fn in select p.oid::regprocedure as signature from pg_proc p
      where p.pronamespace=pg_my_temp_schema() and p.proname like 'fixture_%'
    loop execute format('grant execute on function %s to service_role',fn.signature);end loop;
  end $grant_probe$;set local role service_role;
do $$begin
 begin perform pg_temp.fixture_derived(202,'complete',pg_temp.fixture_intelligence_output());raise exception 'Partial identity publication';exception when sqlstate 'P0002' then null;end;
 assert (select processing_run_id from phone_ai_insights where id=pg_temp.fixture_id(7))=pg_temp.fixture_id(200);
 assert not exists(select 1 from learn_phone_result_versions where run_id=pg_temp.fixture_id(202));
end$$;reset role;
do $$begin
 assert (select display_name from call_participants where call_id=pg_temp.fixture_id(8))='Old participant';
 assert (select direction from call_directions where call_id=pg_temp.fixture_id(8))='unknown';
end$$;
drop trigger fixture_identity_failure on call_participants;
do $grant_probe$declare fn record;begin
    for fn in select p.oid::regprocedure as signature from pg_proc p
      where p.pronamespace=pg_my_temp_schema() and p.proname like 'fixture_%'
    loop execute format('grant execute on function %s to service_role',fn.signature);end loop;
  end $grant_probe$;set local role service_role;do $$begin assert pg_temp.fixture_derived(202,'complete',pg_temp.fixture_intelligence_output())->'intelligencePublished'='true';end$$;reset role;
do $$declare v jsonb;begin
 select previous_intelligence into v from learn_phone_result_versions where run_id=pg_temp.fixture_id(202);
 assert v->'participants'->0->>'display_name'='Old participant';
 assert v->'normalisation'->>'normalised_text'='Old normalised text';
 assert (select display_name from call_participants where call_id=pg_temp.fixture_id(8))='New participant';
 assert (select identity_summary from phone_ai_insights where id=pg_temp.fixture_id(7))='{"confirmed":true}'::jsonb;
 assert not has_function_privilege('service_role','learn_phone_apply_intelligence(uuid,uuid,uuid,uuid,uuid,jsonb)','execute');
end$$;

do $grant_probe$declare fn record;begin
    for fn in select p.oid::regprocedure as signature from pg_proc p
      where p.pronamespace=pg_my_temp_schema() and p.proname like 'fixture_%'
    loop execute format('grant execute on function %s to service_role',fn.signature);end loop;
  end $grant_probe$;set local role service_role;
do $$begin perform pg_temp.fixture_derived(106,'claim');perform pg_temp.fixture_derived(106,'dispatch');end$$;reset role;
update feature_flags set value='false' where tenant_id=pg_temp.fixture_id(1) and flag='learn.inputs.phone.enabled';
do $grant_probe$declare fn record;begin
    for fn in select p.oid::regprocedure as signature from pg_proc p
      where p.pronamespace=pg_my_temp_schema() and p.proname like 'fixture_%'
    loop execute format('grant execute on function %s to service_role',fn.signature);end loop;
  end $grant_probe$;set local role service_role;
do $$begin
 assert pg_temp.fixture_derived(106,'prepare')->>'state'='prepared';
 begin perform pg_temp.fixture_derived(106,'complete');raise exception 'Paused returned result published';exception when sqlstate 'PT409' then assert SQLERRM='learn_capture_paused';end;
 assert pg_temp.fixture_derived(106,'inspect')->'prepared'->>'text'='New retained transcript';
end$$;reset role;update feature_flags set value='true' where tenant_id=pg_temp.fixture_id(1) and flag='learn.inputs.phone.enabled';
do $grant_probe$declare fn record;begin
    for fn in select p.oid::regprocedure as signature from pg_proc p
      where p.pronamespace=pg_my_temp_schema() and p.proname like 'fixture_%'
    loop execute format('grant execute on function %s to service_role',fn.signature);end loop;
  end $grant_probe$;set local role service_role;do $$begin assert pg_temp.fixture_derived(106,'complete')->>'state'='succeeded';end$$;reset role;



-- Exercise the exact attribution-loader projections under the deployed role.
-- LIMIT 0 validates authority/columns without returning any retained source data.
set local role service_role;
do $$begin
 perform id,recording_id,transcript_text from public.phone_transcripts limit 0;
 perform id,tenant_id,recording_id,created_at from public.phone_ai_insights limit 0;
 perform extension,e164_number,endpoint_ref,person_node_id,role,is_shared_device,
   confidence,source,metadata,tenant_id,active from public.telephony_directory limit 0;
 perform term,category,aliases,phonetic_variants,confidence,tenant_id,active from public.tenant_vocabulary limit 0;
 perform id,from_number,to_number,direction,raw_payload,tenant_id,provider_call_id,linked_id,started_at from public.phone_calls limit 0;
 perform related_person_id,related_company_id,tenant_id,source_table,source_id from public.interactions limit 0;
 perform id,label,node_type,tenant_id from public.graph_nodes limit 0;
 perform id,display_name from public.tenants limit 0;
end$$;
reset role;

 do $grant_probe$declare fn record;begin
 for fn in select p.oid::regprocedure as signature from pg_proc p where p.pronamespace=pg_my_temp_schema() and p.proname like 'fixture_%'
 loop execute format('grant execute on function %s to authenticated',fn.signature);end loop;
 end $grant_probe$;
 insert into auth.users(id,email,banned_until) select pg_temp.fixture_id(n),'phone-rollback-'||n||'@example.invalid','infinity'::timestamptz from generate_series(800,802)n;
 insert into profiles(id) values(pg_temp.fixture_id(800)),(pg_temp.fixture_id(801)),(pg_temp.fixture_id(802)) on conflict(id) do nothing;
insert into platform_authority_grants(profile_id,permission,effective_from,effective_to,granted_by,reason) values
 (pg_temp.fixture_id(800),'platform.controlplane.admin',now()-interval '1 hour',now()+interval '1 hour','rollback-probe','Uncommitted synthetic assertion'),
 (pg_temp.fixture_id(801),'platform.controlplane.view',now()-interval '1 hour',now()+interval '1 hour','rollback-probe','Uncommitted synthetic assertion');
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='fae019ce-714a-4f0f-971b-000000000800';
set local role service_role;
select pg_temp.fixture_derived(107,'claim');select pg_temp.fixture_derived(107,'dispatch');select pg_temp.fixture_derived(107,'prepare');
reset role;
set local role authenticated;
do $$declare p jsonb;r jsonb;begin
 p:=learn_operator_phone_attempts(pg_temp.fixture_id(1));
 assert jsonb_array_length(p->'rows')=1;
 assert p->'rows'->0->>'run_id'=pg_temp.fixture_id(107)::text;
 assert p->'rows'->0->'can_reconcile'='true';
 assert not(p::text like '%New retained transcript%');assert not(p::text like '%original.wav%');
 assert learn_operator_phone_reconcile(pg_temp.fixture_id(1),pg_temp.fixture_id(900),pg_temp.fixture_id(800),pg_temp.fixture_id(107),'Synthetic review','check')->>'state'='pending';
 r:=learn_operator_phone_reconcile(pg_temp.fixture_id(1),pg_temp.fixture_id(900),pg_temp.fixture_id(800),pg_temp.fixture_id(107),'Synthetic review');
 assert r->>'state'='recorded';assert r->'already_completed'='false';
 assert r=learn_operator_phone_reconcile(pg_temp.fixture_id(1),pg_temp.fixture_id(900),pg_temp.fixture_id(800),pg_temp.fixture_id(107),'Synthetic review');
 assert jsonb_array_length(learn_operator_phone_attempts(pg_temp.fixture_id(1))->'rows')=0;
 begin perform learn_operator_phone_reconcile(pg_temp.fixture_id(1),pg_temp.fixture_id(900),pg_temp.fixture_id(800),pg_temp.fixture_id(107),'Changed reason');raise exception 'Request conflict admitted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_operator_phone_attempts(pg_temp.fixture_id(2),pg_temp.fixture_id(5));raise exception 'Foreign recording admitted';exception when insufficient_privilege then null;end;
 begin perform learn_operator_phone_reconcile(pg_temp.fixture_id(2),pg_temp.fixture_id(901),pg_temp.fixture_id(800),pg_temp.fixture_id(107),'Foreign');raise exception 'Foreign run admitted';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$begin assert (select count(*) from learn_phone_operator_reconciliations)=1;assert (select count(*) from learn_phone_result_versions where run_id=pg_temp.fixture_id(107))=1;end$$;
set local request.jwt.claim.sub='fae019ce-714a-4f0f-971b-000000000801';set local role authenticated;
do $$begin
 perform learn_operator_phone_attempts(pg_temp.fixture_id(1),null,null,false);
 begin perform learn_operator_phone_reconcile(pg_temp.fixture_id(1),pg_temp.fixture_id(901),pg_temp.fixture_id(801),pg_temp.fixture_id(107),'Viewer');raise exception 'Viewer mutation admitted';exception when insufficient_privilege then null;end;
end$$;reset role;
set local request.jwt.claim.sub='fae019ce-714a-4f0f-971b-000000000802';set local role authenticated;
do $$begin begin perform learn_operator_phone_attempts(pg_temp.fixture_id(1));raise exception 'Tenant user read admitted';exception when insufficient_privilege then null;end;end$$;reset role;
set local request.jwt.claim.sub='fae019ce-714a-4f0f-971b-000000000800';
set local role service_role;select pg_temp.fixture_derived(108,'claim');select pg_temp.fixture_derived(108,'dispatch');select pg_temp.fixture_derived(108,'prepare');reset role;
set local role authenticated;
do $$declare r jsonb;begin
 r:=learn_operator_phone_reconcile(pg_temp.fixture_id(1),pg_temp.fixture_id(902),pg_temp.fixture_id(800),pg_temp.fixture_id(108),'Cancel before apply','cancel');assert r->>'state'='cancelled';
 assert learn_operator_phone_reconcile(pg_temp.fixture_id(1),pg_temp.fixture_id(902),pg_temp.fixture_id(800),pg_temp.fixture_id(108),'Cancel before apply')=r;
end$$;reset role;
do $$begin assert (select state from learn_phone_processing_attempts where run_id=pg_temp.fixture_id(108))='prepared';end$$;
update feature_flags set value='false' where tenant_id=pg_temp.fixture_id(1);
set local role authenticated;do $$begin
 assert (learn_operator_phone_attempts(pg_temp.fixture_id(1))->'rows'->0->'can_reconcile')='false';
 begin perform learn_operator_phone_reconcile(pg_temp.fixture_id(1),pg_temp.fixture_id(903),pg_temp.fixture_id(800),pg_temp.fixture_id(108),'Paused');raise exception 'Paused publish';exception when sqlstate 'PT409' then assert SQLERRM='learn_capture_paused';end;
end$$;reset role;update feature_flags set value='true' where tenant_id=pg_temp.fixture_id(1);
update phone_recordings set storage_path='changed-source.wav' where id=pg_temp.fixture_id(5);
set local role authenticated;do $$begin
 begin perform learn_operator_phone_reconcile(pg_temp.fixture_id(1),pg_temp.fixture_id(903),pg_temp.fixture_id(800),pg_temp.fixture_id(108),'Changed source');raise exception 'Changed source published';exception when sqlstate 'PT409' then assert SQLERRM='phone_attempt_source_changed';end;
end$$;reset role;update phone_recordings set storage_path='original.wav' where id=pg_temp.fixture_id(5);
set local role authenticated;select learn_operator_phone_reconcile(pg_temp.fixture_id(1),pg_temp.fixture_id(904),pg_temp.fixture_id(800),pg_temp.fixture_id(108),'Verified unchanged source');reset role;
set local role service_role;select pg_temp.fixture_derived(109,'claim');select pg_temp.fixture_derived(109,'dispatch');select pg_temp.fixture_derived(109,'fail','{"code":"processing_unconfirmed"}');reset role;
set local role authenticated;do $$begin
 begin perform learn_operator_phone_reconcile(pg_temp.fixture_id(1),pg_temp.fixture_id(905),pg_temp.fixture_id(800),pg_temp.fixture_id(109),'Unknown paid outcome');raise exception 'Unknown request released';exception when sqlstate 'PT409' then assert SQLERRM='phone_saved_result_unavailable';end;
end$$;reset role;
update platform_authority_grants set effective_to=now()-interval '1 second' where profile_id=pg_temp.fixture_id(800);
set local role authenticated;do $$begin
 begin perform learn_operator_phone_reconcile(pg_temp.fixture_id(1),pg_temp.fixture_id(900),pg_temp.fixture_id(800),pg_temp.fixture_id(107),'Synthetic review','check');raise exception 'Revoked actor checked receipt';exception when insufficient_privilege then null;end;
end$$;reset role;
do $$begin
 assert not has_table_privilege('authenticated','learn_phone_operator_reconciliations','select');
 assert not has_function_privilege('service_role','learn_operator_phone_reconcile(uuid,uuid,uuid,uuid,text,text)','execute');
 assert not exists(select 1 from learn_phone_operator_reconciliations where id in(pg_temp.fixture_id(901),pg_temp.fixture_id(903),pg_temp.fixture_id(905)));
 assert (select state from learn_phone_processing_attempts where run_id=pg_temp.fixture_id(109))='needs_review';
end$$;

-- Release only the offline fixture hold before the separate concurrency test.
update learn_phone_processing_attempts set state='failed' where run_id=pg_temp.fixture_id(109);

update platform_authority_grants set effective_to=now()+interval '1 hour' where profile_id=pg_temp.fixture_id(800);
set local role service_role;select pg_temp.fixture_derived(110,'claim');select pg_temp.fixture_derived(110,'dispatch');select pg_temp.fixture_derived(110,'prepare');reset role;
create function pg_temp.fixture_operator_audit_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic audit failure' using errcode='P0002';end$$;
create trigger fixture_operator_audit_failure before insert on learn_phone_operator_reconciliations for each row when(new.id=pg_temp.fixture_id(906)) execute function pg_temp.fixture_operator_audit_failure();
set local role authenticated;do $$begin
 begin perform learn_operator_phone_reconcile(pg_temp.fixture_id(1),pg_temp.fixture_id(906),pg_temp.fixture_id(800),pg_temp.fixture_id(110),'Atomic audit');raise exception 'Partial publication admitted';exception when sqlstate 'P0002' then null;end;
end$$;reset role;
do $$begin
 assert not exists(select 1 from learn_phone_result_versions where run_id=pg_temp.fixture_id(110));
 assert (select state from learn_phone_processing_attempts where run_id=pg_temp.fixture_id(110))='prepared';
 assert (select processing_run_id from phone_transcripts where id=pg_temp.fixture_id(6))=pg_temp.fixture_id(108);
end$$;
drop trigger fixture_operator_audit_failure on learn_phone_operator_reconciliations;
set local role authenticated;select learn_operator_phone_reconcile(pg_temp.fixture_id(1),pg_temp.fixture_id(906),pg_temp.fixture_id(800),pg_temp.fixture_id(110),'Atomic audit');reset role;


 