-- Full restored schema, synthetic rows only; caller rolls back every assertion.
set local plpgsql.check_asserts=on;
create function pg_temp.lo(n int) returns uuid language sql immutable as $$ select ('ae256482-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
insert into tenants(id,slug,display_name,status) values(pg_temp.lo(2),'observation-fixture','Synthetic learning','active');
insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,subject,processing_status,updated_at)
values(pg_temp.lo(1),pg_temp.lo(2),'slack','chat','slack_messages',pg_temp.lo(20),'slack_message','unknown',now(),'Synthetic reviewed technical context','enriched','2026-10-12T12:00:00Z');
insert into platform_jobs(id,tenant_id,job_type,job_key,status,claimed_by,attempt_count,lease_expires_at,payload)
values(pg_temp.lo(3),pg_temp.lo(2),'intelligence.observe','learn-observe-fixture','running','fixture',1,now()+interval '5 minutes',jsonb_build_object('observation',__DRAFT__));
insert into intelligence_ingestions(tenant_id,interaction_id,mapper_version,ingest_key,observe_job_id,status)
values(pg_temp.lo(2),pg_temp.lo(1),'obs-ingest/2','learn-ingestion-fixture',pg_temp.lo(3),'enqueued');
create temporary table lo_input as select __RESULT__ r;
create function pg_temp.lo_fail() returns trigger language plpgsql as $$begin raise exception 'synthetic_late_failure';end$$;
create trigger lo_inject_failure before insert on learn_observation_receipts for each row execute function pg_temp.lo_fail();
do $$declare r jsonb; n bigint;begin
 select count(*) into n from intelligence_objects;
 begin
  perform learn_observation_deliver(pg_temp.lo(2),pg_temp.lo(3),'{"claimedBy":"fixture","attemptCount":1}',(select v.r from lo_input v));
  raise exception 'late_failure_not_exercised';
 exception when raise_exception then if sqlerrm<>'synthetic_late_failure' then raise;end if;end;
 assert (select count(*) from intelligence_objects)=n;
 assert not exists(select 1 from graph_nodes where tenant_id=pg_temp.lo(2));
 assert not exists(select 1 from platform_events where tenant_id=pg_temp.lo(2));
 assert (select status from intelligence_ingestions where tenant_id=pg_temp.lo(2))='enqueued';
end$$;
drop trigger lo_inject_failure on learn_observation_receipts;
do $$declare r jsonb;begin
 begin perform learn_observation_deliver(pg_temp.lo(2),pg_temp.lo(3),'{"claimedBy":"wrong","attemptCount":1}',(select v.r from lo_input v));raise exception 'wrong_claim_accepted';
 exception when raise_exception then if sqlerrm<>'learn_observation_lease_unavailable' then raise;end if;end;
 begin perform learn_observation_deliver(pg_temp.lo(99),pg_temp.lo(3),'{"claimedBy":"fixture","attemptCount":1}',(select v.r from lo_input v));raise exception 'foreign_tenant_accepted';
 exception when raise_exception then if sqlerrm<>'learn_observation_job_unavailable' then raise;end if;end;
 begin
  update interactions set summary='Synthetic new revision' where id=pg_temp.lo(1);
  perform learn_observation_deliver(pg_temp.lo(2),pg_temp.lo(3),'{"claimedBy":"fixture","attemptCount":1}',(select v.r from lo_input v));raise exception 'stale_source_accepted';
 exception when raise_exception then if sqlerrm<>'learn_observation_source_changed' then raise;end if;end;
 r:=learn_observation_deliver(pg_temp.lo(2),pg_temp.lo(3),'{"claimedBy":"fixture","attemptCount":1}',(select v.r from lo_input v));
 assert r->>'state'='committed' and r->'can_execute'='false' and r->'action_ids'='[]';
 assert r->>'operational_mode'=(select v.r#>>'{operational,mode}' from lo_input v);
 assert (select outputs#>>'{operational,mode}' from decision_log where id=(r->>'decision_id')::uuid)=r->>'operational_mode';
 assert (select outputs#>'{operational,can_execute}' from decision_log where id=(r->>'decision_id')::uuid)='false'::jsonb;
 assert (select outputs#>'{operational,allowed}' from decision_log where id=(r->>'decision_id')::uuid)='false'::jsonb;
 assert (select outputs#>>'{operational,blocked_reason}' from decision_log where id=(r->>'decision_id')::uuid)='mode_observe_only';
 assert r=learn_observation_deliver(pg_temp.lo(2),pg_temp.lo(3),null,null);
 -- Even a newly generated package on retry returns the original receipt.
 assert r=learn_observation_deliver(pg_temp.lo(2),pg_temp.lo(3),null,'{}');
 assert (select count(*) from intelligence_objects where tenant_id=pg_temp.lo(2))=1;
 assert (select count(*) from decision_log where tenant_id=pg_temp.lo(2))=1;
 assert not exists(select 1 from automation_intents where tenant_id=pg_temp.lo(2));
 assert not exists(select 1 from automation_execution_attempts where tenant_id=pg_temp.lo(2));
 assert (select count(*) from object_state_history where tenant_id=pg_temp.lo(2) and capture_kind='insert')=1;
 assert (select count(*) from object_state_history where tenant_id=pg_temp.lo(2) and decision_id=(r->>'decision_id')::uuid)=1;
 assert (select count(*) from object_state_history where tenant_id=pg_temp.lo(2))=2;
 assert (select count(*) from graph_nodes where tenant_id=pg_temp.lo(2))=1;
 assert (select count(*) from platform_events where tenant_id=pg_temp.lo(2))=1;
 assert (select count(*) from learn_observation_receipts where tenant_id=pg_temp.lo(2))=1;
 assert (select status from intelligence_ingestions where tenant_id=pg_temp.lo(2))='observed';
 assert not has_function_privilege('authenticated','learn_observation_deliver(uuid,uuid,jsonb,jsonb)','execute');
 assert not has_function_privilege('anon','learn_observation_deliver(uuid,uuid,jsonb,jsonb)','execute');
 assert has_function_privilege('service_role','learn_observation_deliver(uuid,uuid,jsonb,jsonb)','execute');
 assert not has_table_privilege('authenticated','learn_observation_receipts','select');
end$$;
