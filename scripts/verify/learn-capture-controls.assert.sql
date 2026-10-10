-- Actual control RPCs and queue claimants with synthetic source/authority rows.
create function fixture_capture_definition(email boolean,phone boolean,slack boolean,master boolean default true) returns jsonb language sql as $$
 select jsonb_build_object('reason','Synthetic capture policy','revision',learn_operator_capture_controls(fixture_id(100))->>'revision','values',jsonb_build_object('learn.enabled',master,'learn.inputs.email.enabled',email,'learn.inputs.phone.enabled',phone,'learn.inputs.slack.enabled',slack));$$;
create temp table preserved_capture_sources as select jsonb_build_object('accounts',(select jsonb_agg(to_jsonb(a) order by id) from connector_accounts a),'connections',(select jsonb_agg(to_jsonb(c) order by id) from provider_connections c)) as snapshot;
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;
do $$declare s jsonb;d jsonb;r jsonb;begin
 s:=learn_operator_capture_controls(fixture_id(100));
 assert s->'sources'->'email'->'allowed'='true';assert s->'sources'->'phone'->'inherited'='true';
 d:=fixture_capture_definition(false,true,false);
 r:=learn_operator_capture_control_request(fixture_id(100),fixture_id(700),fixture_id(180),d);
 assert r->>'state'='recorded';
 assert r=learn_operator_capture_control_request(fixture_id(100),fixture_id(700),fixture_id(180),d);
 begin perform learn_operator_capture_control_request(fixture_id(100),fixture_id(701),fixture_id(180),d);raise exception 'Stale edit accepted';exception when sqlstate 'PT409' then null;end;
 assert learn_operator_capture_controls(fixture_id(100))->'sources'->'email'->'allowed'='false';
 assert learn_operator_capture_controls(fixture_id(100))->'sources'->'phone'->'allowed'='true';
 d:=fixture_capture_definition(true,true,true);
 assert learn_operator_capture_control_request(fixture_id(100),fixture_id(702),fixture_id(180),d,'cancel')->>'state'='cancelled';
 assert learn_operator_capture_control_request(fixture_id(100),fixture_id(702),fixture_id(180),d)->>'state'='cancelled';
 begin perform learn_capture_admission(fixture_id(100),'email');raise exception 'Client admitted capture';exception when insufficient_privilege then null;end;
end$$;
reset role;
-- Anonymous, ordinary tenant ownership and View As never become operator authority.
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000181';set role authenticated;
do $$begin begin perform learn_operator_capture_controls(fixture_id(100));raise exception 'Owner read controls';exception when insufficient_privilege then null;end;end$$;
reset role;
insert into view_as_context values(fixture_id(180),clock_timestamp()+interval '1 hour',null);
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;
do $$begin begin perform learn_operator_capture_controls(fixture_id(100));raise exception 'View As read controls';exception when insufficient_privilege then null;end;end$$;
reset role;delete from view_as_context;
do $$begin assert not has_function_privilege('anon','learn_operator_capture_controls(uuid)','execute');end$$;
-- No raw malformed setting crosses the read model; invalid configuration blocks capture.
update feature_flags set value='{"private":"DO_NOT_EXPOSE"}' where tenant_id=fixture_id(100) and flag='learn.inputs.phone.enabled';
set role authenticated;
do $$declare s jsonb;begin s:=learn_operator_capture_controls(fixture_id(100));assert s::text not like '%DO_NOT_EXPOSE%';assert s->'sources'->'phone'->'invalid'='true';assert s->'sources'->'phone'->'allowed'='false';end$$;
select learn_operator_capture_control_request(fixture_id(100),fixture_id(703),fixture_id(180),fixture_capture_definition(false,true,false))->>'state';
reset role;
update platform_jobs set status='succeeded';
insert into platform_jobs(id,tenant_id,job_type,status,attempt_count,max_attempts,payload,metadata) values
 (fixture_id(710),fixture_id(100),'email.gmail_sync','queued',0,3,'{}','{}'),
 (fixture_id(711),fixture_id(101),'email.gmail_sync','queued',0,3,'{}','{}'),
 (fixture_id(712),fixture_id(100),'slack.history_sync','queued',3,3,'{}','{}'),
 (fixture_id(713),fixture_id(100),'slack.history_sync','queued',3,3,'{}','{"slack_page_v1":{"saved":true}}');
set role service_role;
do $$begin
 assert learn_capture_admission(fixture_id(100),'email')->'allowed'='false';
 assert learn_capture_admission(fixture_id(100),'phone')->'allowed'='true';
 assert learn_capture_admission(fixture_id(101),'email')->'allowed'='true';
 assert (select count(*) from platform_jobs_claim('capture-fixture',5,300,array['email.gmail_sync']))=1;
 assert (select status from platform_jobs where id=fixture_id(710))='queued';
 assert (select attempt_count from platform_jobs where id=fixture_id(710))=0;
 assert (select count(*) from learn_slack_claim_jobs(fixture_id(720),1))=1;
 assert (select status from platform_jobs where id=fixture_id(712))='queued';
 assert (select attempt_count from platform_jobs where id=fixture_id(712))=3;
 assert (select status from platform_jobs where id=fixture_id(713))='running';
end$$;
reset role;
-- A race after claim defers without decrementing another worker's attempt. Replay
-- of the acknowledged pause never changes a newly acquired lease.
set role service_role;
do $$declare r jsonb;begin
 begin perform learn_capture_defer_job(fixture_id(100),fixture_id(711),'capture-fixture',1,'paused');raise exception 'Foreign tenant deferred';exception when sqlstate 'PT409' then null;end;
 r:=learn_capture_defer_job(fixture_id(101),fixture_id(711),'capture-fixture',1,'paused');
 assert r->>'state'='waiting';assert r->>'attempt_count'='0';
 assert r=learn_capture_defer_job(fixture_id(101),fixture_id(711),'capture-fixture',1,'paused');
 assert (select attempt_count from platform_jobs where id=fixture_id(711))=0;
 begin perform learn_capture_defer_job(fixture_id(100),fixture_id(713),'learn-slack:'||fixture_id(720),4,'paused');raise exception 'Saved page discarded';exception when sqlstate 'PT409' then null;end;
end$$;
reset role;
-- A failed durable receipt rolls back every switch update.
create function fixture_capture_receipt_fail() returns trigger language plpgsql as $$begin raise exception 'Synthetic receipt failure' using errcode='P0002';end$$;
create trigger fixture_capture_receipt_fail before insert on learn_capture_control_requests for each row execute function fixture_capture_receipt_fail();
set role authenticated;
do $$declare s jsonb;begin
 s:=learn_operator_capture_controls(fixture_id(100));
 begin perform learn_operator_capture_control_request(fixture_id(100),fixture_id(704),fixture_id(180),fixture_capture_definition(true,true,true));raise exception 'Receipt failure absent';exception when no_data_found then null;end;
 assert s=learn_operator_capture_controls(fixture_id(100));
end$$;
reset role;drop trigger fixture_capture_receipt_fail on learn_capture_control_requests;
set role authenticated;
select learn_operator_capture_control_request(fixture_id(100),fixture_id(705),fixture_id(180),fixture_capture_definition(true,true,true,false))->>'state';
reset role;
set role service_role;
do $$begin assert not learn_capture_allowed(fixture_id(100),'email');assert not learn_capture_allowed(fixture_id(100),'phone');assert not learn_capture_allowed(fixture_id(100),'slack');end$$;
reset role;
do $$begin
 assert (select snapshot from preserved_capture_sources)=jsonb_build_object('accounts',(select jsonb_agg(to_jsonb(a) order by id) from connector_accounts a),'connections',(select jsonb_agg(to_jsonb(c) order by id) from provider_connections c));
 begin delete from learn_capture_control_requests;raise exception 'Audit deleted';exception when object_not_in_prerequisite_state then null;end;
end$$;
select 'Capture control authority, audit/replay, source preservation, paused queues, saved-page recovery and retry-neutral deferral passed';

-- Selection remains fair to retained audio when old downloads fill the backlog.
insert into phone_recording_pipeline_state values(fixture_id(750),fixture_id(100),'download',clock_timestamp()-interval '2 days',true,true),(fixture_id(751),fixture_id(100),'transcribe',clock_timestamp()-interval '1 day',true,true);
set role service_role;
do $$begin assert (select count(*) from phone_select_pending(fixture_id(100),1,0))=1;assert (select id from phone_select_pending(fixture_id(100),1,0))=fixture_id(751);end$$;
reset role;
select 'Paused phone downloads do not starve retained-audio processing';
