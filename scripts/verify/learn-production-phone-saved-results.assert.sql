-- Actual production schema, isolated synthetic owner identity.
-- Every fixture and change is rolled back by the caller. No password or session.
create function pg_temp.saved_result_id(n int) returns uuid language sql immutable as $$select ('fbf019ce-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.saved_result_id(int) to authenticated;
insert into tenants(id,slug,display_name) values(pg_temp.saved_result_id(1),'saved-results-rollback-a','Synthetic rollback A'),(pg_temp.saved_result_id(2),'saved-results-rollback-b','Synthetic rollback B');
insert into auth.users(id,email,banned_until) values(pg_temp.saved_result_id(10),'saved-results-rollback-owner@example.invalid','infinity'),(pg_temp.saved_result_id(11),'saved-results-rollback-viewer@example.invalid','infinity');
insert into profiles(id,tenant_id,role) values(pg_temp.saved_result_id(10),pg_temp.saved_result_id(1),'owner'),(pg_temp.saved_result_id(11),pg_temp.saved_result_id(1),'viewer') on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into phone_recordings(id,tenant_id,provider,provider_recording_id,storage_path) values
 (pg_temp.saved_result_id(20),pg_temp.saved_result_id(1),'simwood','saved-fixture','synthetic/one.wav'),
 (pg_temp.saved_result_id(21),pg_temp.saved_result_id(2),'simwood','foreign-fixture','foreign/private.wav');
insert into phone_sync_runs(id,tenant_id,provider,sync_type,status) values(pg_temp.saved_result_id(30),pg_temp.saved_result_id(1),'openai','transcription','success');
insert into phone_transcripts(id,tenant_id,recording_id,status,transcript_text,source_storage_path,source_sha256,processing_run_id) values
 (pg_temp.saved_result_id(40),pg_temp.saved_result_id(1),pg_temp.saved_result_id(20),'completed',repeat('🙂',12005),'synthetic/one.wav',repeat('a',64),pg_temp.saved_result_id(30)),
 (pg_temp.saved_result_id(41),pg_temp.saved_result_id(2),pg_temp.saved_result_id(21),'completed','FOREIGN SECRET',null,null,null);
insert into learn_phone_result_versions(run_id,tenant_id,recording_id,stage,result_id,source,result) values
 (pg_temp.saved_result_id(30),pg_temp.saved_result_id(1),pg_temp.saved_result_id(20),'transcription',pg_temp.saved_result_id(40),'{"storagePath":"synthetic/one.wav"}',jsonb_build_object('text',repeat('🙂',12005)));
insert into phone_ai_insights(id,tenant_id,recording_id,transcript_id,summary,source_transcript_sha256) values
 (pg_temp.saved_result_id(50),pg_temp.saved_result_id(1),pg_temp.saved_result_id(20),pg_temp.saved_result_id(40),'SYNTHETIC SUMMARY',encode(sha256(convert_to(repeat('🙂',12005),'UTF8')),'hex'));
set local request.jwt.claim.sub='fbf019ce-aaaa-4000-8000-000000000010';set local role authenticated;
do $$declare p jsonb;q jsonb;begin
 p:=public.learn_phone_saved_results_read(pg_temp.saved_result_id(1),pg_temp.saved_result_id(20));
 assert p->'transcript'->>'freshness'='source_matched';assert p->'analysis'->>'freshness'='source_matched';
 assert length(p->'transcript'->>'text')=12000;assert (p->'transcript'->>'next_offset')::int=12000;
 q:=public.learn_phone_saved_results_read(pg_temp.saved_result_id(1),pg_temp.saved_result_id(20),12000,p->'transcript'->>'sha256');
 assert length(q->'transcript'->>'text')=5;assert q->'transcript'->'next_offset'='null';
 assert not(p::text like '%one.wav%') and not(p::text like '%source_storage_path%');
 assert public.learn_phone_saved_results_read(pg_temp.saved_result_id(1),pg_temp.saved_result_id(21))->'source_available'='false';
 begin perform public.learn_phone_saved_results_read(pg_temp.saved_result_id(2),pg_temp.saved_result_id(21));raise exception 'Foreign tenant exposed';exception when insufficient_privilege then null;end;
 begin perform public.learn_phone_saved_results_read(pg_temp.saved_result_id(1),pg_temp.saved_result_id(20),12000,repeat('b',64));raise exception 'Changed page accepted';exception when sqlstate 'PT409' then null;end;
 begin perform public.learn_phone_saved_results_read(pg_temp.saved_result_id(1),pg_temp.saved_result_id(20),1);raise exception 'Unbound page accepted';exception when invalid_parameter_value then null;end;
end$$;reset role;
update phone_recordings set storage_path='synthetic/replaced.wav' where id=pg_temp.saved_result_id(20);
set local role authenticated;
do $$declare p jsonb;begin
 p:=public.learn_phone_saved_results_read(pg_temp.saved_result_id(1),pg_temp.saved_result_id(20));
 assert p->'transcript'->>'freshness'='stale' and p->'analysis'->>'freshness'='stale';assert length(p->'transcript'->>'text')=12000;
end$$;reset role;
update phone_recordings set storage_path='synthetic/one.wav' where id=pg_temp.saved_result_id(20);
update phone_transcripts set source_storage_path=null,source_sha256=null,processing_run_id=null where id=pg_temp.saved_result_id(40);
set local role authenticated;
do $$declare p jsonb;begin
 p:=public.learn_phone_saved_results_read(pg_temp.saved_result_id(1),pg_temp.saved_result_id(20));
 assert p->'transcript'->>'freshness'='unverified' and p->'analysis'->>'freshness'='unverified';
end$$;reset role;
update phone_transcripts set transcript_text='Changed transcript' where id=pg_temp.saved_result_id(40);
set local role authenticated;
do $$begin assert public.learn_phone_saved_results_read(pg_temp.saved_result_id(1),pg_temp.saved_result_id(20))->'analysis'->>'freshness'='stale';end$$;reset role;
update profiles set role='viewer' where id=pg_temp.saved_result_id(10);
set local role authenticated;
do $$begin begin perform public.learn_phone_saved_results_read(pg_temp.saved_result_id(1),pg_temp.saved_result_id(20));raise exception 'Demoted caller read';exception when insufficient_privilege then null;end;end$$;reset role;
do $$begin
 assert not has_function_privilege('anon','public.learn_phone_saved_results_read(uuid,uuid,integer,text)','execute');
 assert not has_function_privilege('service_role','public.learn_phone_saved_results_read(uuid,uuid,integer,text)','execute');
 assert not has_table_privilege('authenticated','public.learn_phone_result_versions','select');
end$$;
select 'PASS: saved results paginate Unicode, guard changed transcripts, retain stale and historical evidence, hide pointers and deny foreign/demoted callers';
