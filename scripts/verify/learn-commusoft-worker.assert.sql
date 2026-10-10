set request.jwt.claim.role='service_role';
do $$declare job public.platform_jobs%rowtype;permit jsonb;receipt jsonb;begin
 if has_function_privilege('authenticated','learn_commusoft_claim_jobs(uuid)','execute') or
    has_function_privilege('anon','learn_commusoft_finish_job(uuid,uuid,text,integer,jsonb)','execute') then raise exception 'queue grants unsafe';end if;
 if exists(select 1 from platform_jobs_claim('generic',10,300,null) where job_type='commusoft.source_sync') then raise exception 'generic worker stole Commusoft';end if;
 select * into job from learn_commusoft_claim_jobs(fixture_id(50));
 if job.id<>fixture_id(2) or job.attempt_count<>1 or job.claimed_by<>'learn-commusoft:'||fixture_id(50) then raise exception 'claim fence invalid';end if;
 if exists(select 1 from learn_commusoft_claim_jobs(fixture_id(51))) then raise exception 'duplicate claim';end if;
 permit:=learn_commusoft_acquire_page(fixture_id(1),job.id,job.claimed_by,job.attempt_count,fixture_expected());
 update platform_jobs set job_key='changed-approval' where id=job.id;
 begin perform learn_commusoft_commit_page(fixture_id(1),job.id,job.claimed_by,job.attempt_count,(permit->>'permitId')::uuid,
  '{"data":[{"id":1}],"pagination":{"hasMore":false,"nextCursor":1}}');raise exception 'changed job approval accepted';exception when sqlstate 'PT409' then null;end;
 update platform_jobs set job_key=job.job_key where id=job.id;
 receipt:=learn_commusoft_commit_page(fixture_id(1),job.id,job.claimed_by,job.attempt_count,(permit->>'permitId')::uuid,
  '{"data":[{"id":1,"type":"customer"}],"pagination":{"hasMore":true,"nextCursor":1}}');
 if receipt is null then raise exception 'page not committed';end if;
 perform learn_commusoft_defer_page(fixture_id(1),job.id,job.claimed_by,job.attempt_count,(permit->>'permitId')::uuid,clock_timestamp()+interval '10 minutes');
end $$;
-- Failure to enqueue must roll back completion, preserving the committed page.
create function fixture_fail_successor() returns trigger language plpgsql as $$begin raise exception 'injected successor failure';end$$;
create trigger fixture_fail_successor before insert on platform_jobs for each row execute function fixture_fail_successor();
do $$begin
 begin perform learn_commusoft_finish_job(fixture_id(1),fixture_id(2),'learn-commusoft:'||fixture_id(50),1,'{"success":true}');raise exception 'injection did not run';
 exception when raise_exception then if sqlerrm<>'injected successor failure' then raise;end if;end;
 if (select status from platform_jobs where id=fixture_id(2))<>'running' or
    (select count(*) from learn_business_input_pages)<>1 or (select count(*) from platform_jobs)<>1 then raise exception 'settlement atomicity failed';end if;
end $$;
drop trigger fixture_fail_successor on platform_jobs;
create table fixture_worker_state(answer jsonb);
set role service_role;
-- Actual permission path; completion response is also captured by a later replay.
select learn_commusoft_finish_job(fixture_id(1),fixture_id(2),'learn-commusoft:'||fixture_id(50),1,'{"success":true}')->>'status';
reset role;
insert into fixture_worker_state select learn_commusoft_finish_job(fixture_id(1),fixture_id(2),'learn-commusoft:'||fixture_id(50),1,'{"success":true}');
do $$declare answer jsonb;job public.platform_jobs%rowtype;permit jsonb;begin
 select s.answer into answer from fixture_worker_state s;
 if answer->>'status'<>'succeeded' or (answer->>'successor_id')::uuid is null or (select count(*) from platform_jobs)<>2 then raise exception 'atomic successor missing';end if;
 if (select available_at from platform_jobs where id=(answer->>'successor_id')::uuid)<clock_timestamp()+interval '599 seconds' then raise exception 'successor ignored shared cooldown';end if;
 if learn_commusoft_finish_job(fixture_id(1),fixture_id(2),'learn-commusoft:'||fixture_id(50),1,'{"success":true}') is distinct from answer then raise exception 'settlement replay changed';end if;
 begin perform learn_commusoft_finish_job(fixture_id(1),fixture_id(2),'learn-commusoft:'||fixture_id(50),1,'{"success":false,"code":"commusoft_worker_failed","retryable":true,"retry_after_seconds":0}');raise exception 'changed settlement replay accepted';exception when sqlstate 'PT409' then null;end;
 if exists(select 1 from learn_commusoft_claim_jobs(fixture_id(51))) then raise exception 'successor not delayed';end if;
 update platform_jobs set available_at=clock_timestamp()-interval '1 second' where status='queued';
 update learn_business_input_request_gates set next_allowed_at=clock_timestamp()-interval '1 second';
 select * into job from learn_commusoft_claim_jobs(fixture_id(51));
 permit:=learn_commusoft_acquire_page(fixture_id(1),job.id,job.claimed_by,job.attempt_count,fixture_expected(job.id));
 perform learn_commusoft_commit_page(fixture_id(1),job.id,job.claimed_by,job.attempt_count,(permit->>'permitId')::uuid,
  '{"data":[{"id":2,"type":"customer"}],"pagination":{"hasMore":true,"nextCursor":2}}');
 -- Recover an expired worker beyond the attempt budget, because its page is committed.
 update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second',max_attempts=1 where id=job.id;
 select * into job from learn_commusoft_claim_jobs(fixture_id(52));
 if job.attempt_count<>2 then raise exception 'committed page not recovered';end if;
 if learn_commusoft_committed_page(fixture_id(1),job.id,job.claimed_by,job.attempt_count) is null then raise exception 'recovered receipt missing';end if;
 update feature_flags set value='false' where flag='learn.enabled';
 answer:=learn_commusoft_finish_job(fixture_id(1),job.id,job.claimed_by,job.attempt_count,'{"success":true}');
 if answer->>'status'<>'succeeded' or answer->'successor_id'<>'null'::jsonb or (select count(*) from platform_jobs)<>2 then raise exception 'disabled processing continued';end if;
 if (select result->>'stop_reason' from platform_jobs where id=job.id)<>'authorisation_changed' then raise exception 'disabled stop not explicit';end if;
 update feature_flags set value='true';
end $$;
-- Uncommitted retry and stale-owner fencing, retaining the provider's minimum delay.
insert into platform_jobs(id,tenant_id,job_type,job_key,status,attempt_count,max_attempts,payload,metadata)
 values(fixture_id(22),fixture_id(1),'commusoft.source_sync','fixture-failure','queued',0,2,jsonb_build_object('connector_account_id',fixture_id(3)),'{}');
do $$declare job public.platform_jobs%rowtype;answer jsonb;begin
 select * into job from learn_commusoft_claim_jobs(fixture_id(53));
 begin perform learn_commusoft_finish_job(fixture_id(1),job.id,'other',1,'{"success":true}');raise exception 'foreign worker settled';exception when sqlstate 'PT409' then null;end;
 begin perform learn_commusoft_finish_job(fixture_id(1),job.id,job.claimed_by,1,'{"success":true}');raise exception 'missing page succeeded';exception when sqlstate 'PT409' then if sqlerrm<>'commusoft_queue_page_missing' then raise;end if;end;
 answer:=learn_commusoft_finish_job(fixture_id(1),job.id,job.claimed_by,1,'{"success":false,"code":"commusoft_rate_limited","retryable":true,"retry_after_seconds":600}');
 if answer->>'status'<>'retrying' or (select available_at from platform_jobs where id=job.id)<clock_timestamp()+interval '599 seconds' then raise exception 'retry delay lost';end if;
 update platform_jobs set available_at=clock_timestamp()-interval '1 second' where id=job.id;
 select * into job from learn_commusoft_claim_jobs(fixture_id(54));
 answer:=learn_commusoft_finish_job(fixture_id(1),job.id,job.claimed_by,2,'{"success":false,"code":"commusoft_provider_unavailable","retryable":true,"retry_after_seconds":0}');
 if answer->>'status'<>'dead_letter' then raise exception 'attempt budget ignored';end if;
end $$;
select 'worker claim, atomic continuation, replay, recovery, revocation and retry assertions passed' as result;
