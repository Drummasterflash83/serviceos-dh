-- Caller must roll back all hosted synthetic fixtures.
set local plpgsql.check_asserts=on;
create function pg_temp.pq(n integer) returns uuid language sql immutable as $$select ('dd780923-ffff-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.pq(integer) to service_role,authenticated,anon;
insert into tenants(id,slug,display_name) values(pg_temp.pq(1),'processing-queue-a','Synthetic processing A'),(pg_temp.pq(2),'processing-queue-b','Synthetic processing B');
create function pg_temp.pq_job(n integer,kind text default 'interactions.sync') returns void language sql as $$
 insert into platform_jobs(id,tenant_id,job_type,job_key,status,claimed_by,attempt_count,max_attempts,lease_expires_at,payload)
 values(pg_temp.pq(n),pg_temp.pq(1),kind,'synthetic-processing-'||n,'running','synthetic-worker',1,3,clock_timestamp()+interval '5 minutes','{"source":"email","limit":1}');
$$;
create function pg_temp.pq_source(n integer) returns void language sql as $$
 insert into email_messages(id,tenant_id,provider,provider_message_id,from_email,to_emails,cc_emails,direction,snippet,received_at)
 values(pg_temp.pq(n),pg_temp.pq(1),'gmail','synthetic-queue-'||n,'customer@example.invalid','["office@example.invalid"]','[]','inbound','Synthetic retained input','2026-10-11T17:00:00Z');
$$;
create temporary table pq_args(job integer primary key,source uuid,revision text,kind text);
grant select on pq_args to service_role;
select pg_temp.pq_job(n) from generate_series(20,27)n;
select pg_temp.pq_source(n) from generate_series(100,107)n;
insert into pq_args select n-80,id,learn_projection_revision(learn_email_source_fields(m),''),'email' from email_messages m join generate_series(100,107)n on m.id=pg_temp.pq(n);
create temporary table pq_defs(n integer primary key,definition jsonb);
insert into pq_defs select n,jsonb_build_object('success',true,'records_processed',1,'result',jsonb_build_object('interactions_upserted',1,'failed',0,'review_required',0,'continued',true),'continue',true,'retryable',false,'error_code',null) from generate_series(20,27)n;
grant select on pq_defs to service_role;
set local role service_role;
do $$declare r jsonb;s jsonb;begin
 select learn_processing_publish(pg_temp.pq(1),pg_temp.pq(20),'synthetic-worker',1,pg_temp.pq(1020),kind,source,revision,'publish') into r from pq_args where job=20;
 assert r->>'state'='committed';
 assert r=(select learn_processing_publish(pg_temp.pq(1),pg_temp.pq(20),'synthetic-worker',1,pg_temp.pq(1020),kind,source,revision,'inspect') from pq_args where job=20);
 s:=learn_processing_settle(pg_temp.pq(1),pg_temp.pq(20),'synthetic-worker',1,pg_temp.pq(2020),(select definition from pq_defs where n=20),'settle');
 assert s->>'state'='succeeded' and s->>'continuation_job_id' is not null and s->>'records_processed'='1';
 assert s=learn_processing_settle(pg_temp.pq(1),pg_temp.pq(20),'synthetic-worker',1,pg_temp.pq(2020),(select definition from pq_defs where n=20),'inspect');
 assert s=learn_processing_settle(pg_temp.pq(1),pg_temp.pq(20),'synthetic-worker',1,pg_temp.pq(2020),(select definition from pq_defs where n=20),'settle');
 begin perform learn_processing_settle(pg_temp.pq(2),pg_temp.pq(20),'synthetic-worker',1,pg_temp.pq(2020),(select definition from pq_defs where n=20),'inspect');raise exception 'Foreign receipt';exception when sqlstate 'PT409' then null;end;
end$$;reset role;
do $$begin
 assert (select status='succeeded' and lease_expires_at is null and error_code is null from platform_jobs where id=pg_temp.pq(20));
 assert (select count(*)=1 from platform_jobs where parent_job_id=pg_temp.pq(20));
 assert (select status='queued' and payload='{"source":"email","limit":1}'::jsonb from platform_jobs where parent_job_id=pg_temp.pq(20));
 assert (select snippet='Synthetic retained input' from email_messages where id=pg_temp.pq(100));
end$$;
-- Canonical input proceeds through the fenced identity publisher into one card.
update platform_jobs set job_type='identity.resolve',payload='{"limit":1}' where id=pg_temp.pq(21);
update pq_args set source=i.id,revision=learn_identity_revision(i),kind='identity' from interactions i where pq_args.job=21 and i.tenant_id=pg_temp.pq(1) and i.source_id=pg_temp.pq(100);
update pq_defs set definition='{"success":true,"records_processed":1,"result":{"resolved":1,"review_required":0,"failed":0,"continued":false},"continue":false,"retryable":false,"error_code":null}' where n=21;
set local role service_role;
select learn_processing_publish(pg_temp.pq(1),pg_temp.pq(21),'synthetic-worker',1,pg_temp.pq(1021),kind,source,revision,'publish') from pq_args where job=21;
select learn_processing_settle(pg_temp.pq(1),pg_temp.pq(21),'synthetic-worker',1,pg_temp.pq(2021),(select definition from pq_defs where n=21),'settle');
reset role;
do $$begin assert (select count(*)=1 from customer_cards where tenant_id=pg_temp.pq(1));assert (select processing_status='enriched' from interactions where source_id=pg_temp.pq(100));end$$;
-- Publication succeeded but enqueue failure must not mark the batch complete.
select learn_processing_publish(pg_temp.pq(1),pg_temp.pq(22),'synthetic-worker',1,pg_temp.pq(1022),kind,source,revision,'publish') from pq_args where job=22;
create function pg_temp.pq_fail_child() returns trigger language plpgsql as $$begin raise exception 'Synthetic child failure' using errcode='P0002';end$$;
create trigger pq_fail_child before insert on platform_jobs for each row when(new.parent_job_id='dd780923-ffff-4000-8000-000000000022') execute function pg_temp.pq_fail_child();
do $$begin
 begin perform learn_processing_settle(pg_temp.pq(1),pg_temp.pq(22),'synthetic-worker',1,pg_temp.pq(2022),(select definition from pq_defs where n=22),'settle');raise exception 'Child failure ignored';exception when sqlstate 'P0002' then null;end;
 assert (select status='running' and completed_at is null from platform_jobs where id=pg_temp.pq(22));
 assert not exists(select 1 from learn_processing_settlements where request_id=pg_temp.pq(2022));
end$$;drop trigger pq_fail_child on platform_jobs;
-- Existing equivalent active continuation is reused, never duplicated.
select learn_processing_settle(pg_temp.pq(1),pg_temp.pq(22),'synthetic-worker',1,pg_temp.pq(2022),(select definition from pq_defs where n=22),'settle');
do $$begin
 assert (select count(*)=1 from platform_jobs where tenant_id=pg_temp.pq(1) and job_key='interactions.sync:'||pg_temp.pq(1)::text||':email' and status in('queued','running','retrying'));
 assert (select receipt->>'continuation_job_id' from learn_processing_settlements where request_id=pg_temp.pq(2020))=(select receipt->>'continuation_job_id' from learn_processing_settlements where request_id=pg_temp.pq(2022));
end$$;
-- A former worker cannot publish or settle a newer attempt, another tenant or source.
update platform_jobs set attempt_count=2,claimed_by='replacement-worker' where id=pg_temp.pq(23);
update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.pq(24);
set local role service_role;
do $$declare v_n integer;begin
 foreach v_n in array array[23,24] loop
  begin perform learn_processing_publish(pg_temp.pq(1),pg_temp.pq(v_n),'synthetic-worker',1,pg_temp.pq(v_n+1000),kind,source,revision,'publish') from pq_args where job=v_n;raise exception 'Expired publication';exception when sqlstate 'PT409' then assert SQLERRM='processing_claim_lost';end;
  begin perform learn_processing_settle(pg_temp.pq(1),pg_temp.pq(v_n),'synthetic-worker',1,pg_temp.pq(v_n+2000),(select definition from pq_defs where pq_defs.n=v_n),'settle');raise exception 'Expired settlement';exception when sqlstate 'PT409' then assert SQLERRM='processing_claim_lost';end;
 end loop;
 begin perform learn_processing_publish(pg_temp.pq(2),pg_temp.pq(25),'synthetic-worker',1,pg_temp.pq(1025),kind,source,revision,'publish') from pq_args where job=25;raise exception 'Foreign publication';exception when sqlstate 'PT409' then null;end;
 begin perform learn_processing_publish(pg_temp.pq(1),pg_temp.pq(25),'synthetic-worker',1,pg_temp.pq(1025),'phone',source,revision,'publish') from pq_args where job=25;raise exception 'Wrong source';exception when sqlstate 'PT409' then assert SQLERRM='processing_source_mismatch';end;
end$$;reset role;
-- A late settlement audit failure rolls back terminal status AND the new child.
update platform_jobs set status='cancelled' where parent_job_id=pg_temp.pq(20);
select learn_processing_publish(pg_temp.pq(1),pg_temp.pq(25),'synthetic-worker',1,pg_temp.pq(1025),kind,source,revision,'publish') from pq_args where job=25;
create function pg_temp.pq_fail_audit() returns trigger language plpgsql as $$begin raise exception 'Synthetic settlement audit failure' using errcode='P0002';end$$;
create trigger pq_fail_audit before insert on learn_processing_settlements for each row when(new.request_id='dd780923-ffff-4000-8000-000000002025') execute function pg_temp.pq_fail_audit();
do $$begin
 begin perform learn_processing_settle(pg_temp.pq(1),pg_temp.pq(25),'synthetic-worker',1,pg_temp.pq(2025),(select definition from pq_defs where n=25),'settle');raise exception 'Audit failure ignored';exception when sqlstate 'P0002' then null;end;
 assert (select status='running' from platform_jobs where id=pg_temp.pq(25));assert not exists(select 1 from platform_jobs where parent_job_id=pg_temp.pq(25));
end$$;drop trigger pq_fail_audit on learn_processing_settlements;
-- Unproven success/counts and private result fields cannot enter a job receipt.
do $$begin
 begin perform learn_processing_settle(pg_temp.pq(1),pg_temp.pq(26),'synthetic-worker',1,pg_temp.pq(2026),(select definition from pq_defs where n=26),'settle');raise exception 'Invented processed count';exception when sqlstate 'PT409' then assert SQLERRM='processing_count_unconfirmed';end;
 begin perform learn_processing_settle(pg_temp.pq(1),pg_temp.pq(26),'synthetic-worker',1,pg_temp.pq(2026),(select jsonb_set(definition,'{result,raw_payload}','"PRIVATE"') from pq_defs where n=26),'settle');raise exception 'Private result accepted';exception when invalid_parameter_value then null;end;
end$$;
-- Retry delay is saved; exhausted attempts dead-letter without fabricated success.
update pq_defs set definition='{"success":false,"records_processed":0,"result":{"failed":1},"continue":false,"retryable":true,"error_code":"projection_unconfirmed"}' where n=26;
select learn_processing_settle(pg_temp.pq(1),pg_temp.pq(26),'synthetic-worker',1,pg_temp.pq(2026),(select definition from pq_defs where n=26),'settle');
do $$begin assert (select status='retrying' and error_code='projection_unconfirmed' and available_at>clock_timestamp()+interval '50 seconds' from platform_jobs where id=pg_temp.pq(26));end$$;
update platform_jobs set status='running',attempt_count=3,lease_expires_at=clock_timestamp()+interval '5 minutes' where id=pg_temp.pq(26);
select learn_processing_settle(pg_temp.pq(1),pg_temp.pq(26),'synthetic-worker',3,pg_temp.pq(3026),(select definition from pq_defs where n=26),'settle');
do $$begin
 assert (select status='dead_letter' and dead_lettered_at is not null and lease_expires_at is null from platform_jobs where id=pg_temp.pq(26));
 assert not has_table_privilege('service_role','learn_processing_settlements','insert');assert not has_table_privilege('authenticated','learn_processing_publications','select');
 assert not has_function_privilege('authenticated','learn_processing_publish(uuid,uuid,text,integer,uuid,text,uuid,text,text)','execute');
 assert not has_function_privilege('anon','learn_processing_settle(uuid,uuid,text,integer,uuid,jsonb,text)','execute');
end$$;
-- Publication audit is in the same transaction as the retained-source handoff.
create function pg_temp.pq_fail_publication() returns trigger language plpgsql as $$begin raise exception 'Synthetic publication audit failure' using errcode='P0002';end$$;
create trigger pq_fail_publication before insert on learn_processing_publications for each row when(new.job_id='dd780923-ffff-4000-8000-000000000027') execute function pg_temp.pq_fail_publication();
do $$begin
 begin perform learn_processing_publish(pg_temp.pq(1),pg_temp.pq(27),'synthetic-worker',1,pg_temp.pq(1027),kind,source,revision,'publish') from pq_args where job=27;raise exception 'Publication audit failure ignored';exception when sqlstate 'P0002' then null;end;
 assert not exists(select 1 from interactions where tenant_id=pg_temp.pq(1) and source_id=pg_temp.pq(107));
 assert not exists(select 1 from learn_interaction_projection_receipts where request_id=pg_temp.pq(1027));
end$$;drop trigger pq_fail_publication on learn_processing_publications;
-- A transaction that outlives its lease cannot finish even after taking the job lock.
create function pg_temp.pq_slow_source() returns trigger language plpgsql as $$begin perform pg_sleep(.1);return new;end$$;
create trigger pq_slow_source before insert on interactions for each row when(new.source_id='dd780923-ffff-4000-8000-000000000107') execute function pg_temp.pq_slow_source();
update platform_jobs set lease_expires_at=clock_timestamp()+interval '.05 seconds' where id=pg_temp.pq(27);
do $$begin
 begin perform learn_processing_publish(pg_temp.pq(1),pg_temp.pq(27),'synthetic-worker',1,pg_temp.pq(1027),kind,source,revision,'publish') from pq_args where job=27;raise exception 'Overdue publication committed';exception when sqlstate 'PT409' then assert SQLERRM='processing_claim_lost';end;
 assert not exists(select 1 from interactions where tenant_id=pg_temp.pq(1) and source_id=pg_temp.pq(107));
 assert not exists(select 1 from learn_processing_publications where request_id=pg_temp.pq(1027));
end$$;drop trigger pq_slow_source on interactions;
