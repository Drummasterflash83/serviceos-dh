reset role;
update platform_jobs set status='cancelled' where job_type='slack.history_sync' and status in ('queued','running','retrying');
update profiles set role='owner' where id=verify.id(911);
set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000911';
set role authenticated;
insert into verify.slack_import
 select learn_slack_start_import(verify.id(901),verify.id(991),verify.id(921),updated_at::text,'CTHREAD','2026-01-01','2026-01-02',2,'Synthetic root discovery') from provider_connections where id=verify.id(921);
reset role;
create table verify.thread_history as select a.tenant_id,a.id as account_id,(v.result->>'jobId')::uuid as job_id,
 jsonb_build_object('scopeKey',jsonb_build_array(a.tenant_id::text,s->>'teamId',s->>'channelId',s->>'oldest',s->>'latest',s->>'consentReference')::text,'cursor',null,'pages',0,'complete',false) as checkpoint
 from connector_accounts a cross join verify.slack_import v cross join lateral (select a.settings->'slack_history' as s)x
 where a.id=(v.result->>'accountId')::uuid and s->>'channelId'='CTHREAD';
grant select on verify.thread_history to service_role,authenticated;
set role service_role;
select id from learn_slack_claim_jobs(verify.id(992),1);
do $$declare r record;j record;payload jsonb;begin
 select * into r from verify.thread_history;select * into j from platform_jobs where id=r.job_id;
 payload:=jsonb_build_array(jsonb_build_object('tenant_id',r.tenant_id,'channel_id','CTHREAD','source_external_id','TTEST:CTHREAD:1767225700.000001','provider_timestamp','1767225700.000001','thread_timestamp','1767225700.000001','text','Synthetic thread root','provider_payload',jsonb_build_object('ts','1767225700.000001','thread_ts','1767225700.000001','reply_count',2,'text','Synthetic thread root')));
 assert slack_history_commit_page(r.tenant_id,j.id,r.account_id,j.claimed_by,j.attempt_count,r.checkpoint,r.checkpoint||'{"pages":1,"complete":true}',payload);
 perform learn_slack_finish_job(r.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
end $$;
reset role;
create table verify.thread_approval(result jsonb);
grant select,insert on verify.thread_approval to authenticated,service_role;
set role authenticated;
do $$declare m record;a record;rev timestamptz;r jsonb;denied int:=0;begin
 select * into a from verify.thread_history;select * into m from slack_messages where channel_id='CTHREAD';
 select updated_at into rev from provider_connections where id=verify.id(921);
 r:=learn_slack_start_thread_import(verify.id(901),verify.id(993),a.account_id,m.id,m.source_version,rev,'2026-01-01','2026-01-02',3,'Synthetic replies approval');
 insert into verify.thread_approval values(r);
 assert (learn_slack_start_thread_import(verify.id(901),verify.id(993),a.account_id,m.id,m.source_version,rev,'2026-01-01','2026-01-02',3,'Synthetic replies approval')->>'jobId')=r->>'jobId';
 begin perform learn_slack_start_thread_import(verify.id(901),verify.id(993),a.account_id,m.id,m.source_version,rev,'2026-01-01','2026-01-02',2,'Synthetic replies approval');exception when sqlstate 'PT409' then denied:=denied+1;end;
 begin perform learn_slack_start_thread_import(verify.id(902),verify.id(994),a.account_id,m.id,m.source_version,rev,'2026-01-01','2026-01-02',3,'Foreign approval');exception when insufficient_privilege then denied:=denied+1;end;
 begin perform learn_slack_start_thread_import(verify.id(901),verify.id(994),a.account_id,m.id,repeat('0',64),rev,'2026-01-01','2026-01-02',3,'Changed source');exception when sqlstate 'PT409' then denied:=denied+1;end;
 assert denied=3;
 assert not has_table_privilege('authenticated','slack_thread_imports','INSERT,UPDATE,DELETE,TRUNCATE');
 assert not has_function_privilege('service_role','learn_slack_store_records(uuid,jsonb,jsonb,text)','execute');
end $$;
reset role;
set role service_role;
do $$begin
 assert not exists(select 1 from platform_jobs_claim('synthetic-generic-thread',10,300,null) where job_type in ('slack.history_sync','slack.thread_sync'));
end $$;
select id from learn_slack_claim_jobs(verify.id(995),1);
do $$declare j record;rev timestamptz;ref uuid;begin
 select * into j from platform_jobs where id=(select (result->>'jobId')::uuid from verify.thread_approval);
 assert j.status='running' and j.claimed_by='learn-slack:'||verify.id(995) and j.attempt_count=1;
 select updated_at into rev from provider_connections where id=verify.id(921);
 select id into ref from verify.credential_refs where kind='own';
 assert learn_slack_read_thread_credential(j.tenant_id,j.id,j.claimed_by,1,verify.id(921),rev,ref)='xoxb-synthetic-not-a-live-credential';
 assert learn_slack_read_thread_credential(verify.id(902),j.id,j.claimed_by,1,verify.id(921),rev,ref) is null;
 assert learn_slack_read_thread_credential(j.tenant_id,j.id,'wrong',1,verify.id(921),rev,ref) is null;
 assert learn_slack_read_thread_credential(j.tenant_id,j.id,j.claimed_by,2,verify.id(921),rev,ref) is null;
 assert learn_slack_read_thread_credential(j.tenant_id,j.id,j.claimed_by,1,verify.id(921),rev-interval '1 second',ref) is null;
 assert not has_function_privilege('authenticated','learn_slack_read_thread_credential(uuid,uuid,text,integer,uuid,timestamptz,uuid)','execute');
 assert not has_function_privilege('anon','learn_slack_finish_thread_job(uuid,uuid,text,integer,jsonb)','execute');
 begin
  perform learn_slack_finish_thread_job(j.tenant_id,j.id,j.claimed_by,1,'{"success":true}');
  raise exception 'Missing page was accepted';
 exception when sqlstate 'PT409' then assert sqlerrm='slack_queue_page_missing';end;
end $$;
do $$declare t record;j record;checkpoint jsonb;next_cp jsonb;payload jsonb;bad jsonb;denied int:=0;begin
 select * into t from slack_thread_imports where id=verify.id(993);select * into j from platform_jobs where id=t.initial_job_id;
 checkpoint:=jsonb_build_object('scopeKey',jsonb_build_array(t.tenant_id::text,t.scope->>'teamId',t.scope->>'channelId',t.scope->>'oldest',t.scope->>'latest',t.scope->>'consentReference',t.scope->>'parentTimestamp')::text,'cursor',null,'pages',0,'complete',false);
 next_cp:=checkpoint||'{"pages":1,"complete":false,"cursor":"synthetic-next-thread-page"}';
 payload:=jsonb_build_array(jsonb_build_object('tenant_id',t.tenant_id,'channel_id','CTHREAD','source_external_id','TTEST:CTHREAD:1767225800.000001','provider_timestamp','1767225800.000001','thread_timestamp','1767225700.000001','text','Synthetic retained reply','provider_payload',jsonb_build_object('ts','1767225800.000001','thread_ts','1767225700.000001','text','Synthetic retained reply')));
 bad:=jsonb_set(payload,'{0,thread_timestamp}','"1767225600.000001"');
 begin perform slack_thread_commit_page(t.tenant_id,j.id,t.id,j.claimed_by,1,checkpoint,next_cp,bad);exception when others then denied:=denied+1;end;
 assert (select count(*)=1 from slack_messages where channel_id='CTHREAD'),'Invalid thread page partially stored';
 assert (select st.checkpoint='{}'::jsonb from slack_thread_imports st where st.id=t.id),'Invalid page advanced checkpoint';
 begin perform slack_thread_commit_page(t.tenant_id,j.id,t.id,'wrong',1,checkpoint,next_cp,payload);exception when sqlstate 'PT409' then denied:=denied+1;end;
 assert denied=2;
 assert slack_thread_commit_page(t.tenant_id,j.id,t.id,j.claimed_by,1,checkpoint,next_cp,payload);
 assert slack_thread_commit_page(t.tenant_id,j.id,t.id,j.claimed_by,1,checkpoint,next_cp,payload);
 assert (select count(*)=2 from slack_messages where channel_id='CTHREAD');
 assert (select count(*)=2 from slack_message_versions v join slack_messages m on m.id=v.message_id where m.channel_id='CTHREAD');
 assert (select sync_cursor->'complete'='true'::jsonb and sync_cursor->'pages'='1'::jsonb from connector_accounts where id=t.account_id),'Thread changed channel cursor';
end $$;
reset role;
do $$begin
 assert (select count(*)=2 from interactions i join slack_messages m on i.source_id=m.id and i.source_table='slack_messages' where m.channel_id='CTHREAD');
 assert (select i.metadata->>'coverage'='observed_thread_page' and i.metadata->>'threads'='unverified' from interactions i join slack_messages m on i.source_id=m.id and i.source_table='slack_messages' where m.channel_id='CTHREAD' and m.provider_timestamp='1767225800.000001');
end $$;
-- Crash after page publication: replace the expired claim, retain the page,
-- refuse the old worker, and complete without another provider request.
update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=(select (result->>'jobId')::uuid from verify.thread_approval);
set role service_role;
select id from learn_slack_claim_jobs(verify.id(996),1);
do $$declare j record;begin
 select * into j from platform_jobs where id=(select (result->>'jobId')::uuid from verify.thread_approval);
 assert j.attempt_count=2 and j.metadata ? 'slack_page_v1';
 begin
  perform learn_slack_finish_thread_job(j.tenant_id,j.id,'learn-slack:'||verify.id(995),1,'{"success":true}');
  raise exception 'Old worker completed reclaimed job';
 exception when sqlstate 'PT409' then assert sqlerrm='slack_queue_not_owned';end;
 assert learn_slack_read_thread_credential(j.tenant_id,j.id,j.claimed_by,2,verify.id(921),
  (select updated_at from provider_connections where id=verify.id(921)),(select id from verify.credential_refs where kind='own')) is null,'Published page obtained another credential';
end $$;
reset role;
create trigger verify_thread_successor_failure before insert on platform_jobs for each row execute function verify.reject_successor();
set role service_role;
do $$declare j record;begin
 select * into j from platform_jobs where id=(select (result->>'jobId')::uuid from verify.thread_approval);
 begin
  perform learn_slack_finish_thread_job(j.tenant_id,j.id,j.claimed_by,2,'{"success":true}');
  raise exception 'Injected failure was missed';
 exception when others then assert sqlerrm='Injected successor failure';end;
 assert (select status='running' and not metadata ? 'slack_finish_v1' from platform_jobs where id=j.id),'Successor failure partially completed thread job';
end $$;
reset role;
drop trigger verify_thread_successor_failure on platform_jobs;
set role service_role;
do $$declare j record;r jsonb;begin
 select * into j from platform_jobs where id=(select (result->>'jobId')::uuid from verify.thread_approval);
 r:=learn_slack_finish_thread_job(j.tenant_id,j.id,j.claimed_by,2,'{"success":true}');
 assert r=learn_slack_finish_thread_job(j.tenant_id,j.id,j.claimed_by,2,'{"success":true}');
 assert (select count(*)=1 from platform_jobs where parent_job_id=j.id);
 assert (select available_at>=clock_timestamp()+interval '59 seconds' and status='queued' from platform_jobs where parent_job_id=j.id);
 assert (select result->>'coverage'='observed_thread_window' and result->>'threadCoverage'='observed_thread_window_incomplete' and result->'ingestion_complete'='false'::jsonb from platform_jobs where id=j.id);
 assert (select count(*)=0 from learn_slack_claim_jobs(verify.id(997),1));
 update platform_jobs set available_at=clock_timestamp()-interval '1 second' where id=(r->>'successor_id')::uuid;
end $$;
select id from learn_slack_claim_jobs(verify.id(997),1);
do $$declare j record;r jsonb;outcome jsonb:='{"success":false,"code":"slack_history_rate_limited","retryable":true,"retry_after_seconds":120}';begin
 select * into j from platform_jobs where claimed_by='learn-slack:'||verify.id(997);
 r:=learn_slack_finish_thread_job(j.tenant_id,j.id,j.claimed_by,1,outcome);
 assert r->>'status'='retrying';assert r=learn_slack_finish_thread_job(j.tenant_id,j.id,j.claimed_by,1,outcome);
 assert (select available_at>=clock_timestamp()+interval '119 seconds' from platform_jobs where id=j.id);
 update platform_jobs set available_at=clock_timestamp()-interval '1 second' where id=j.id;
end $$;
select id from learn_slack_claim_jobs(verify.id(998),1);
do $$declare j record;t record;r jsonb;begin
 select * into j from platform_jobs where claimed_by='learn-slack:'||verify.id(998);
 select * into t from slack_thread_imports where id=verify.id(993);
 assert j.attempt_count=2;
 assert slack_thread_commit_page(j.tenant_id,j.id,t.id,j.claimed_by,2,t.checkpoint,t.checkpoint||'{"pages":2,"cursor":null,"complete":true}','[]');
 r:=learn_slack_finish_thread_job(j.tenant_id,j.id,j.claimed_by,2,'{"success":true}');
 assert r->>'successor_id' is null;
 assert (select result->>'threadCoverage'='observed_thread_window_complete' and result->'ingestion_complete'='false'::jsonb from platform_jobs where id=j.id);
 assert (select count(*)=0 from learn_slack_claim_jobs(verify.id(999),1));
 assert (select count(*)=2 from slack_messages where channel_id='CTHREAD');
end $$;
reset role;
do $$declare denied int:=0;begin
 begin update slack_thread_imports set scope='{}' where id=verify.id(993);exception when sqlstate '55000' then denied:=denied+1;end;
 begin delete from slack_thread_imports where id=verify.id(993);exception when sqlstate '55000' then denied:=denied+1;end;
 begin truncate slack_thread_imports;exception when sqlstate '55000' then denied:=denied+1;end;
 assert denied=3;
 assert (select to_jsonb(e)=b.payload from email_messages e cross join verify.email_before b),'Existing email changed';
end $$;
set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000912';
set role authenticated;
do $$begin assert (select count(*)=0 from slack_thread_imports),'Foreign company sees thread approval';end $$;
reset role;
