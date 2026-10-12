-- Actual production schema, banned synthetic users, real operator authority checks.
create function pg_temp.health_id(n int) returns uuid language sql immutable as $$select ('fc199221-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.health_id(int) to authenticated,service_role;
insert into tenants(id,slug,display_name) values(pg_temp.health_id(1),'production-health-a','Synthetic health A'),(pg_temp.health_id(2),'production-health-b','Synthetic health B');
insert into auth.users(id,email,banned_until) values(pg_temp.health_id(10),'production-health-operator@example.invalid','infinity'),(pg_temp.health_id(11),'production-health-owner@example.invalid','infinity');
update profiles set tenant_id=pg_temp.health_id(1),role='owner' where id in(pg_temp.health_id(10),pg_temp.health_id(11));
insert into platform_authority_grants(profile_id,permission,granted_by,reason) values(pg_temp.health_id(10),'platform.controlplane.admin','offline synthetic probe','Temporary offline health acceptance only');
insert into email_accounts(id,tenant_id,provider,email_address,display_name,status) values(pg_temp.health_id(20),pg_temp.health_id(1),'gmail','health-a@example.invalid','Synthetic mailbox','active'),(pg_temp.health_id(21),pg_temp.health_id(2),'gmail','health-b@example.invalid','Other mailbox','active');
-- Provider availability is evidence, not inferred from retained bodies or healthy accounts.
insert into email_messages(id,tenant_id,provider,provider_message_id,body_text,raw_payload)
select pg_temp.health_id(100+n),pg_temp.health_id(1),'gmail','synthetic-health-'||n,'PRIVATE_CURRENT_BODY',
 case n
 when 1 then jsonb_build_object('provider_account_id',pg_temp.health_id(20),'provider_availability','available','provider_observed_history_id','200')
 when 2 then jsonb_build_object('provider_account_id',pg_temp.health_id(20),'provider_availability','unavailable','provider_observed_history_id','201')
 when 3 then '{}'::jsonb
 when 4 then jsonb_build_object('provider_account_id',pg_temp.health_id(21),'provider_availability','available','provider_observed_history_id','200')
 when 5 then jsonb_build_object('provider_account_id',pg_temp.health_id(20),'provider_availability','available','provider_observed_history_id','18446744073709551616')
 when 6 then jsonb_build_object('provider_account_id',pg_temp.health_id(20),'provider_availability','available','provider_observed_history_id',200) end from generate_series(1,6)n;
-- The real version trigger retains old content; the health output must only count it.
update email_messages set body_text='PRIVATE_REVISED_BODY' where id=pg_temp.health_id(101);
insert into email_messages(id,tenant_id,provider,provider_message_id,body_text,raw_payload) values(pg_temp.health_id(201),pg_temp.health_id(2),'gmail','synthetic-foreign-health','PRIVATE_FOREIGN_BODY',jsonb_build_object('provider_account_id',pg_temp.health_id(21),'provider_availability','unavailable','provider_observed_history_id','200'));
insert into email_sync_runs(id,tenant_id,provider,sync_type,status,started_at,completed_at,error_message,metadata)
values(pg_temp.health_id(30),pg_temp.health_id(1),'gmail','messages','running',now()-interval '1 minute',null,null,jsonb_build_object('email_account_id',pg_temp.health_id(20)));
-- Complete the protected run through the real protocol; direct fixture writes
-- are intentionally rejected by package 010's progress guard.
set local role service_role;
do $$declare r jsonb;begin
 r:=email_ingestion_transition_v2(pg_temp.health_id(1),pg_temp.health_id(20),'recent',pg_temp.health_id(30),pg_temp.health_id(31),'finish_attempt',null,null,null,
 '{"outcome":"failed","error_code":"delegation_denied","attempt_evidence":{"persistence":"confirmed","message_upsert_count":0,"thread_upsert_count":0,"ids_seen":0,"gone_count":0,"unresolved_count":1,"classification":"source_ineligible","coverage_complete":false}}');
 assert r->'accepted_result'->>'attempt_status'='failed';
end$$;reset role;
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='fc199221-aaaa-4000-8000-000000000010';set local role authenticated;
do $$declare p jsonb;r jsonb;mail jsonb;begin
 p:=learn_operator_capture_health(pg_temp.health_id(1));r:=p->'email_retention';
 assert r=jsonb_build_object('version','learn-email-retention/1','tenant_id',pg_temp.health_id(1),'scope','company','total',6,'available',1,'unavailable',1,'unverified',4,'unbound',2,'archived_versions',1),r::text;
 assert learn_operator_capture_health(pg_temp.health_id(1),'email:ffffffff-ffff-ffff-ffff-ffffffffffff')->'email_retention'=r;
 select x into strict mail from jsonb_array_elements(p->'rows')x where x->>'id'=pg_temp.health_id(20)::text;
 assert mail->'last_success_at'='null' and mail->'email_failure'->>'code'='delegation_denied';
 assert p::text not like '%PRIVATE%';
 assert learn_operator_capture_health(pg_temp.health_id(2))->'email_retention'->>'total'='1';
 begin perform learn_operator_capture_health(pg_temp.health_id(1),'invalid');raise exception 'Invalid cursor admitted';exception when invalid_parameter_value then null;end;
end$$;reset role;
set local request.jwt.claim.sub='fc199221-aaaa-4000-8000-000000000011';set local role authenticated;
do $$begin begin perform learn_operator_capture_health(pg_temp.health_id(1));raise exception 'Company owner gained operator access';exception when insufficient_privilege then null;end;end$$;reset role;
insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,expires_at) values(pg_temp.health_id(1),pg_temp.health_id(10),'role','viewer',clock_timestamp()+interval '1 hour');
set local request.jwt.claim.sub='fc199221-aaaa-4000-8000-000000000010';set local role authenticated;
do $$begin begin perform learn_operator_capture_health(pg_temp.health_id(1));raise exception 'View As gained operator access';exception when insufficient_privilege then null;end;end$$;reset role;
update view_as_context set ended_at=clock_timestamp() where actor_user_id=pg_temp.health_id(10);
update platform_authority_grants set effective_to=clock_timestamp() where profile_id=pg_temp.health_id(10);
set local role authenticated;
do $$begin begin perform learn_operator_capture_health(pg_temp.health_id(1));raise exception 'Revoked grant admitted';exception when insufficient_privilege then null;end;end$$;reset role;
do $$begin assert not has_function_privilege('anon','learn_operator_capture_health(uuid,text)','execute');assert not has_function_privilege('service_role','learn_operator_capture_health(uuid,text)','execute');end$$;
