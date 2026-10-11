-- Enclose in an isolated transaction; all sources below are synthetic.
set local plpgsql.check_asserts=on;
create function pg_temp.handoff_id(n integer) returns uuid language sql immutable as $$select ('e36f129a-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.handoff_id(integer) to service_role,authenticated;
insert into tenants(id,slug,display_name,metadata) values(pg_temp.handoff_id(1),'phone-atomic-handoff-probe','Synthetic handoff probe','{"synthetic":true}');
insert into phone_calls(id,tenant_id,provider,provider_call_id,direction,started_at) values(pg_temp.handoff_id(2),pg_temp.handoff_id(1),'simwood','synthetic-atomic-call','IN','2026-10-11T10:00:00Z');
insert into phone_recordings(id,tenant_id,provider,provider_recording_id,provider_call_id,storage_path)
 values(pg_temp.handoff_id(3),pg_temp.handoff_id(1),'simwood','synthetic-atomic-recording','synthetic-atomic-call','synthetic-retained.wav');
insert into phone_transcripts(id,tenant_id,recording_id,status,transcript_text,source_storage_path,source_sha256)
 values(pg_temp.handoff_id(4),pg_temp.handoff_id(1),pg_temp.handoff_id(3),'completed','Synthetic exact transcript','synthetic-retained.wav',repeat('a',64));
insert into phone_ai_insights(id,tenant_id,recording_id,transcript_id,summary,sentiment,source_transcript_sha256)
 values(pg_temp.handoff_id(5),pg_temp.handoff_id(1),pg_temp.handoff_id(3),pg_temp.handoff_id(4),'Synthetic exact analysis','neutral',encode(sha256(convert_to('Synthetic exact transcript','UTF8')),'hex'));
insert into phone_sync_runs(id,tenant_id,provider,sync_type,status,metadata)
 select pg_temp.handoff_id(n),pg_temp.handoff_id(1),'pipeline','pipeline','running',jsonb_build_object('recording_id',pg_temp.handoff_id(3)) from generate_series(100,120)n;
create function pg_temp.handoff(n integer,phase text default 'publish') returns jsonb language sql as $$
 select public.learn_phone_handoff(pg_temp.handoff_id(1),pg_temp.handoff_id(n),pg_temp.handoff_id(3),pg_temp.handoff_id(4),pg_temp.handoff_id(5),phase)$$;
grant execute on function pg_temp.handoff(integer,text) to service_role,authenticated;
set local role service_role;
do $$declare r jsonb;begin
 r:=pg_temp.handoff(100);assert r->>'state'='committed';assert r->>'eventPublished'='true';assert r->>'alreadyEnriched'='false';
 assert pg_temp.handoff(100)=r;assert pg_temp.handoff(100,'inspect')=r;
 begin perform learn_phone_handoff(pg_temp.handoff_id(99),pg_temp.handoff_id(100),pg_temp.handoff_id(3),pg_temp.handoff_id(4),pg_temp.handoff_id(5),'inspect');raise exception 'Foreign receipt accepted';exception when sqlstate 'PT409' then assert SQLERRM='phone_handoff_conflict';end;
 begin perform learn_phone_handoff(pg_temp.handoff_id(1),pg_temp.handoff_id(100),pg_temp.handoff_id(3),pg_temp.handoff_id(99),pg_temp.handoff_id(5),'publish');raise exception 'Changed request accepted';exception when sqlstate 'PT409' then assert SQLERRM='phone_handoff_conflict';end;
 begin perform 1 from learn_phone_handoff_receipts;raise exception 'Raw receipt access accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$declare iid uuid;begin
 select interaction_id into strict iid from learn_phone_handoff_receipts where run_id=pg_temp.handoff_id(100);
 assert (select count(*) from interactions where tenant_id=pg_temp.handoff_id(1))=1;
 assert (select source_version=phone_projection_version(pg_temp.handoff_id(1),pg_temp.handoff_id(2)) from interactions where id=iid);
 assert (select metadata->'phone_handoff'->>'transcriptId' from interactions where id=iid)=pg_temp.handoff_id(4)::text;
 assert (select call_id from phone_ai_insights where id=pg_temp.handoff_id(5))=pg_temp.handoff_id(2);
 assert (select count(*) from platform_events where tenant_id=pg_temp.handoff_id(1) and subject_id=iid and status='pending')=1;
 assert not has_table_privilege('service_role','interactions','insert');
 assert not has_table_privilege('service_role','learn_phone_handoff_receipts','update');
end$$;
-- Existing enrichment and independent metadata survive exact-source replay.
update interactions set processing_status='enriched',metadata=metadata||'{"operator_note":"keep"}' where tenant_id=pg_temp.handoff_id(1);
set local role service_role;
do $$declare r jsonb;begin r:=pg_temp.handoff(101);assert r->>'alreadyEnriched'='true';assert r->>'eventPublished'='false';assert r->'eventId'='null';end$$;
reset role;
-- Changed analysis re-enters downstream processing and coalesces its pending event.
update phone_ai_insights set summary='Synthetic revised analysis' where id=pg_temp.handoff_id(5);
set local role service_role;
do $$declare r jsonb;begin r:=pg_temp.handoff(102);assert r->>'alreadyEnriched'='false';assert r->>'eventPublished'='true';end$$;
reset role;
do $$begin
 assert (select processing_status from interactions where tenant_id=pg_temp.handoff_id(1))='ready';
 assert (select metadata->>'operator_note' from interactions where tenant_id=pg_temp.handoff_id(1))='keep';
 assert (select count(*) from platform_events where tenant_id=pg_temp.handoff_id(1) and status='pending')=1;
end$$;
-- Event failure must roll back canonical changes AND the insight call backfill.
update phone_ai_insights set summary='Must not reach canonical state',call_id=null where id=pg_temp.handoff_id(5);
create function pg_temp.handoff_event_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic event failure' using errcode='P0002';end$$;
create trigger handoff_event_failure before insert or update on platform_events for each row when(new.tenant_id='e36f129a-aaaa-4000-8000-000000000001') execute function pg_temp.handoff_event_failure();
set local role service_role;
do $$begin begin perform pg_temp.handoff(103);raise exception 'Event failure ignored';exception when sqlstate 'P0002' then null;end;end$$;
reset role;
do $$begin
 assert (select summary from interactions where tenant_id=pg_temp.handoff_id(1))='Synthetic revised analysis';
 assert (select call_id from phone_ai_insights where id=pg_temp.handoff_id(5)) is null;
 assert not exists(select 1 from learn_phone_handoff_receipts where run_id=pg_temp.handoff_id(103));
end$$;
drop trigger handoff_event_failure on platform_events;
-- Unknown/mismatched source provenance must not overwrite retained results.
update phone_transcripts set source_storage_path=null where id=pg_temp.handoff_id(4);
set local role service_role;
do $$begin begin perform pg_temp.handoff(104);raise exception 'Unverified source accepted';exception when sqlstate 'PT409' then assert SQLERRM='phone_handoff_source_unverified';end;end$$;
reset role;
update phone_transcripts set source_storage_path='synthetic-retained.wav',transcript_text='Changed after analysis' where id=pg_temp.handoff_id(4);
set local role service_role;
do $$begin begin perform pg_temp.handoff(105);raise exception 'Changed source accepted';exception when sqlstate 'PT409' then assert SQLERRM='phone_handoff_source_changed';end;end$$;
reset role;
update phone_transcripts set transcript_text='Synthetic exact transcript' where id=pg_temp.handoff_id(4);
-- Provider/call mismatch and an older recording cannot replace current context.
savepoint handoff_conflicting_sources;
insert into phone_calls(id,tenant_id,provider,provider_call_id) values(pg_temp.handoff_id(6),pg_temp.handoff_id(1),'different-provider','synthetic-atomic-call');
update phone_ai_insights set call_id=pg_temp.handoff_id(6) where id=pg_temp.handoff_id(5);
set local role service_role;
do $$begin begin perform pg_temp.handoff(108);raise exception 'Wrong provider call accepted';exception when sqlstate 'PT409' then assert SQLERRM='phone_handoff_call_changed';end;end$$;
reset role;
update phone_ai_insights set call_id=pg_temp.handoff_id(2) where id=pg_temp.handoff_id(5);
insert into phone_recordings(id,tenant_id,provider,provider_recording_id,provider_call_id) values(pg_temp.handoff_id(7),pg_temp.handoff_id(1),'simwood','synthetic-newer-recording','synthetic-atomic-call');
insert into phone_ai_insights(id,tenant_id,recording_id,summary,created_at) values(pg_temp.handoff_id(8),pg_temp.handoff_id(1),pg_temp.handoff_id(7),'Newer recording analysis',clock_timestamp()+interval '1 second');
set local role service_role;
do $$begin
 begin perform pg_temp.handoff(109);raise exception 'Older recording overwrote latest analysis';exception when sqlstate 'PT409' then assert SQLERRM='phone_handoff_superseded';end;
 begin perform learn_phone_handoff(pg_temp.handoff_id(99),pg_temp.handoff_id(108),pg_temp.handoff_id(3),pg_temp.handoff_id(4),pg_temp.handoff_id(5),'publish');raise exception 'Foreign publication accepted';exception when sqlstate 'PT409' then assert SQLERRM='phone_handoff_source_changed';end;
end$$;
reset role;
rollback to savepoint handoff_conflicting_sources;
release savepoint handoff_conflicting_sources;
insert into feature_flags(tenant_id,flag,value) values(pg_temp.handoff_id(1),'learn.inputs.phone.enabled','false');
set local role service_role;
do $$begin
 begin perform pg_temp.handoff(106);raise exception 'Paused publication accepted';exception when sqlstate 'PT409' then assert SQLERRM='learn_capture_paused';end;
 assert pg_temp.handoff(100,'inspect')->>'state'='committed';
end$$;
reset role;
set local role authenticated;
do $$begin begin perform pg_temp.handoff(107);raise exception 'Authenticated publication accepted';exception when insufficient_privilege then null;end;end$$;
reset role;
do $$begin
 begin update learn_phone_handoff_receipts set source_fingerprint=repeat('b',64) where run_id=pg_temp.handoff_id(100);raise exception 'Receipt changed';exception when sqlstate '55000' then null;end;
 assert (select count(*) from learn_phone_handoff_receipts where tenant_id=pg_temp.handoff_id(1))=3;
end$$;
