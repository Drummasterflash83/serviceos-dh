-- Actual production schema; synthetic download metadata, no audio or provider call.
create function pg_temp.fixture_id(n int) returns uuid language sql immutable as $$select ('fae019ce-908a-4f0f-971b-'||lpad(n::text,12,'0'))::uuid$$;
insert into tenants(id,slug,display_name) select pg_temp.fixture_id(n),'production-download-'||n,'Synthetic download probe' from generate_series(1,2)n;
insert into tenant_connectors(id,tenant_id,connector_id,provider,category,status,enabled) values(pg_temp.fixture_id(3),pg_temp.fixture_id(1),'simwood','simwood','phone','active',true);
insert into connector_accounts(id,tenant_id,tenant_connector_id,account_key,status) values(pg_temp.fixture_id(4),pg_temp.fixture_id(1),pg_temp.fixture_id(3),'3950','active');
insert into phone_recordings(id,tenant_id,provider,provider_recording_id,storage_path) values(pg_temp.fixture_id(5),pg_temp.fixture_id(1),'simwood','retained','original.wav');
insert into phone_sync_runs(id,tenant_id,provider,sync_type,metadata) select pg_temp.fixture_id(n),pg_temp.fixture_id(1),'simwood','recording_download',jsonb_build_object('recording_id',pg_temp.fixture_id(5)) from generate_series(10,40)n;
create function pg_temp.fixture_download(n int,phase text,data jsonb default null) returns jsonb language sql as $$
 select learn_phone_download_attempt(pg_temp.fixture_id(1),pg_temp.fixture_id(n),pg_temp.fixture_id(5),phase,coalesce(data,
 case when phase='claim' then jsonb_build_object('accountId',pg_temp.fixture_id(4),'connectorId',pg_temp.fixture_id(3),'customerId','3950','source',
 jsonb_build_object('providerRecordingId',r.provider_recording_id,'recordingUri',r.recording_uri,'storagePath',r.storage_path,'fileSize',r.file_size))
 else jsonb_build_object('storagePath',pg_temp.fixture_id(1)||'/simwood/recordings/versions/'||pg_temp.fixture_id(5)||'/'||pg_temp.fixture_id(n)||'.wav','sha256',repeat('a',64),'bytes',3) end))
 from phone_recordings r where id=pg_temp.fixture_id(5);$$;
do $$declare f record;begin for f in select oid::regprocedure as signature from pg_proc where pronamespace=pg_my_temp_schema() and proname like 'fixture_%' loop execute format('grant execute on function %s to service_role',f.signature);end loop;end$$;set local role service_role;
do $$declare c jsonb;p jsonb;r jsonb;begin
 c:=pg_temp.fixture_download(10,'claim');assert c->>'state'='running';assert c->'replayed'='false';
 assert pg_temp.fixture_download(10,'claim')->'replayed'='true';
 begin perform pg_temp.fixture_download(11,'claim');raise exception 'Overlap accepted';exception when sqlstate 'PT409' then assert SQLERRM='phone_recording_processing_held';end;
 begin perform learn_phone_download_attempt(pg_temp.fixture_id(2),pg_temp.fixture_id(10),pg_temp.fixture_id(5),'claim','{}');raise exception 'Foreign accepted';exception when sqlstate 'PT409' then null;end;
 p:=pg_temp.fixture_download(10,'prepare');assert p->>'state'='prepared';assert pg_temp.fixture_download(10,'prepare')->'replayed'='true';
 begin perform pg_temp.fixture_download(10,'prepare',(p->'prepared')||'{"bytes":4}');raise exception 'Output changed';exception when sqlstate 'PT409' then null;end;
 assert (select storage_path from phone_recordings where id=pg_temp.fixture_id(5))='original.wav';
 r:=pg_temp.fixture_download(10,'complete');assert r->>'state'='succeeded';assert r->>'previousStoragePath'='original.wav';assert pg_temp.fixture_download(10,'complete')=r;
 assert (select status from phone_sync_runs where id=pg_temp.fixture_id(10))='success';
 assert (select storage_path from phone_recordings where id=pg_temp.fixture_id(5))=r->'prepared'->>'storagePath';
end$$;
reset role;
select 'PASS: exclusive claim, exact replay, immutable output definition, tenant checks and atomic publication';
do $$declare f record;begin for f in select oid::regprocedure as signature from pg_proc where pronamespace=pg_my_temp_schema() and proname like 'fixture_%' loop execute format('grant execute on function %s to service_role',f.signature);end loop;end$$;set local role service_role;
do $$begin
 perform pg_temp.fixture_download(11,'claim');perform pg_temp.fixture_download(11,'prepare');
 assert pg_temp.fixture_download(11,'fail','{"code":"storage_unconfirmed"}')->>'state'='needs_review';
 begin perform pg_temp.fixture_download(12,'claim');raise exception 'Held attempt replaced';exception when sqlstate 'PT409' then assert SQLERRM='phone_recording_processing_held';end;
end$$;
reset role;
update learn_phone_processing_attempts set review_after=clock_timestamp()-interval '1 day' where run_id=pg_temp.fixture_id(11);
do $$declare f record;begin for f in select oid::regprocedure as signature from pg_proc where pronamespace=pg_my_temp_schema() and proname like 'fixture_%' loop execute format('grant execute on function %s to service_role',f.signature);end loop;end$$;set local role service_role;
do $$begin
 begin perform pg_temp.fixture_download(12,'claim');raise exception 'Expired attempt stolen';exception when sqlstate 'PT409' then assert SQLERRM='phone_recording_processing_held';end;
 assert (select retry_state from phone_pending_readiness(pg_temp.fixture_id(1)) where recording_id=pg_temp.fixture_id(5))='needs_review';
 assert not exists(select 1 from phone_select_pending(pg_temp.fixture_id(1)));
 assert pg_temp.fixture_download(11,'complete')->>'state'='succeeded';
 perform pg_temp.fixture_download(12,'claim');assert pg_temp.fixture_download(12,'fail','{"code":"provider_timeout"}')->>'state'='failed';
 perform pg_temp.fixture_download(13,'claim');
end$$;
reset role;
select 'PASS: uncertain upload stays held after expiry; owner can reconcile; known pre-upload failure releases';
update phone_recordings set file_size=99 where id=pg_temp.fixture_id(5);
do $$declare f record;begin for f in select oid::regprocedure as signature from pg_proc where pronamespace=pg_my_temp_schema() and proname like 'fixture_%' loop execute format('grant execute on function %s to service_role',f.signature);end loop;end$$;set local role service_role;
do $$begin begin perform pg_temp.fixture_download(13,'prepare');raise exception 'Source change accepted';exception when sqlstate 'PT409' then assert SQLERRM='phone_attempt_source_changed';end;end$$;
reset role;
update phone_recordings set file_size=null where id=pg_temp.fixture_id(5);
insert into feature_flags(tenant_id,flag,value) values(pg_temp.fixture_id(1),'learn.inputs.phone.enabled','false');
do $$declare f record;begin for f in select oid::regprocedure as signature from pg_proc where pronamespace=pg_my_temp_schema() and proname like 'fixture_%' loop execute format('grant execute on function %s to service_role',f.signature);end loop;end$$;set local role service_role;
do $$begin
 begin perform pg_temp.fixture_download(13,'prepare');raise exception 'Paused preparation accepted';exception when sqlstate 'PT409' then assert SQLERRM='learn_capture_paused';end;
 assert pg_temp.fixture_download(10,'complete')->>'state'='succeeded';
end$$;
reset role;update feature_flags set value='true' where tenant_id=pg_temp.fixture_id(1) and flag='learn.inputs.phone.enabled';
do $$declare f record;begin for f in select oid::regprocedure as signature from pg_proc where pronamespace=pg_my_temp_schema() and proname like 'fixture_%' loop execute format('grant execute on function %s to service_role',f.signature);end loop;end$$;set local role service_role;
do $$begin
 perform pg_temp.fixture_download(13,'prepare');
 assert pg_temp.fixture_download(13,'inspect','{}')->>'state'='prepared';
 begin perform pg_temp.fixture_download(14,'inspect','{}');raise exception 'Missing attempt accepted';exception when sqlstate 'PT409' then assert SQLERRM='phone_attempt_missing';end;
end$$;reset role;
update connector_accounts set status='paused' where id=pg_temp.fixture_id(4);
do $$declare f record;begin for f in select oid::regprocedure as signature from pg_proc where pronamespace=pg_my_temp_schema() and proname like 'fixture_%' loop execute format('grant execute on function %s to service_role',f.signature);end loop;end$$;set local role service_role;
do $$begin
 begin perform pg_temp.fixture_download(13,'complete');raise exception 'Disabled account published';exception when sqlstate 'PT409' then assert SQLERRM='phone_account_unavailable';end;
 assert pg_temp.fixture_download(10,'complete')->>'state'='succeeded';
end$$;reset role;
update connector_accounts set status='active' where id=pg_temp.fixture_id(4);
update feature_flags set value='false' where tenant_id=pg_temp.fixture_id(1) and flag='learn.inputs.phone.enabled';
do $$declare f record;begin for f in select oid::regprocedure as signature from pg_proc where pronamespace=pg_my_temp_schema() and proname like 'fixture_%' loop execute format('grant execute on function %s to service_role',f.signature);end loop;end$$;set local role service_role;
do $$begin
 assert pg_temp.fixture_download(13,'inspect','{}')->>'state'='prepared';
 begin perform pg_temp.fixture_download(13,'complete');raise exception 'Paused publication accepted';exception when sqlstate 'PT409' then assert SQLERRM='learn_capture_paused';end;
end$$;reset role;
update feature_flags set value='true' where tenant_id=pg_temp.fixture_id(1) and flag='learn.inputs.phone.enabled';
update phone_recordings set file_size=101 where id=pg_temp.fixture_id(5);
do $$declare f record;begin for f in select oid::regprocedure as signature from pg_proc where pronamespace=pg_my_temp_schema() and proname like 'fixture_%' loop execute format('grant execute on function %s to service_role',f.signature);end loop;end$$;set local role service_role;
do $$begin
 begin perform pg_temp.fixture_download(13,'complete');raise exception 'Changed source published';exception when sqlstate 'PT409' then assert SQLERRM='phone_attempt_source_changed';end;
end$$;reset role;
update phone_recordings set file_size=null where id=pg_temp.fixture_id(5);

create function pg_temp.fixture_download_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic atomicity failure' using errcode='P0002';end$$;
create trigger fixture_download_failure before update on learn_phone_processing_attempts for each row when(new.state='succeeded') execute function pg_temp.fixture_download_failure();
do $$declare f record;begin for f in select oid::regprocedure as signature from pg_proc where pronamespace=pg_my_temp_schema() and proname like 'fixture_%' loop execute format('grant execute on function %s to service_role',f.signature);end loop;end$$;set local role service_role;
do $$declare prior text;begin
 select storage_path into prior from phone_recordings where id=pg_temp.fixture_id(5);
 begin perform pg_temp.fixture_download(13,'complete');raise exception 'Partial completion accepted';exception when sqlstate 'P0002' then null;end;
 assert (select storage_path from phone_recordings where id=pg_temp.fixture_id(5))=prior;
 assert (select status from phone_sync_runs where id=pg_temp.fixture_id(13))='running';
end$$;
reset role;drop trigger fixture_download_failure on learn_phone_processing_attempts;
do $$declare f record;begin for f in select oid::regprocedure as signature from pg_proc where pronamespace=pg_my_temp_schema() and proname like 'fixture_%' loop execute format('grant execute on function %s to service_role',f.signature);end loop;end$$;set local role service_role;do $$begin perform pg_temp.fixture_download(13,'complete');end$$;reset role;
do $$begin
 assert not has_table_privilege('authenticated','learn_phone_processing_attempts','select');
 assert not has_table_privilege('service_role','learn_phone_processing_attempts','update');
 assert not has_function_privilege('authenticated','learn_phone_download_attempt(uuid,uuid,uuid,text,jsonb)','execute');
 assert has_function_privilege('service_role','learn_phone_download_attempt(uuid,uuid,uuid,text,jsonb)','execute');
end$$;
select 'PASS: pause, changed source, atomic rollback and restricted privileges';
