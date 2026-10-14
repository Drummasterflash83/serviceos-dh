-- Caller provides __DRAFT__ and rolls back this entire synthetic journey.
set local plpgsql.check_asserts=on;
create function pg_temp.lo(n int) returns uuid language sql immutable as $$ select ('ae256482-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
insert into tenants(id,slug,display_name,status) values(pg_temp.lo(2),'mode-recovery-fixture','Synthetic recovery','active');
insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,subject,processing_status,updated_at)
values(pg_temp.lo(1),pg_temp.lo(2),'slack','chat','slack_messages',pg_temp.lo(20),'slack_message','unknown',now(),'Synthetic reviewed context','enriched','2026-10-12T12:00:00Z');
insert into platform_jobs(id,tenant_id,job_type,job_key,status,error_code,attempt_count,payload)
values(pg_temp.lo(3),pg_temp.lo(2),'intelligence.observe','learn-recovery-fixture','dead_letter','learn_observation_mode_review',1,jsonb_build_object('observation',__DRAFT__));
insert into intelligence_ingestions(tenant_id,interaction_id,mapper_version,ingest_key,observe_job_id,status)
values(pg_temp.lo(2),pg_temp.lo(1),'obs-ingest/2','learn-recovery-ingestion',pg_temp.lo(3),'enqueued');
create temp table recovery_parent_before as select to_jsonb(j) value from platform_jobs j where id=pg_temp.lo(3);
create function pg_temp.recovery_fail() returns trigger language plpgsql as $$begin raise exception 'synthetic_recovery_late_failure';end$$;
create trigger recovery_fail before insert on platform_events for each row execute function pg_temp.recovery_fail();
do $$declare h text;begin
 select md5(payload::text) into h from platform_jobs where id=pg_temp.lo(3);
 begin perform pg_temp.learn_recover_mode_observation(pg_temp.lo(2),pg_temp.lo(3),pg_temp.lo(4),h,pg_temp.lo(5));raise exception 'late_failure_not_tested';
 exception when raise_exception then if sqlerrm<>'synthetic_recovery_late_failure' then raise;end if;end;
 assert not exists(select 1 from platform_jobs where id=pg_temp.lo(4));
 assert (select observe_job_id from intelligence_ingestions where tenant_id=pg_temp.lo(2))=pg_temp.lo(3);
end$$;
drop trigger recovery_fail on platform_events;
do $$declare h text;begin
 select md5(payload::text) into h from platform_jobs where id=pg_temp.lo(3);
 begin perform pg_temp.learn_recover_mode_observation(pg_temp.lo(99),pg_temp.lo(3),pg_temp.lo(4),h,pg_temp.lo(5));raise exception 'foreign_tenant_accepted';
 exception when raise_exception then if sqlerrm<>'recovery_parent_changed' then raise;end if;end;
 begin perform pg_temp.learn_recover_mode_observation(pg_temp.lo(2),pg_temp.lo(3),pg_temp.lo(4),repeat('0',32),pg_temp.lo(5));raise exception 'changed_payload_accepted';
 exception when raise_exception then if sqlerrm<>'recovery_parent_changed' then raise;end if;end;
 begin update interactions set summary='changed' where id=pg_temp.lo(1);perform pg_temp.learn_recover_mode_observation(pg_temp.lo(2),pg_temp.lo(3),pg_temp.lo(4),h,pg_temp.lo(5));raise exception 'changed_source_accepted';
 exception when raise_exception then if sqlerrm<>'recovery_source_changed' then raise;end if;end;
 assert pg_temp.learn_recover_mode_observation(pg_temp.lo(2),pg_temp.lo(3),pg_temp.lo(4),h,pg_temp.lo(5))=pg_temp.lo(4);
 assert pg_temp.learn_recover_mode_observation(pg_temp.lo(2),pg_temp.lo(3),pg_temp.lo(4),h,pg_temp.lo(5))=pg_temp.lo(4);
 assert (select count(*) from platform_jobs where tenant_id=pg_temp.lo(2))=2;
 assert (select count(*) from platform_events where tenant_id=pg_temp.lo(2))=1;
 assert (select to_jsonb(j) from platform_jobs j where id=pg_temp.lo(3))=(select value from recovery_parent_before);
 assert (select parent_job_id from platform_jobs where id=pg_temp.lo(4))=pg_temp.lo(3);
 assert (select payload from platform_jobs where id=pg_temp.lo(4))=(select payload from platform_jobs where id=pg_temp.lo(3));
 assert (select status='queued' and attempt_count=0 and created_by is null from platform_jobs where id=pg_temp.lo(4));
 assert (select observe_job_id from intelligence_ingestions where tenant_id=pg_temp.lo(2))=pg_temp.lo(4);
 assert not exists(select 1 from intelligence_objects where tenant_id=pg_temp.lo(2));
 assert not exists(select 1 from automation_intents where tenant_id=pg_temp.lo(2));
end$$;
