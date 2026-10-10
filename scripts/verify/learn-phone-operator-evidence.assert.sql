-- Offline synthetic projection fixtures, not settlement-write acceptance.
create function fixture_health_phone() returns jsonb language sql as $$
 select r from jsonb_array_elements(learn_operator_capture_health(fixture_id(100),'email:ffffffff-ffff-ffff-ffff-ffffffffffff')->'rows')r where r->>'source'='phone'
$$;
insert into phone_recordings(id,tenant_id,provider_recording_id,started_at,storage_path,raw_payload)
 select fixture_id(800+n),fixture_id(100),case when n=5 then null else 'PRIVATE_PROVIDER_'||n end,
 case when n=4 then now() else now()-interval '1 day' end,
 case when n in(1,6,7,8) then 'PRIVATE_STORAGE_'||n else null end,'{"private":"DO_NOT_EXPOSE_CONTENT"}'
 from generate_series(1,8)n;
insert into phone_recordings(id,tenant_id,provider_recording_id) values(fixture_id(809),fixture_id(101),'PRIVATE_FOREIGN');
insert into phone_transcripts(tenant_id,recording_id,status) values(fixture_id(100),fixture_id(801),'completed'),(fixture_id(100),fixture_id(808),'completed');
insert into phone_ai_insights(tenant_id,recording_id) values(fixture_id(100),fixture_id(801));
insert into phone_sync_runs(tenant_id,sync_type,status,started_at,metadata) values
(fixture_id(100),'pipeline','failed',now()-interval '5 seconds',jsonb_build_object('recording_id',fixture_id(802),'failed_step','download','error_code','invalid_audio')),
(fixture_id(100),'pipeline','failed',now()-interval '5 seconds',jsonb_build_object('recording_id',fixture_id(803),'failed_step','download','error_code','provider_timeout')),
(fixture_id(100),'pipeline','running',now()-interval '5 seconds',jsonb_build_object('recording_id',fixture_id(806)));
-- The existing recovery selector still selects precisely the two ready rows.
do $$begin
 assert(select array_agg(id order by id) from phone_select_pending(fixture_id(100),50,120))=array[fixture_id(807),fixture_id(808)];
end$$;
-- A healthy account timestamp has no durable capture proof yet.
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000182';set role authenticated;
do $$declare p jsonb;e jsonb;begin
 e:=fixture_health_phone()->'phone_evidence';
 assert e->'latest_attempt'='null'::jsonb and e->'last_confirmed'='null'::jsonb;
 p:=learn_operator_capture_health(fixture_id(100))->'phone_processing';
 assert p->>'scope'='company' and p->>'tenant_id'=fixture_id(100)::text;
 assert p-'version'-'tenant_id'-'scope'='{"total":8,"complete":1,"download_pending":4,"transcribe_pending":2,"analyse_pending":1,"needs_review":1,"cooling_down":1,"recent_processing":1,"ready":2,"waiting_provider":2,"unknown_retry":0}'::jsonb;
 assert learn_operator_capture_health(fixture_id(100))::text not like '%PRIVATE%';
end$$;
reset role;
insert into platform_jobs(id,tenant_id,job_type,status,claimed_by,attempt_count,lease_expires_at,connector_id,payload)
 values(fixture_id(701),fixture_id(100),'phone.scheduled_sync','succeeded',null,1,null,'simwood',
 '{"provider_customer_id":"PRIVATE_ACCOUNT_KEY","from":"2026-10-10T10:00:00Z","to":"2026-10-10T10:05:00Z"}');
insert into phone_sync_runs(id,tenant_id,sync_type,status,started_at,completed_at,metadata) values
(fixture_id(700),fixture_id(100),'scheduled_sync','success',now()-interval '2 minutes',now()-interval '1 minute',jsonb_build_object(
 'connector_account_id',fixture_id(305),'tenant_connector_id',fixture_id(303),'provider_customer_id','PRIVATE_ACCOUNT_KEY',
 'from','2026-10-10T10:00:00Z','to','2026-10-10T10:05:00Z','include_local',false,'job_id',fixture_id(701),'job_owner','PRIVATE_OWNER','private','DO_NOT_EXPOSE_RAW'));
insert into learn_phone_schedule_settlements(run_id,tenant_id,definition,receipt) values
(fixture_id(700),fixture_id(100),'{}',jsonb_build_object('version','learn-phone-schedule/1','tenantId',fixture_id(100),'runId',fixture_id(700),
 'accountId',fixture_id(305),'connectorId',fixture_id(303),'customerId','PRIVATE_ACCOUNT_KEY','outcome','success','jobId',fixture_id(701),
 'cursorAdvanced',true,'from',now()-interval '6 minutes','to',now()-interval '2 minutes','callsProcessed',20,'recordingsProcessed',8));
set role authenticated;
do $$declare e jsonb;begin
 e:=fixture_health_phone()->'phone_evidence';assert e->'latest_attempt'->'confirmed'='true'::jsonb;
 assert e->'last_confirmed'->>'id'=fixture_id(700)::text and e->'last_confirmed'->>'calls_processed'='20';
 assert e::text not like '%PRIVATE%' and e::text not like '%DO_NOT_EXPOSE%';
end$$;
reset role;
-- Receipt/registry/job mismatches cannot promote the run to confirmed.
begin;
update connector_accounts set settings=settings||'{"include_local_calls":true}' where id=fixture_id(305);
set local role authenticated;
do $$declare e jsonb;begin e:=fixture_health_phone()->'phone_evidence';assert e->'latest_attempt'->'confirmed'='false'::jsonb and e->'last_confirmed'='null'::jsonb;end$$;
rollback;
begin;
update phone_sync_runs set metadata=metadata||jsonb_build_object('tenant_connector_id',fixture_id(999)) where id=fixture_id(700);
set local role authenticated;
do $$begin assert fixture_health_phone()->'phone_evidence'->'latest_attempt'->'confirmed'='false'::jsonb;end$$;
rollback;
begin;
update platform_jobs set tenant_id=fixture_id(101) where id=fixture_id(701);
set local role authenticated;
do $$declare e jsonb;begin e:=fixture_health_phone()->'phone_evidence';assert e->'latest_attempt'->'confirmed'='false'::jsonb and e->'latest_attempt'->'job'='null'::jsonb;end$$;
rollback;
begin;
update phone_sync_runs set metadata=metadata||'{"provider_customer_id":"another-customer"}' where id=fixture_id(700);
set local role authenticated;
do $$begin assert fixture_health_phone()->'phone_evidence'->'latest_attempt'='null'::jsonb;end$$;
rollback;
-- Later attempt without a receipt is visible; older proof is retained separately.
begin;
insert into phone_sync_runs(id,tenant_id,sync_type,status,started_at,completed_at,metadata)
 select fixture_id(710),tenant_id,sync_type,'success',now()-interval '20 seconds',now()-interval '10 seconds',metadata||'{"job_id":"malformed"}' from phone_sync_runs where id=fixture_id(700);
set local role authenticated;
do $$declare e jsonb;begin e:=fixture_health_phone()->'phone_evidence';assert e->'latest_attempt'->>'id'=fixture_id(710)::text;assert e->'latest_attempt'->'confirmed'='false'::jsonb;assert e->'last_confirmed'->>'id'=fixture_id(700)::text;end$$;
rollback;
-- Only a live, same-owner job claim can describe a running attempt as active.
begin;
update platform_jobs set status='running',claimed_by='PRIVATE_OWNER',lease_expires_at=now()+interval '5 minutes' where id=fixture_id(701);
update phone_sync_runs set status='running',completed_at=null where id=fixture_id(700);
set local role authenticated;
do $$declare e jsonb;begin e:=fixture_health_phone()->'phone_evidence';assert e->'latest_attempt'->'confirmed'='false'::jsonb;assert e->'latest_attempt'->'job'->'ownership_current'='true'::jsonb;end$$;
reset role;
update platform_jobs set payload=payload||'{"provider_customer_id":"another-account"}' where id=fixture_id(701);
set local role authenticated;
do $$begin assert fixture_health_phone()->'phone_evidence'->'latest_attempt'->'job'->'ownership_current'='false'::jsonb;end$$;
reset role;
update platform_jobs set payload=payload||'{"provider_customer_id":"PRIVATE_ACCOUNT_KEY"}' where id=fixture_id(701);
update platform_jobs set claimed_by='OTHER_OWNER' where id=fixture_id(701);
set local role authenticated;
do $$begin assert fixture_health_phone()->'phone_evidence'->'latest_attempt'->'job'->'ownership_current'='false'::jsonb;end$$;
reset role;
update platform_jobs set claimed_by='PRIVATE_OWNER',lease_expires_at=now()-interval '1 minute' where id=fixture_id(701);
set local role authenticated;
do $$begin assert fixture_health_phone()->'phone_evidence'->'latest_attempt'->'job'->'ownership_current'='false'::jsonb;end$$;
rollback;
-- Permission pause is exposed without losing retained progress or source content.
begin;
insert into feature_flags(tenant_id,flag,value) values(fixture_id(100),'learn.inputs.phone.enabled','false');
set local role authenticated;
do $$begin assert fixture_health_phone()->'phone_evidence'->'capture_allowed'='false'::jsonb;assert learn_operator_capture_health(fixture_id(100))->'phone_processing'->>'total'='8';end$$;
rollback;
-- Actual platform-authority resolver still denies tenant owners/revoked operators.
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000181';set role authenticated;
do $$begin begin perform learn_operator_capture_health(fixture_id(100));raise exception 'Tenant owner admitted';exception when insufficient_privilege then null;end;end$$;
reset role;
begin;
update platform_authority_grants set effective_to=clock_timestamp() where profile_id=fixture_id(182);
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000182';set local role authenticated;
do $$begin begin perform learn_operator_capture_health(fixture_id(100));raise exception 'Revoked operator admitted';exception when insufficient_privilege then null;end;end$$;
rollback;
do $$declare r text;begin
 foreach r in array array['anon','authenticated','service_role'] loop
  assert not has_function_privilege(r,'learn_phone_account_evidence(uuid,uuid)','execute');
  assert not has_function_privilege(r,'learn_phone_processing_evidence(uuid)','execute');
 end loop;
 assert not has_function_privilege('anon','learn_operator_capture_health(uuid,text)','execute');
 assert not has_function_privilege('service_role','learn_operator_capture_health(uuid,text)','execute');
end$$;
select 'PASS: Phone receipt/account scope, ownership/lease, unconfirmed import, redaction, company processing counts, pause, tenant isolation and operator-only authority';
