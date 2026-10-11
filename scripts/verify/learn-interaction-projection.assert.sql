-- Synthetic transaction only; caller rolls back or owns an offline database.
set local plpgsql.check_asserts=on;
create function pg_temp.projection_id(n integer) returns uuid language sql immutable as $$select ('ac68d905-cccc-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into tenants(id,slug,display_name,metadata) values(pg_temp.projection_id(1),'projection-synthetic','Synthetic projection','{"synthetic":true}'),(pg_temp.projection_id(2),'projection-foreign','Synthetic foreign','{"synthetic":true}');
create function pg_temp.project_revision(n integer,s text) returns text language plpgsql as $$declare v text;begin
 if s='phone' then select public.learn_projection_revision(public.learn_phone_source_fields(c),case when i.metadata?'phone_handoff' then public.phone_projection_version(c.tenant_id,c.id) else null end) into v
 from public.phone_calls c left join public.interactions i on i.tenant_id=c.tenant_id and i.source_table='phone_calls' and i.source_id=c.id where c.id=pg_temp.projection_id(n);
 else select public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id','')) into v from public.email_messages m where id=pg_temp.projection_id(n);end if;return v;end$$;
create function pg_temp.project(n integer,s text,r integer) returns jsonb language sql as $$select public.learn_project_interaction(pg_temp.projection_id(1),pg_temp.projection_id(r),s,pg_temp.projection_id(n),pg_temp.project_revision(n,s),'publish')$$;
grant execute on function pg_temp.projection_id(integer) to service_role,authenticated;
insert into phone_calls(id,tenant_id,provider,provider_call_id,direction,from_number,to_number,started_at,duration_seconds)
 values(pg_temp.projection_id(10),pg_temp.projection_id(1),'sipcentric','synthetic-other-provider','IN','+441632960000','+441632960001','2026-10-11T10:00:00Z',12);
insert into email_messages(id,tenant_id,provider,provider_message_id,from_email,from_name,to_emails,cc_emails,subject,snippet,direction,received_at)
 values(pg_temp.projection_id(20),pg_temp.projection_id(1),'gmail','synthetic-email','person@example.invalid','Synthetic customer','["office@example.invalid"]','[]','Synthetic subject','Synthetic source preview','inbound','2026-10-11T11:00:00Z');
create temporary table projection_expected as select pg_temp.project_revision(10,'phone') as revision;
grant select on projection_expected to service_role;
set local role service_role;
select learn_project_interaction(pg_temp.projection_id(1),pg_temp.projection_id(100),'phone',pg_temp.projection_id(10),(select revision from projection_expected),'publish');
reset role;
select pg_temp.project(20,'email',101);
do $$declare r jsonb;begin
 assert (select count(*) from interactions where tenant_id=pg_temp.projection_id(1))=2;
 assert (select count(*) from platform_events where tenant_id=pg_temp.projection_id(1) and status='pending')=2;
 assert (select source_connector_id='sipcentric' and summary is null and phone_from='+441632960000' from interactions where source_id=pg_temp.projection_id(10));
 assert (select body_preview='Synthetic source preview' and to_addresses=array['office@example.invalid'] and metadata->'source_projection'->>'accountBinding'='unverified' from interactions where source_id=pg_temp.projection_id(20));
 assert not exists(select 1 from learn_projection_pending(pg_temp.projection_id(1),'all',100));
 select receipt into r from learn_interaction_projection_receipts where request_id=pg_temp.projection_id(100);
 assert learn_project_interaction(pg_temp.projection_id(1),pg_temp.projection_id(100),'phone',pg_temp.projection_id(10),(select revision from projection_expected),'inspect')=r;
 begin perform learn_project_interaction(pg_temp.projection_id(2),pg_temp.projection_id(100),'phone',pg_temp.projection_id(10),(select revision from projection_expected),'inspect');raise exception 'Foreign replay';exception when sqlstate 'PT409' then assert SQLERRM='projection_receipt_conflict';end;
end$$;
-- Source timestamps alone cause no churn; changed source is atomic and preserves attribution/notes.
update phone_calls set updated_at=clock_timestamp() where id=pg_temp.projection_id(10);
do $$begin assert not exists(select 1 from learn_projection_pending(pg_temp.projection_id(1),'all',100));end$$;
update interactions set related_person_id=pg_temp.projection_id(900),metadata=metadata||'{"operator_note":"keep"}',processing_status='enriched' where source_id=pg_temp.projection_id(20);
update platform_events set status='consumed' where subject_id=(select id from interactions where source_id=pg_temp.projection_id(20));
update email_messages set snippet='Revised synthetic preview' where id=pg_temp.projection_id(20);
select pg_temp.project(20,'email',102);
do $$begin
 assert (select body_preview='Revised synthetic preview' and processing_status='ready' and related_person_id=pg_temp.projection_id(900) and metadata->>'operator_note'='keep' from interactions where source_id=pg_temp.projection_id(20));
 assert (select count(*) from platform_events where subject_id=(select id from interactions where source_id=pg_temp.projection_id(20)) and status='pending')=1;
end$$;
-- Event failure leaves the existing canonical revision and its receipt unchanged.
update email_messages set snippet='Must roll back' where id=pg_temp.projection_id(20);
create function pg_temp.projection_event_fail() returns trigger language plpgsql as $$begin raise exception 'Synthetic event failure' using errcode='P0002';end$$;
create trigger projection_event_fail before insert or update on platform_events for each row when(new.tenant_id='ac68d905-cccc-4000-8000-000000000001') execute function pg_temp.projection_event_fail();
do $$begin
 begin perform pg_temp.project(20,'email',103);raise exception 'Ignored event failure';exception when sqlstate 'P0002' then null;end;
 assert (select body_preview from interactions where source_id=pg_temp.projection_id(20))='Revised synthetic preview';
 assert not exists(select 1 from learn_interaction_projection_receipts where request_id=pg_temp.projection_id(103));
end$$;
drop trigger projection_event_fail on platform_events;
-- Foreign edits and unowned legacy content are held; persistent reviews remain visible.
update interactions set body_preview='Manual retained content' where source_id=pg_temp.projection_id(20);
select pg_temp.project(20,'email',104);
do $$begin
 assert (select receipt->>'reason' from learn_interaction_projection_receipts where request_id=pg_temp.projection_id(104))='canonical_fields_changed';
 assert (select body_preview from interactions where source_id=pg_temp.projection_id(20))='Manual retained content';
 assert public.learn_projection_review_count(pg_temp.projection_id(1),'email')=1;
 assert not exists(select 1 from learn_projection_pending(pg_temp.projection_id(1),'email',100));
end$$;
update interactions set metadata='{"operator_note":"legacy"}' where source_id=pg_temp.projection_id(10);
select pg_temp.project(10,'phone',105);
do $$begin assert (select receipt->>'reason' from learn_interaction_projection_receipts where request_id=pg_temp.projection_id(105))='legacy_projection_review';end$$;
-- Verified call analysis remains owned by the atomic phone publisher on repair.
insert into phone_calls(id,tenant_id,provider,provider_call_id,direction,started_at,duration_seconds) values(pg_temp.projection_id(30),pg_temp.projection_id(1),'simwood','synthetic-verified','IN','2026-10-11T12:00:00Z',20);
insert into phone_recordings(id,tenant_id,provider,provider_recording_id,provider_call_id,storage_path) values(pg_temp.projection_id(31),pg_temp.projection_id(1),'simwood','synthetic-verified-recording','synthetic-verified','synthetic.wav');
insert into phone_transcripts(id,tenant_id,recording_id,status,transcript_text,source_storage_path,source_sha256) values(pg_temp.projection_id(32),pg_temp.projection_id(1),pg_temp.projection_id(31),'completed','Synthetic linked transcript','synthetic.wav',repeat('a',64));
insert into phone_ai_insights(id,tenant_id,recording_id,transcript_id,summary,source_transcript_sha256) values(pg_temp.projection_id(33),pg_temp.projection_id(1),pg_temp.projection_id(31),pg_temp.projection_id(32),'Verified synthetic analysis',encode(sha256(convert_to('Synthetic linked transcript','UTF8')),'hex'));
insert into phone_sync_runs(id,tenant_id,provider,sync_type,status,metadata) values(pg_temp.projection_id(34),pg_temp.projection_id(1),'pipeline','pipeline','running',jsonb_build_object('recording_id',pg_temp.projection_id(31)));
select learn_phone_handoff(pg_temp.projection_id(1),pg_temp.projection_id(34),pg_temp.projection_id(31),pg_temp.projection_id(32),pg_temp.projection_id(33),'publish');
update interactions set processing_status='enriched',related_person_id=pg_temp.projection_id(901),metadata=metadata||'{"operator_note":"preserve verified"}' where source_id=pg_temp.projection_id(30);
update platform_events set status='consumed' where subject_id=(select id from interactions where source_id=pg_temp.projection_id(30));
update phone_calls set duration_seconds=45 where id=pg_temp.projection_id(30);
select pg_temp.project(30,'phone',106);
do $$begin
 assert (select receipt->>'action' from learn_interaction_projection_receipts where request_id=pg_temp.projection_id(106))='authoritative_phone_refresh';
 assert (select summary='Verified synthetic analysis' and metadata?'phone_handoff' and metadata->>'operator_note'='preserve verified' and metadata->>'duration_seconds'='45' and related_person_id=pg_temp.projection_id(901) and processing_status='ready' from interactions where source_id=pg_temp.projection_id(30));
 assert (select status='success' and metadata->>'repair_only'='true' from phone_sync_runs where id=pg_temp.projection_id(106));
 assert not exists(select 1 from learn_projection_pending(pg_temp.projection_id(1),'phone',100) where source_id=pg_temp.projection_id(30));
 assert (select count(*) from phone_transcripts where tenant_id=pg_temp.projection_id(1))=1;
 assert (select count(*) from phone_ai_insights where tenant_id=pg_temp.projection_id(1))=1;
end$$;
-- Pause rejects new writes, but historical receipts remain inspectable.
insert into feature_flags(tenant_id,flag,value) values(pg_temp.projection_id(1),'learn.inputs.phone.enabled','false');
do $$begin
 begin perform pg_temp.project(30,'phone',107);raise exception 'Paused publication accepted';exception when sqlstate 'PT409' then assert SQLERRM='learn_capture_paused';end;
 assert learn_project_interaction(pg_temp.projection_id(1),pg_temp.projection_id(100),'phone',pg_temp.projection_id(10),(select revision from projection_expected),'inspect')->>'state'='committed';
end$$;
set local role authenticated;
do $$begin begin perform public.learn_projection_pending(pg_temp.projection_id(1),'all',20);raise exception 'Authenticated projection access';exception when insufficient_privilege then null;end;end$$;
reset role;
set local role service_role;
do $$begin begin perform 1 from learn_interaction_projection_receipts;raise exception 'Raw receipt access';exception when insufficient_privilege then null;end;end$$;
reset role;
