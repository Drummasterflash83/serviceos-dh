-- Synthetic identities only; caller runs inside a transaction and rolls back.
set local plpgsql.check_asserts=on;
create function pg_temp.icid(n integer) returns uuid language sql immutable as $$select ('ef891b32-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into tenants(id,slug,display_name) values(pg_temp.icid(1),'identity-continue-a','Synthetic identity continuation'),(pg_temp.icid(2),'identity-continue-b','Synthetic isolation');
create function pg_temp.icjob(n integer) returns void language sql as $$
 insert into platform_jobs(id,tenant_id,job_type,job_key,status,claimed_by,attempt_count,max_attempts,lease_expires_at,payload)
 values(pg_temp.icid(n),pg_temp.icid(1),'identity.resolve','synthetic-identity-'||n,'running','identity-test-worker',1,5,clock_timestamp()+interval '5 minutes','{"limit":2}');
$$;
create function pg_temp.icsource(n integer,direction text) returns void language sql as $$
 insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,phone_from,phone_to,summary,processing_status)
 values(pg_temp.icid(n),pg_temp.icid(1),'simwood','phone','phone_calls',pg_temp.icid(n+1000),'phone_call',direction,'2026-10-11T10:00:00Z','+441632960100','+441632960101','Synthetic input','ready');
 insert into platform_events(tenant_id,event_type,subject_type,subject_id,status,payload)
 values(pg_temp.icid(1),'interaction.ready','interaction',pg_temp.icid(n),'pending','{}');
$$;
create function pg_temp.icpublish(j integer,n integer) returns jsonb language sql as $$
 select learn_processing_publish(pg_temp.icid(1),pg_temp.icid(j),'identity-test-worker',1,pg_temp.icid(j*100+n),'identity',i.id,learn_identity_revision(i),'publish') from interactions i where id=pg_temp.icid(n);
$$;
create function pg_temp.icdef(resolved integer,held integer,continued boolean default true) returns jsonb language sql as $$
 select jsonb_build_object('success',false,'records_processed',resolved,'result',jsonb_build_object('resolved',resolved,'reviews_recorded',held,'review_required',5,'failed',0,'continued',continued),'continue',continued,'retryable',false,'error_code','identity_review_required');
$$;
select pg_temp.icjob(n) from generate_series(10,17)n;
select pg_temp.icsource(n,'internal') from generate_series(100,114)n;
select pg_temp.icsource(115,'inbound');
-- All-held batch: the next eligible source stays unprocessed, old events stay pending.
select pg_temp.icpublish(10,100),pg_temp.icpublish(10,101);
create temporary table ic_receipts(j integer,r jsonb);
insert into ic_receipts values(10,learn_processing_settle(pg_temp.icid(1),pg_temp.icid(10),'identity-test-worker',1,pg_temp.icid(5010),pg_temp.icdef(0,2),'settle'));
do $$declare r jsonb;begin
 select x.r into r from ic_receipts x where j=10;
 assert r->>'state'='dead_letter' and r->>'continuation_job_id' is not null;
 assert (select status='dead_letter' and error_code='identity_review_required' and completed_at is null and records_processed=0 from platform_jobs where id=pg_temp.icid(10));
 assert (select parent_job_id=pg_temp.icid(10) and status='queued' and payload='{"limit":2}' from platform_jobs where id=(r->>'continuation_job_id')::uuid);
 assert (select count(*)=2 from interactions where id in(pg_temp.icid(100),pg_temp.icid(101)) and processing_status='identity_review' and related_person_id is null);
 assert (select count(*)=2 from platform_events where subject_id in(pg_temp.icid(100),pg_temp.icid(101)) and status='pending');
 assert not exists(select 1 from learn_identity_pending(pg_temp.icid(1),50) where interaction_id in(pg_temp.icid(100),pg_temp.icid(101)));
 assert exists(select 1 from learn_identity_pending(pg_temp.icid(1),50) where interaction_id=pg_temp.icid(102));
 assert learn_processing_settle(pg_temp.icid(1),pg_temp.icid(10),'identity-test-worker',1,pg_temp.icid(5010),pg_temp.icdef(0,2),'inspect')=r;
 assert learn_processing_settle(pg_temp.icid(1),pg_temp.icid(10),'identity-test-worker',1,pg_temp.icid(5010),pg_temp.icdef(0,2),'settle')=r;
 assert (select count(*)=1 from platform_jobs where parent_job_id=pg_temp.icid(10));
end$$;
-- Mixed success/hold: only committed cards count; same active child reused.
select pg_temp.icpublish(11,102),pg_temp.icpublish(11,115);
insert into ic_receipts values(11,learn_processing_settle(pg_temp.icid(1),pg_temp.icid(11),'identity-test-worker',1,pg_temp.icid(5011),pg_temp.icdef(1,1),'settle'));
do $$begin
 assert (select records_processed=1 and status='dead_letter' from platform_jobs where id=pg_temp.icid(11));
 assert (select processing_status='enriched' from interactions where id=pg_temp.icid(115));
 assert (select r->>'continuation_job_id' from ic_receipts where j=10)=(select r->>'continuation_job_id' from ic_receipts where j=11);
end$$;
-- Short batch cannot claim enough progress to continue; it can settle review-only.
select pg_temp.icpublish(12,103);
do $$begin
 begin perform learn_processing_settle(pg_temp.icid(1),pg_temp.icid(12),'identity-test-worker',1,pg_temp.icid(5012),pg_temp.icdef(0,1),'settle');raise exception 'Short batch continued';exception when sqlstate 'PT409' then assert sqlerrm='processing_review_continuation_unconfirmed';end;
 assert (select status='running' from platform_jobs where id=pg_temp.icid(12));
 assert learn_processing_settle(pg_temp.icid(1),pg_temp.icid(12),'identity-test-worker',1,pg_temp.icid(5012),pg_temp.icdef(0,1,false),'settle')->>'continuation_job_id' is null;
end$$;
-- Missing/incorrect proof, foreign tenant, non-review failure and wrong job type.
select pg_temp.icpublish(13,104),pg_temp.icpublish(13,105);
do $$declare d jsonb;begin
 foreach d in array array[
  pg_temp.icdef(0,1),
  jsonb_set(pg_temp.icdef(0,2),'{result,failed}','1'),
  jsonb_set(pg_temp.icdef(0,2),'{result,review_required}','0'),
  jsonb_set(pg_temp.icdef(0,2),'{result,resolved}','1'),
  jsonb_set(pg_temp.icdef(0,2),'{error_code}','"identity_delivery_unconfirmed"'),
  jsonb_set(pg_temp.icdef(0,2),'{retryable}','true')
 ] loop
  begin perform learn_processing_settle(pg_temp.icid(1),pg_temp.icid(13),'identity-test-worker',1,pg_temp.icid(5013),d,'settle');raise exception 'Invalid continuation accepted';exception when sqlstate 'PT409' or invalid_parameter_value then null;end;
 end loop;
 begin perform learn_processing_settle(pg_temp.icid(2),pg_temp.icid(13),'identity-test-worker',1,pg_temp.icid(5013),pg_temp.icdef(0,2),'settle');raise exception 'Foreign claim';exception when sqlstate 'PT409' then assert sqlerrm='processing_claim_lost';end;
end$$;
update platform_jobs set job_type='interactions.sync' where id=pg_temp.icid(13);
do $$begin begin perform learn_processing_settle(pg_temp.icid(1),pg_temp.icid(13),'identity-test-worker',1,pg_temp.icid(5013),pg_temp.icdef(0,2),'settle');raise exception 'Wrong type';exception when sqlstate 'PT409' or invalid_parameter_value then null;end;end$$;
-- The same source cannot be counted twice via different publication requests.
select pg_temp.icpublish(14,106);
select learn_processing_publish(pg_temp.icid(1),pg_temp.icid(14),'identity-test-worker',1,pg_temp.icid(9014),'identity',i.id,learn_identity_revision(i),'publish') from interactions i where id=pg_temp.icid(106);
do $$begin begin perform learn_processing_settle(pg_temp.icid(1),pg_temp.icid(14),'identity-test-worker',1,pg_temp.icid(5014),pg_temp.icdef(0,2),'settle');raise exception 'Duplicate source counted';exception when sqlstate 'PT409' then assert sqlerrm='processing_review_continuation_unconfirmed';end;end$$;
-- Reopened source or lost claim cannot create a continuation.
select pg_temp.icpublish(15,107),pg_temp.icpublish(15,108);
update interactions set processing_status='ready' where id=pg_temp.icid(108);
do $$begin begin perform learn_processing_settle(pg_temp.icid(1),pg_temp.icid(15),'identity-test-worker',1,pg_temp.icid(5015),pg_temp.icdef(0,2),'settle');raise exception 'Reopened hold';exception when sqlstate 'PT409' then assert sqlerrm='processing_review_continuation_unconfirmed';end;end$$;
update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.icid(15);
do $$begin begin perform learn_processing_settle(pg_temp.icid(1),pg_temp.icid(15),'identity-test-worker',1,pg_temp.icid(5015),pg_temp.icdef(0,2),'settle');raise exception 'Lost claim';exception when sqlstate 'PT409' then assert sqlerrm='processing_claim_lost';end;end$$;
-- Audit failure rolls back the terminal state and new child atomically.
update platform_jobs set status='cancelled' where id=(select (r->>'continuation_job_id')::uuid from ic_receipts where j=10);
select pg_temp.icpublish(16,109),pg_temp.icpublish(16,110);
create function pg_temp.ic_fail_audit() returns trigger language plpgsql as $$begin raise exception 'Synthetic audit failure' using errcode='P0002';end$$;
create trigger ic_fail_audit before insert on learn_processing_settlements for each row when(new.request_id='ef891b32-aaaa-4000-8000-000000005016') execute function pg_temp.ic_fail_audit();
do $$begin
 begin perform learn_processing_settle(pg_temp.icid(1),pg_temp.icid(16),'identity-test-worker',1,pg_temp.icid(5016),pg_temp.icdef(0,2),'settle');raise exception 'Lost atomicity';exception when sqlstate 'P0002' then null;end;
 assert (select status='running' from platform_jobs where id=pg_temp.icid(16));
 assert not exists(select 1 from platform_jobs where parent_job_id=pg_temp.icid(16));
 assert not exists(select 1 from learn_processing_settlements where request_id=pg_temp.icid(5016));
 assert not has_function_privilege('authenticated','learn_processing_settle(uuid,uuid,text,integer,uuid,jsonb,text)','execute');
 assert not has_function_privilege('anon','learn_processing_settle(uuid,uuid,text,integer,uuid,jsonb,text)','execute');
end$$;
drop trigger ic_fail_audit on learn_processing_settlements;
