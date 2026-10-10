reset role;
set test.role='authenticated';set test.actor='00000000-0000-4000-8000-000000000011';
-- Finish the current channel window using retained publication evidence.
update connector_accounts set sync_cursor=jsonb_build_object('complete',true,'pages',1,'cursor',null);
update platform_jobs set status='succeeded',metadata=jsonb_build_object('slack_page_v1',jsonb_build_object('account_id',payload->>'connector_account_id','next',(select sync_cursor from connector_accounts))) where status='queued';
set role authenticated;
do $$declare r jsonb;same jsonb;begin
 r:=learn_slack_recurring_threads_control('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000061',(select account_id from verify.fixture),1,true,'Include observed replies');
 same:=learn_slack_recurring_threads_control('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000061',(select account_id from verify.fixture),1,true,'Include observed replies');
 if r<>same or r->>'revision'<>'2' then raise exception 'Thread enable replay changed';end if;
end $$;
reset role;
select 'PASS: opt-in control and stable retry receipt';
set test.role='authenticated';set test.actor='00000000-0000-4000-8000-000000000012';set role authenticated;
do $$declare denied boolean:=false;begin
 begin perform learn_slack_recurring_threads_control('00000000-0000-4000-8000-000000000010',gen_random_uuid(),(select account_id from verify.fixture),2,false,'Viewer test');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Viewer changed thread approval';end if;
end $$;
reset role;
set test.actor='00000000-0000-4000-8000-000000000011';
insert into view_as_context values('00000000-0000-4000-8000-000000000011',null,null);
set role authenticated;
do $$declare denied boolean:=false;begin
 begin perform learn_slack_recurring_threads_control('00000000-0000-4000-8000-000000000010',gen_random_uuid(),(select account_id from verify.fixture),2,false,'Preview test');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Preview changed thread approval';end if;
end $$;
reset role;update view_as_context set ended_at=clock_timestamp();
set role authenticated;
do $$declare denied boolean:=false;begin
 begin perform learn_slack_recurring_control('00000000-0000-4000-8000-000000000010',gen_random_uuid(),(select account_id from verify.fixture),2,true,'Reapprove channel');exception when object_not_in_prerequisite_state then denied:=true;end;
 if not denied then raise exception 'Channel reapproval discarded unfinished replies';end if;
end $$;
reset role;
select 'PASS: viewer/preview cannot change thread approval and channel reapproval cannot skip pending replies';
set test.role='authenticated';set role authenticated;
do $$declare request uuid:=gen_random_uuid();account uuid:=(select account_id from verify.fixture);r jsonb;again jsonb;begin
 r:=learn_slack_recurring_threads_control('00000000-0000-4000-8000-000000000010',request,account,2,false,'Pending pause','check');
 if r->>'state'<>'pending' then raise exception 'Check applied thread pause';end if;
 r:=learn_slack_recurring_threads_control('00000000-0000-4000-8000-000000000010',request,account,2,false,'Pending pause','cancel');
 again:=learn_slack_recurring_threads_control('00000000-0000-4000-8000-000000000010',request,account,2,false,'Pending pause','apply');
 if r<>again or r->>'state'<>'cancelled' then raise exception 'Delayed thread request applied after cancellation';end if;
 r:=learn_slack_recurring_read('00000000-0000-4000-8000-000000000010')->'channels'->0->'threads';
 if r is null or r->'enabled'<>'true'::jsonb or r->'observed'<>'null'::jsonb then raise exception 'Initial thread summary incorrect';end if;
end $$;
reset role;
select 'PASS: read-only receipt checks and cancellation fence delayed copies; absent window counts remain unknown';
-- Twenty-three old observed parents, including a broadcast and timestamp aliases.
insert into slack_messages(id,tenant_id,source_external_id,team_id,channel_id,provider_timestamp,thread_timestamp,message_text,provider_payload,source_version,source_updated_at)
 select gen_random_uuid(),'00000000-0000-4000-8000-000000000010','parent-'||n,'TSETUP','CSETUP',(100+n)::text||'.1',null,'Synthetic parent',jsonb_build_object('reply_count',1),repeat('a',64),100+n from generate_series(1,22)n;
insert into slack_messages(id,tenant_id,source_external_id,team_id,channel_id,provider_timestamp,thread_timestamp,message_text,provider_payload,source_version,source_updated_at)
 values(gen_random_uuid(),'00000000-0000-4000-8000-000000000010','broadcast','TSETUP','CSETUP','200.1','123.1','Synthetic broadcast','{}',repeat('b',64),200.1),
 (gen_random_uuid(),'00000000-0000-4000-8000-000000000010','alias','TSETUP','CSETUP','201.1','123.100000','Alias broadcast','{}',repeat('c',64),201.1),
 (gen_random_uuid(),'00000000-0000-4000-8000-000000000010','foreign-channel','TSETUP','COTHER','202.1','124.1','Other channel','{}',repeat('d',64),202.1);
set test.role='service_role';set role service_role;
do $$begin
 if learn_slack_queue_recurring_threads((select account_id from verify.fixture)) then raise exception 'First page declared complete';end if;
 if (select count(*) from slack_thread_imports)<>20 then raise exception 'Batch limit failed';end if;
 if learn_slack_queue_recurring_threads((select account_id from verify.fixture)) then raise exception 'Uncaptured threads declared complete';end if;
 if (select count(*) from slack_thread_imports)<>23 then raise exception 'Observed parent discovery/deduplication failed';end if;
 perform learn_slack_queue_recurring_threads((select account_id from verify.fixture));
 if (select count(*) from slack_thread_imports)<>23 then raise exception 'Repeated scheduling duplicated imports';end if;
 if exists(select 1 from slack_thread_imports where scope->>'oldest'<>'1767312000.000000' or scope->>'latest'<>'1767312900.000000' or scope->>'maxPages'<>'10') then raise exception 'Thread scope widened';end if;
end $$;
reset role;
select 'PASS: bounded discovery revisits old threads, retains broadcast parents and deduplicates timestamp aliases';
set test.role='authenticated';set role authenticated;
do $$declare r jsonb;begin
 r:=learn_slack_recurring_read('00000000-0000-4000-8000-000000000010')->'channels'->0->'threads';
 if r->>'observed'<>'23' or r->>'completed'<>'0' or r->'discoveryComplete'<>'true'::jsonb then raise exception 'Thread progress summary incorrect: %',r;end if;
end $$;
reset role;set test.role='service_role';
select 'PASS: tenant-scoped summary shows retained observed/completed counts';
-- Main scheduler cannot skip the window while thread evidence is unfinished.
update slack_recurring_channels set next_check_at=clock_timestamp();
set role service_role;
do $$declare r jsonb;begin r:=learn_slack_schedule_recurring(10);if r->>'queued'<>'0' or r->>'held'<>'1' then raise exception 'Channel advanced before replies';end if;end $$;
reset role;
select 'PASS: channel progression holds while observed replies are unfinished';
-- Real credential and publication RPCs must enforce the ongoing gate.
update platform_jobs set status='running',claimed_by='learn-slack:fixture',attempt_count=1,lease_expires_at=clock_timestamp()+interval '1 hour' where job_type='slack.thread_sync';
update slack_recurring_channels set enabled=false;
set role service_role;
do $$declare t slack_thread_imports%rowtype;j platform_jobs%rowtype;denied boolean;begin
 select * into t from slack_thread_imports limit 1;select * into j from platform_jobs where id=t.initial_job_id;
 if learn_slack_recurring_thread_allowed(t.tenant_id,t.id) then raise exception 'Paused channel admitted thread';end if;
 denied:=false;begin perform learn_slack_read_thread_credential(t.tenant_id,j.id,j.claimed_by,1,(t.scope->>'connectionId')::uuid,'2026-10-09T10:00:00Z','00000000-0000-4000-8000-000000000021');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Paused credential gate missing';end if;
 denied:=false;begin perform slack_thread_commit_page(t.tenant_id,j.id,t.id,j.claimed_by,1,'{}','{}','[]');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Paused publication gate missing';end if;
end $$;
reset role;
update slack_recurring_channels set enabled=true,revision=revision+2;
set role service_role;
do $$declare t slack_thread_imports%rowtype;begin select * into t from slack_thread_imports limit 1;if not learn_slack_recurring_thread_allowed(t.tenant_id,t.id) then raise exception 'Channel pause/resume invalidated distinct thread revision';end if;end $$;
reset role;
select 'PASS: paused recurring capture blocks actual credential/publication RPCs; channel revision changes preserve thread approval';
update profiles set role='viewer' where id='00000000-0000-4000-8000-000000000011';
set role service_role;
do $$declare t slack_thread_imports%rowtype;begin select * into t from slack_thread_imports limit 1;if learn_slack_recurring_thread_allowed(t.tenant_id,t.id) then raise exception 'Revoked owner admitted thread';end if;end $$;
reset role;
update profiles set role='owner' where id='00000000-0000-4000-8000-000000000011';
-- Recover one failed thread through the actual owner RPC; its original row stays intact.
update platform_jobs set status='dead_letter' where job_type='slack.thread_sync';
set test.role='authenticated';set role authenticated;
do $$declare t slack_thread_imports%rowtype;r jsonb;state jsonb;begin
 select * into t from slack_thread_imports order by id limit 1;
 state:=learn_slack_thread_recovery_read(t.tenant_id,t.id);
 r:=learn_slack_resume_thread(t.tenant_id,gen_random_uuid(),t.id,state->>'stateVersion','continue',10,'Recover interrupted recurring replies');
 if r->>'previousImportId'<>t.id::text then raise exception 'Recovery lineage missing';end if;
end $$;
reset role;
set test.role='service_role';
-- Completion needs both checkpoint and durable successful publication.
update slack_thread_imports t set checkpoint='{"complete":true,"pages":1,"cursor":null}' where not exists(select 1 from slack_thread_imports child where child.definition->>'resumesImportId'=t.id::text);
set role service_role;
do $$begin if learn_slack_queue_recurring_threads((select account_id from verify.fixture)) then raise exception 'Bare checkpoint accepted';end if;end $$;
reset role;
update platform_jobs set status='succeeded',metadata=jsonb_build_object('slack_page_v1',jsonb_build_object('thread_import_id',payload->>'thread_import_id','next','{"complete":true,"pages":1,"cursor":null}'::jsonb)) where job_type='slack.thread_sync' and exists(select 1 from slack_thread_imports t where t.id::text=platform_jobs.payload->>'thread_import_id' and t.checkpoint->'complete'='true'::jsonb);
set role service_role;
do $$begin if not learn_slack_queue_recurring_threads((select account_id from verify.fixture)) then raise exception 'Complete retained window not recognized';end if;end $$;
reset role;
update slack_recurring_channels set next_check_at=clock_timestamp();
set role service_role;
do $$declare r jsonb;begin r:=learn_slack_schedule_recurring(10);if r->>'queued'<>'1' then raise exception 'Verified replies did not release next channel window';end if;end $$;
reset role;
select 'PASS: owner revocation denies reads; actual recovery lineage and durable completion release next window without rewriting the original import';
