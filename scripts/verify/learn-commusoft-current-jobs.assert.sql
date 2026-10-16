reset role;set request.jwt.claim.role='service_role';
-- Reset only the disposable scenario's synthetic step ledger; source pages remain.
truncate learn_commusoft_recurring_steps;
insert into learn_commusoft_current_jobs(account_id,tenant_id,enabled)
 select account_id,tenant_id,true from learn_commusoft_recurring;
-- New synthetic full cycle with an old frozen bound. It leaves two contacts
-- outstanding when the current-job refresh takes its turn.
update learn_commusoft_recurring set phase=0,current_request=null,current_definition=null,
 watermark=clock_timestamp()-interval '2 days',cycle_start=null,cycle_end=null,next_check_at=clock_timestamp();
select learn_commusoft_schedule_recurring();
select fixture_contact_capture('[{"id":101,"type":"customer"},{"id":202,"type":"customer"},{"id":303,"type":"workaddress"}]',false,null);
update learn_commusoft_recurring set next_check_at=clock_timestamp();
select learn_commusoft_schedule_recurring();
select fixture_contact_capture('[]',false,null);
update learn_commusoft_recurring set next_check_at=clock_timestamp();
select learn_commusoft_schedule_recurring();
create temporary table contact_before as select a.settings->'commusoft_import' approval,a.sync_cursor checkpoint,
 s.phase,s.current_request,s.current_definition,s.cycle_start,s.cycle_end,s.watermark,
 (select count(*) from learn_business_input_pages) pages from learn_commusoft_recurring s join connector_accounts a on a.id=s.account_id;
-- Independently verify refresh during the full-cycle rest, then return to the
-- unfinished-contact scenario below without changing its source evidence.
begin;
update learn_commusoft_current_jobs set enabled=false;
select fixture_contact_capture('[]',false,null);
select fixture_contact_capture('[]',false,null);
update learn_commusoft_recurring set next_check_at=clock_timestamp();
select learn_commusoft_schedule_recurring();
select fixture_contact_capture('[]',false,null);
update learn_commusoft_recurring set next_check_at=clock_timestamp();
select learn_commusoft_schedule_recurring();
create temporary table idle_before as select * from learn_commusoft_recurring;
do $$begin assert(select phase=0 and next_check_at>clock_timestamp()+interval '50 minutes' from idle_before),'Synthetic full cycle not resting';end$$;
update learn_commusoft_current_jobs set enabled=true;
select learn_commusoft_schedule_recurring();
do $$begin assert(select current_request is not null from learn_commusoft_current_jobs),'Idle jobs did not refresh';end$$;
select fixture_contact_capture('[{"id":901,"description":"001. Synthetic job","propertyID":101,"status":"Open"}]',false,null);
select learn_commusoft_schedule_recurring();
do $$begin
 assert(select s.phase=0 and s.current_request is null and s.current_definition is null and s.cycle_start is null and s.cycle_end is null
 and s.next_check_at=b.next_check_at and s.last_state=b.last_state and s.watermark=b.watermark from learn_commusoft_recurring s cross join idle_before b),'Idle restore changed full-cycle schedule or state';
end$$;
rollback;
select learn_commusoft_schedule_recurring();
do $$declare s learn_commusoft_recurring%rowtype;begin
 select * into s from learn_commusoft_recurring;
 assert s.phase=2 and s.current_definition->>'resource'='jobs','Jobs did not interleave with unfinished contacts';
 assert (select count(*)=1 from learn_commusoft_current_job_receipts where stage='started'),'Missing start receipt';
 assert not learn_commusoft_recurring_page_allowed(s.tenant_id,(select current_request::text from contact_before)),'Suspended contact job claimable';
 assert learn_commusoft_recurring_page_allowed(s.tenant_id,s.current_request::text),'Current jobs not claimable';
 assert (select count(*) from learn_business_input_pages)=(select pages from contact_before),'Scheduler fabricated source evidence';
end $$;
-- Duplicate ticks keep the same approval and cannot move either watermark.
select learn_commusoft_schedule_recurring();
do $$begin assert(select count(*)=1 from learn_commusoft_current_job_receipts),'Duplicate start';end$$;
-- A live lease prevents restoration/scope swapping even after pause.
update platform_jobs set status='running',lease_expires_at=clock_timestamp()+interval '5 minutes'
 where job_key=(select 'commusoft.source:'||account_id||':'||current_request from learn_commusoft_current_jobs);
update learn_commusoft_recurring set enabled=false;
select learn_commusoft_schedule_recurring();
do $$begin assert(select current_request is not null from learn_commusoft_current_jobs),'Changed scope under active GET';end$$;
update platform_jobs set status='queued',lease_expires_at=null
 where job_key=(select 'commusoft.source:'||account_id||':'||current_request from learn_commusoft_current_jobs);
update learn_commusoft_recurring set enabled=true;
-- Terminal failure and capture pause restore contact progress without a watermark.
begin;
savepoint incomplete_window;
update platform_jobs set status='dead_letter' where job_key=(select 'commusoft.source:'||account_id||':'||current_request from learn_commusoft_current_jobs);
select learn_commusoft_schedule_recurring();
do $$begin
 assert(select watermark is null and current_request is null and last_state='window_incomplete' from learn_commusoft_current_jobs),'Failure advanced freshness';
 assert(select a.sync_cursor=b.checkpoint and a.settings->'commusoft_import'=b.approval from connector_accounts a cross join contact_before b where a.tenant_id=fixture_id(100)),'Failed window lost contacts';
 assert(select count(*)=1 from learn_commusoft_current_job_receipts where stage='incomplete'),'Missing failure receipt';
end$$;
rollback to savepoint incomplete_window;
update learn_commusoft_recurring set enabled=false;
select learn_commusoft_schedule_recurring();
do $$begin assert(select watermark is null and current_request is null from learn_commusoft_current_jobs),'Paused window not restored';assert(select last_state='paused' from learn_commusoft_recurring),'Paused state broke existing frontend';end$$;
rollback;
-- A committed source page through the actual permit/writer/finish pipeline.
select fixture_contact_capture('[{"id":901,"jobNumber":"001","propertyID":101,"status":"Open"}]',false,null);
select learn_commusoft_schedule_recurring();
do $$declare s learn_commusoft_recurring%rowtype;a connector_accounts%rowtype;b record;begin
 select * into b from contact_before;select * into s from learn_commusoft_recurring;select * into a from connector_accounts where id=s.account_id;
 assert s.phase=b.phase and s.current_request=b.current_request and s.current_definition=b.current_definition
  and s.cycle_start is not distinct from b.cycle_start and s.cycle_end=b.cycle_end and s.watermark=b.watermark,'Full-cycle state changed';
 assert a.settings->'commusoft_import'=b.approval and a.sync_cursor=b.checkpoint,'Contact checkpoint not exactly restored';
 assert(select last_state='window_complete' and watermark>b.cycle_end and current_request is null from learn_commusoft_current_jobs),'Job-only watermark did not advance';
 assert learn_commusoft_recurring_page_allowed(s.tenant_id,s.current_request::text),'Contact approval not restored';
 assert(select payload->>'jobNumber'='001' and jsonb_typeof(payload->'jobNumber')='string' from learn_business_input_versions where external_id='901'),'Leading zeros changed';
end $$;
-- The original queued contact resumes, including its frozen parent plan.
select fixture_contact_capture('[]',false,null);
do $$begin assert(select (sync_cursor->>'propertiesCompleted')::integer=1 from connector_accounts where tenant_id=fixture_id(100)),'Contact progress lost';end$$;
-- A revoked operator must block further refreshes.
update learn_commusoft_current_jobs set next_check_at=clock_timestamp(),watermark=clock_timestamp()-interval '2 hours';
update platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=fixture_id(180);
select learn_commusoft_schedule_recurring();
do $$begin assert(select current_request is null from learn_commusoft_current_jobs),'Revoked operator queued jobs';end$$;
update platform_authority_grants set effective_to=null where profile_id=fixture_id(180);
set role authenticated;set request.jwt.claim.role='authenticated';
do $$begin
 begin perform learn_commusoft_schedule_current_jobs();raise exception 'Browser scheduled private jobs';exception when insufficient_privilege then null;end;
 begin perform 1 from learn_commusoft_current_jobs;raise exception 'Browser read private snapshot';exception when insufficient_privilege then null;end;
end$$;
reset role;set request.jwt.claim.role='service_role';
select 'Current jobs interleaved through real writer; idle refresh preserves full-cycle due time and frontend state; exact contact checkpoint restored; full watermark unchanged; duplicate tick, active lease, revocation, private grants and leading-zero code checks passed';
