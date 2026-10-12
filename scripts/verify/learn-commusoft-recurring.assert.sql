reset role;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';
set request.jwt.claim.role='service_role';
-- Settle the previous synthetic manual contact traversal.
select fixture_contact_capture('[]',false,null)->'checkpoint';
select fixture_contact_capture('[]',false,null)->'checkpoint';
create temporary table recurring_original_pages as select * from learn_business_input_pages;
create temporary table recurring_original_versions as select * from learn_business_input_versions;
insert into fixture_input_definitions select 'recurring',jsonb_build_object('account_id',id,'expected_revision',0,'enabled',true,
 'max_pages',20,'page_size',50,'reason','Synthetic full ongoing capture approval') from connector_accounts where tenant_id=fixture_id(100);
set request.jwt.claim.role='authenticated';set role authenticated;
select learn_commusoft_recurring_control(fixture_id(100),fixture_id(400),fixture_id(180),fixture_definition('recurring'))->>'state';
select learn_commusoft_recurring_control(fixture_id(100),fixture_id(400),fixture_id(180),fixture_definition('recurring'))->>'state';
select learn_commusoft_recurring_control(fixture_id(100),fixture_id(499),fixture_id(180),fixture_definition('recurring'),'cancel')->>'state';
select learn_commusoft_recurring_control(fixture_id(100),fixture_id(499),fixture_id(180),fixture_definition('recurring'),'apply')->>'state';
do $$begin
 begin perform learn_commusoft_recurring_control(fixture_id(101),fixture_id(498),fixture_id(180),fixture_definition('recurring'));
  raise exception 'Wrong tenant accepted';exception when sqlstate 'PT409' or insufficient_privilege then null;end;

 begin perform learn_commusoft_schedule_recurring();raise exception 'Browser scheduler allowed';exception when insufficient_privilege then null;end;
 begin perform learn_commusoft_recurring_start(fixture_id(100),fixture_id(999),fixture_id(180),'{}','apply');raise exception 'Private start exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;set request.jwt.claim.role='service_role';
select learn_commusoft_schedule_recurring();
do $$begin
 if (select count(*) from learn_commusoft_recurring_steps)<>1 or (select watermark from learn_commusoft_recurring) is not null then raise exception 'Bad initial dispatch';end if;
 if (select definition ? 'updatedFrom' from learn_commusoft_recurring_steps) then raise exception 'Bootstrap skipped history';end if;
end $$;
-- Repeated tick while active never queues another job or advances coverage.
update learn_commusoft_recurring set next_check_at=clock_timestamp();
select learn_commusoft_schedule_recurring();
do $$begin if (select count(*) from learn_commusoft_recurring_steps)<>1 then raise exception 'Duplicate dispatch';end if;end$$;
-- Capture pause fences the existing queued approval, without deleting progress.
set request.jwt.claim.role='authenticated';set role authenticated;
select learn_commusoft_recurring_control(fixture_id(100),fixture_id(401),fixture_id(180),fixture_definition('recurring')||'{"expected_revision":1,"enabled":false}');
reset role;set request.jwt.claim.role='service_role';
do $$declare s learn_commusoft_recurring%rowtype;begin select * into s from learn_commusoft_recurring;
 if learn_commusoft_recurring_page_allowed(s.tenant_id,s.current_request::text) then raise exception 'Paused authority accepted';end if;
 if (select count(*) from learn_commusoft_recurring_steps)<>1 then raise exception 'Paused history changed';end if;
 if exists(select 1 from learn_commusoft_claim_jobs(fixture_id(170))) then raise exception 'Paused recurring job claimed';end if;
 if exists(select 1 from platform_jobs where job_key='commusoft.source:'||s.account_id::text||':'||s.current_request::text and attempt_count<>0) then raise exception 'Pause spent a retry';end if;
end$$;
-- A paused account must not occupy the single-job claim slot for other clients.
insert into platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,max_attempts,available_at,payload)
 values(fixture_id(910),fixture_id(101),'commusoft','learn','commusoft.source_sync',
 'commusoft.source:'||fixture_id(911)::text||':'||fixture_id(912)::text,'queued',5,clock_timestamp(),jsonb_build_object('connector_account_id',fixture_id(911)));
do $$declare j platform_jobs%rowtype;begin
 select * into j from learn_commusoft_claim_jobs(fixture_id(170));
 if j.id is distinct from fixture_id(910) then raise exception 'Paused account starved another client';end if;
end$$;
update platform_jobs set status='dead_letter',lease_expires_at=null where id=fixture_id(910);
set request.jwt.claim.role='authenticated';set role authenticated;
select learn_commusoft_recurring_control(fixture_id(100),fixture_id(402),fixture_id(180),fixture_definition('recurring')||'{"expected_revision":2}');
reset role;set request.jwt.claim.role='service_role';
select fixture_contact_capture('[{"id":101,"type":"customer"},{"id":202,"type":"customer"},{"id":303,"type":"workaddress"}]',false,null)->'checkpoint';
update learn_commusoft_recurring set next_check_at=clock_timestamp();
select learn_commusoft_schedule_recurring();
select fixture_contact_capture('[]',false,null)->'checkpoint';
update learn_commusoft_recurring set next_check_at=clock_timestamp();
select learn_commusoft_schedule_recurring();
select fixture_contact_capture('[]',false,null)->'checkpoint';
select fixture_contact_capture('[]',false,null)->'checkpoint';
update learn_commusoft_recurring set next_check_at=clock_timestamp();
select learn_commusoft_schedule_recurring();
do $$begin
 if (select phase from learn_commusoft_recurring)<>4 or (select watermark from learn_commusoft_recurring) is not null then raise exception 'Partial cycle advanced watermark';end if;
end$$;
select fixture_contact_capture('[]',false,null)->'checkpoint';
update learn_commusoft_recurring set next_check_at=clock_timestamp();
select learn_commusoft_schedule_recurring();
do $$begin
 if (select watermark is null or phase<>0 or last_state<>'cycle_complete' from learn_commusoft_recurring) then raise exception 'Complete cycle did not advance';end if;
 if (select count(*) from learn_commusoft_recurring_steps)<>4 then raise exception 'Cycle skipped a phase';end if;
 if exists(select * from recurring_original_pages except select * from learn_business_input_pages)
 or exists(select * from recurring_original_versions except select * from learn_business_input_versions) then raise exception 'History changed';end if;
end$$;
-- Next cycle keeps the full inventory, then freezes identical update bounds for
-- jobs/customer contacts/site contacts. It never uses a filtered parent set.
update learn_commusoft_recurring set next_check_at=clock_timestamp(),watermark=watermark-interval '1 hour';
select learn_commusoft_schedule_recurring();
select fixture_contact_capture('[{"id":101,"type":"customer"},{"id":202,"type":"customer"},{"id":303,"type":"workaddress"}]',false,null)->'checkpoint';
update learn_commusoft_recurring set next_check_at=clock_timestamp();
select learn_commusoft_schedule_recurring();
do $$begin
 if (select current_definition ?& array['updatedFrom','updatedBefore'] from learn_commusoft_recurring) is distinct from true then raise exception 'Missing fixed update bounds';end if;
end$$;
-- Loss of the approver's grant blocks provider admission immediately.
update platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=fixture_id(180);
do $$declare s learn_commusoft_recurring%rowtype;begin select * into s from learn_commusoft_recurring;
 if learn_commusoft_recurring_page_allowed(s.tenant_id,s.current_request::text) then raise exception 'Revoked actor accepted';end if;
 if exists(select 1 from learn_commusoft_claim_jobs(fixture_id(170))) then raise exception 'Revoked job claimed';end if;
end$$;
update platform_authority_grants set effective_to=null where profile_id=fixture_id(180);
set request.jwt.claim.role='authenticated';set role authenticated;
select learn_commusoft_recurring_read(fixture_id(100))->'accounts'->0->>'last_state';
reset role;
select 'Full bootstrap, four-stage receipt gating, pause/resume, immutable history, duplicate tick, revocation and incremental window checks passed';
