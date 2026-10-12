-- Offline production-schema fixture: actual auth, operator grants and phone view.
set search_path=public,pg_catalog;
create schema verify;
grant usage on schema verify to authenticated,service_role;
create function verify.id(n integer) returns uuid language sql immutable as $$select ('fc000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into tenants(id,slug,display_name) values(verify.id(100),'capture-local-one','Synthetic capture company'),(verify.id(101),'capture-local-two','Synthetic other capture company');
insert into auth.users(id) values(verify.id(180)),(verify.id(181));
update profiles set tenant_id=verify.id(100),role='owner' where id in (verify.id(180),verify.id(181));
insert into platform_authority_grants(profile_id,permission,granted_by,reason) values(verify.id(180),'platform.controlplane.admin','offline synthetic fixture','Temporary offline acceptance only');
-- Actual control RPCs and queue claimants with synthetic source/authority rows.
create function verify.capture_definition(email boolean,phone boolean,slack boolean,master boolean default true) returns jsonb language sql as $$
 select jsonb_build_object('reason','Synthetic capture policy','revision',learn_operator_capture_controls(verify.id(100))->>'revision','values',jsonb_build_object('learn.enabled',master,'learn.inputs.email.enabled',email,'learn.inputs.phone.enabled',phone,'learn.inputs.slack.enabled',slack));$$;
create temp table preserved_capture_sources as select jsonb_build_object('accounts',(select jsonb_agg(to_jsonb(a) order by id) from connector_accounts a),'connections',(select jsonb_agg(to_jsonb(c) order by id) from provider_connections c)) as snapshot;
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='fc000000-0000-4000-8000-000000000180';set role authenticated;
do $$declare s jsonb;d jsonb;r jsonb;begin
 s:=learn_operator_capture_controls(verify.id(100));
 assert s->'sources'->'email'->'allowed'='true';assert s->'sources'->'phone'->'inherited'='true';
 d:=verify.capture_definition(false,true,false);
 r:=learn_operator_capture_control_request(verify.id(100),verify.id(700),verify.id(180),d);
 assert r->>'state'='recorded';
 assert r=learn_operator_capture_control_request(verify.id(100),verify.id(700),verify.id(180),d);
 begin perform learn_operator_capture_control_request(verify.id(100),verify.id(701),verify.id(180),d);raise exception 'Stale edit accepted';exception when sqlstate 'PT409' then null;end;
 assert learn_operator_capture_controls(verify.id(100))->'sources'->'email'->'allowed'='false';
 assert learn_operator_capture_controls(verify.id(100))->'sources'->'phone'->'allowed'='true';
 d:=verify.capture_definition(true,true,true);
 assert learn_operator_capture_control_request(verify.id(100),verify.id(702),verify.id(180),d,'cancel')->>'state'='cancelled';
 assert learn_operator_capture_control_request(verify.id(100),verify.id(702),verify.id(180),d)->>'state'='cancelled';
 begin perform learn_capture_admission(verify.id(100),'email');raise exception 'Client admitted capture';exception when insufficient_privilege then null;end;
end$$;
reset role;
-- Anonymous, ordinary tenant ownership and View As never become operator authority.
set request.jwt.claim.sub='fc000000-0000-4000-8000-000000000181';set role authenticated;
do $$begin begin perform learn_operator_capture_controls(verify.id(100));raise exception 'Owner read controls';exception when insufficient_privilege then null;end;end$$;
reset role;
insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,expires_at) values(verify.id(100),verify.id(180),'role','viewer',clock_timestamp()+interval '1 hour');
set request.jwt.claim.sub='fc000000-0000-4000-8000-000000000180';set role authenticated;
do $$begin begin perform learn_operator_capture_controls(verify.id(100));raise exception 'View As read controls';exception when insufficient_privilege then null;end;end$$;
reset role;update view_as_context set ended_at=clock_timestamp() where actor_user_id=verify.id(180) and ended_at is null;
do $$begin assert not has_function_privilege('anon','learn_operator_capture_controls(uuid)','execute');end$$;
-- No raw malformed setting crosses the read model; invalid configuration blocks capture.
update feature_flags set value='{"private":"DO_NOT_EXPOSE"}' where tenant_id=verify.id(100) and flag='learn.inputs.phone.enabled';
set role authenticated;
do $$declare s jsonb;begin s:=learn_operator_capture_controls(verify.id(100));assert s::text not like '%DO_NOT_EXPOSE%';assert s->'sources'->'phone'->'invalid'='true';assert s->'sources'->'phone'->'allowed'='false';end$$;
select learn_operator_capture_control_request(verify.id(100),verify.id(703),verify.id(180),verify.capture_definition(false,true,false))->>'state';
reset role;
-- Original archived jobs remain unchanged in this journey.
insert into platform_jobs(id,tenant_id,job_type,status,attempt_count,max_attempts,payload,metadata) values
 (verify.id(710),verify.id(100),'email.gmail_sync','queued',0,3,'{}','{}'),
 (verify.id(711),verify.id(101),'email.gmail_sync','queued',0,3,'{}','{}'),
 (verify.id(712),verify.id(100),'slack.history_sync','queued',3,3,'{}','{}'),
 (verify.id(713),verify.id(100),'slack.history_sync','queued',3,3,'{}','{"slack_page_v1":{"saved":true}}');
update platform_jobs set priority=-2147483648 where id in (verify.id(710),verify.id(711),verify.id(712),verify.id(713));
set role service_role;
do $$begin
 assert learn_capture_admission(verify.id(100),'email')->'allowed'='false';
 assert learn_capture_admission(verify.id(100),'phone')->'allowed'='true';
 assert learn_capture_admission(verify.id(101),'email')->'allowed'='true';
 assert (select id from platform_jobs_claim('capture-fixture',1,300,array['email.gmail_sync']))=verify.id(711);
 assert (select status from platform_jobs where id=verify.id(710))='queued';
 assert (select attempt_count from platform_jobs where id=verify.id(710))=0;
 assert (select count(*) from learn_slack_claim_jobs(verify.id(720),1))=1;
 assert (select status from platform_jobs where id=verify.id(712))='queued';
 assert (select attempt_count from platform_jobs where id=verify.id(712))=3;
 assert (select status from platform_jobs where id=verify.id(713))='running';
end$$;
reset role;
-- A race after claim defers without decrementing another worker's attempt. Replay
-- of the acknowledged pause never changes a newly acquired lease.
set role service_role;
do $$declare r jsonb;begin
 begin perform learn_capture_defer_job(verify.id(100),verify.id(711),'capture-fixture',1,'paused');raise exception 'Foreign tenant deferred';exception when sqlstate 'PT409' then null;end;
 r:=learn_capture_defer_job(verify.id(101),verify.id(711),'capture-fixture',1,'paused');
 assert r->>'state'='waiting';assert r->>'attempt_count'='0';
 assert r=learn_capture_defer_job(verify.id(101),verify.id(711),'capture-fixture',1,'paused');
 assert (select attempt_count from platform_jobs where id=verify.id(711))=0;
 begin perform learn_capture_defer_job(verify.id(100),verify.id(713),'learn-slack:'||verify.id(720),4,'paused');raise exception 'Saved page discarded';exception when sqlstate 'PT409' then null;end;
end$$;
reset role;
-- A failed durable receipt rolls back every switch update.
create function verify.capture_receipt_fail() returns trigger language plpgsql as $$begin raise exception 'Synthetic receipt failure' using errcode='P0002';end$$;
create trigger fixture_capture_receipt_fail before insert on learn_capture_control_requests for each row execute function verify.capture_receipt_fail();
set role authenticated;
do $$declare s jsonb;begin
 s:=learn_operator_capture_controls(verify.id(100));
 begin perform learn_operator_capture_control_request(verify.id(100),verify.id(704),verify.id(180),verify.capture_definition(true,true,true));raise exception 'Receipt failure absent';exception when no_data_found then null;end;
 assert s=learn_operator_capture_controls(verify.id(100));
end$$;
reset role;drop trigger fixture_capture_receipt_fail on learn_capture_control_requests;
set role authenticated;
select learn_operator_capture_control_request(verify.id(100),verify.id(705),verify.id(180),verify.capture_definition(true,true,true,false))->>'state';
reset role;
set role service_role;
do $$begin assert not learn_capture_allowed(verify.id(100),'email');assert not learn_capture_allowed(verify.id(100),'phone');assert not learn_capture_allowed(verify.id(100),'slack');end$$;
reset role;
do $$begin
 assert (select snapshot from preserved_capture_sources)=jsonb_build_object('accounts',(select jsonb_agg(to_jsonb(a) order by id) from connector_accounts a),'connections',(select jsonb_agg(to_jsonb(c) order by id) from provider_connections c));
 begin delete from learn_capture_control_requests;raise exception 'Audit deleted';exception when object_not_in_prerequisite_state then null;end;
end$$;
select 'Capture control authority, audit/replay, source preservation, paused queues, saved-page recovery and retry-neutral deferral passed';

-- Selection remains fair to retained audio when old downloads fill the backlog.
insert into phone_recordings(id,tenant_id,provider_recording_id,storage_path,started_at) values(verify.id(750),verify.id(100),'synthetic-pending-download',null,clock_timestamp()-interval '2 days'),(verify.id(751),verify.id(100),'synthetic-retained-audio','synthetic/retained.wav',clock_timestamp()-interval '1 day');
set role service_role;
do $$begin assert (select count(*) from phone_select_pending(verify.id(100),1,0))=1;assert (select id from phone_select_pending(verify.id(100),1,0))=verify.id(751);end$$;
reset role;
select 'Paused phone downloads do not starve retained-audio processing';
