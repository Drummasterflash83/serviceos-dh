reset role;
-- Only this disposable synthetic fixture is modified. Historical source rows stay.
update platform_jobs set status='cancelled' where job_type='slack.history_sync';
update profiles set role='owner' where id=verify.id(911);
set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000911';
set role authenticated;
insert into verify.slack_import
 select learn_slack_start_import(verify.id(901),verify.id(961),verify.id(921),updated_at::text,
  'CWORK','2026-01-01','2026-01-02',3,'Synthetic durable worker approval') from provider_connections where id=verify.id(921);
reset role;
create table verify.worker_page as select a.tenant_id,a.id as account_id,(v.result->>'jobId')::uuid as job_id,
 jsonb_build_object('scopeKey',jsonb_build_array(a.tenant_id::text,s->>'teamId',s->>'channelId',s->>'oldest',s->>'latest',s->>'consentReference')::text,'cursor',null,'pages',0,'complete',false) as checkpoint
 from connector_accounts a cross join verify.slack_import v cross join lateral (select a.settings->'slack_history' as s) x
 where a.id=(v.result->>'accountId')::uuid and s->>'channelId'='CWORK';
grant select on verify.worker_page to service_role;
create table verify.worker_claim as select * from platform_jobs where false;
grant select,insert,delete on verify.worker_claim to service_role;
create table verify.worker_receipts(receipt jsonb);
grant select,insert on verify.worker_receipts to service_role;
insert into platform_jobs(id,tenant_id,job_type,job_key,status,payload)
 values(verify.id(962),verify.id(901),'email.synthetic','isolated-email','queued','{}');
set role service_role;
do $$begin
 assert not has_function_privilege('authenticated','learn_slack_claim_jobs(uuid,integer)','execute');
 assert not has_function_privilege('service_role','learn_slack_commit_page_private(uuid,uuid,uuid,jsonb,jsonb,jsonb)','execute');
 assert to_regprocedure('public.slack_history_commit_page(uuid,uuid,uuid,jsonb,jsonb,jsonb)') is null;
 assert not exists(select 1 from platform_jobs_claim('synthetic-generic',10,300,null) where job_type='slack.history_sync');
 assert (select status='running' from platform_jobs where id=verify.id(962));
end $$;
insert into verify.worker_claim select * from learn_slack_claim_jobs(verify.id(970),1);
do $$declare j record;r record;payload jsonb;next_cp jsonb;denied int:=0;begin
 select * into j from verify.worker_claim;select * into r from verify.worker_page;
 assert j.id=r.job_id and j.attempt_count=1;
 assert (select count(*)=0 from learn_slack_claim_jobs(verify.id(971),1));
 next_cp:=r.checkpoint||'{"pages":1,"cursor":"page-two","complete":false}';
 payload:=jsonb_build_array(jsonb_build_object('tenant_id',r.tenant_id,'channel_id','CWORK','source_external_id','TTEST:CWORK:1767225700.000001','provider_timestamp','1767225700.000001','thread_timestamp',null,'text','Synthetic durable message','provider_payload',jsonb_build_object('ts','1767225700.000001','text','Synthetic durable message')));
 begin perform slack_history_commit_page(r.tenant_id,r.job_id,r.account_id,'wrong',1,r.checkpoint,next_cp,payload);exception when sqlstate 'PT409' then denied:=denied+1;end;
 begin perform slack_history_commit_page(verify.id(902),r.job_id,r.account_id,j.claimed_by,1,r.checkpoint,next_cp,payload);exception when sqlstate 'PT409' then denied:=denied+1;end;
 assert denied=2;
 assert slack_history_commit_page(r.tenant_id,r.job_id,r.account_id,j.claimed_by,1,r.checkpoint,next_cp,payload);
 assert slack_history_commit_page(r.tenant_id,r.job_id,r.account_id,j.claimed_by,1,r.checkpoint,next_cp,payload),'Exact uncertain-response replay failed';
 begin perform slack_history_commit_page(r.tenant_id,r.job_id,r.account_id,j.claimed_by,1,next_cp,next_cp||'{"pages":2}',payload);exception when sqlstate 'PT409' then denied:=denied+1;end;
 assert denied=3;
 assert (select count(*)=1 from slack_messages where channel_id='CWORK');
 assert (select count(*)=1 from slack_message_versions v join slack_messages m on v.message_id=m.id where m.channel_id='CWORK');
 -- Simulate a process crash after publication, before completing its job.
 update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=j.id;
 begin perform learn_slack_finish_job(j.tenant_id,j.id,j.claimed_by,1,'{"success":true}');exception when sqlstate 'PT409' then denied:=denied+1;end;
 assert denied=4;
end $$;
insert into verify.worker_claim select * from learn_slack_claim_jobs(verify.id(971),1);
do $$declare j record;r record;denied boolean:=false;begin
 select * into j from verify.worker_claim where attempt_count=2;select * into r from verify.worker_page;
 assert j.metadata ? 'slack_page_v1','Committed page lost during recovery';
 begin perform slack_history_commit_page(r.tenant_id,r.job_id,r.account_id,'learn-slack:'||verify.id(970),1,r.checkpoint,r.checkpoint||'{"pages":1,"cursor":"page-two","complete":false}','[]');exception when sqlstate 'PT409' then denied:=true;end;
 assert denied,'Expired worker published under a replacement claim';
end $$;
reset role;
create function verify.reject_successor() returns trigger language plpgsql as $$begin
 if new.parent_job_id is not null then raise exception 'Injected successor failure';end if;return new;end $$;
create trigger verify_successor_failure before insert on platform_jobs for each row execute function verify.reject_successor();
set role service_role;
do $$declare j record;denied boolean:=false;begin
 select * into j from verify.worker_claim where attempt_count=2;
 begin perform learn_slack_finish_job(j.tenant_id,j.id,j.claimed_by,2,'{"success":true}');exception when others then
  assert sqlerrm='Injected successor failure';denied:=true;end;
 assert denied;
 assert (select status='running' and not metadata ? 'slack_finish_v1' from platform_jobs where id=j.id),'Successor failure did not roll back completion';
end $$;
reset role;drop trigger verify_successor_failure on platform_jobs;
set role service_role;
do $$declare j record;r jsonb;begin
 select * into j from verify.worker_claim where attempt_count=2;
 r:=learn_slack_finish_job(j.tenant_id,j.id,j.claimed_by,2,'{"success":true}');
 assert r=learn_slack_finish_job(j.tenant_id,j.id,j.claimed_by,2,'{"success":true}');
 assert (select count(*)=1 from platform_jobs where parent_job_id=j.id);
 assert (select available_at>=clock_timestamp()+interval '59 seconds' and status='queued' from platform_jobs where parent_job_id=j.id);
 assert (select result->>'stopReason'='run_page_limit' and result->'ingestion_complete'='false'::jsonb from platform_jobs where id=j.id);
 assert (select count(*)=0 from learn_slack_claim_jobs(verify.id(972),1));
 insert into verify.worker_receipts values(r);
 update platform_jobs set available_at=clock_timestamp()-interval '1 second' where id=(r->>'successor_id')::uuid;
end $$;
insert into verify.worker_claim select * from learn_slack_claim_jobs(verify.id(972),1);
do $$declare j record;r jsonb;outcome jsonb:='{"success":false,"code":"slack_history_rate_limited","retryable":true,"retry_after_seconds":120}';begin
 select * into j from verify.worker_claim where claimed_by='learn-slack:'||verify.id(972);
 r:=learn_slack_finish_job(j.tenant_id,j.id,j.claimed_by,j.attempt_count,outcome);
 assert r->>'status'='retrying';assert r=learn_slack_finish_job(j.tenant_id,j.id,j.claimed_by,j.attempt_count,outcome);
 assert (select available_at>=clock_timestamp()+interval '119 seconds' from platform_jobs where id=j.id);
 update platform_jobs set attempt_count=max_attempts,available_at=clock_timestamp()-interval '1 second' where id=j.id;
 assert (select count(*)=0 from learn_slack_claim_jobs(verify.id(973),1));
 assert (select status='dead_letter' and error_code='slack_history_attempts_exhausted' from platform_jobs where id=j.id);
 assert (select status='running' and claimed_by='synthetic-generic' from platform_jobs where id=verify.id(962)),'Slack worker touched unrelated email job';
end $$;
reset role;
do $$begin assert (select to_jsonb(e)=b.payload from email_messages e cross join verify.email_before b),'Existing email changed';end $$;
