reset role;
-- Only synthetic disposable queue fixtures. All existing source evidence is snapshotted.
create table verify.pacing_sources_before as select
 (select jsonb_agg(to_jsonb(e) order by id) from email_messages e) as emails,
 (select jsonb_agg(to_jsonb(m) order by id) from slack_messages m) as messages,
 (select jsonb_agg(to_jsonb(v) order by id) from slack_message_versions v) as versions,
 (select jsonb_agg(to_jsonb(i) order by id) from interactions i) as interactions;
update platform_jobs set status='cancelled' where job_type in ('slack.history_sync','slack.thread_sync') and status in ('queued','running','retrying');
-- Same workspace through a different company and connector must share the gate.
insert into tenant_connectors(id,tenant_id,connector_id,provider,category)
 values(verify.id(1200),verify.id(902),'slack','slack','communication');
insert into connector_accounts(id,tenant_connector_id,tenant_id,account_key,settings)
 values(verify.id(1201),verify.id(1200),verify.id(902),'synthetic-same-workspace','{"slack_history":{"teamId":"TTEST"}}'),
 (verify.id(1202),verify.id(1200),verify.id(902),'synthetic-other-workspace','{"slack_history":{"teamId":"TOTHER"}}');
insert into platform_jobs(id,tenant_id,connector_id,job_type,job_key,payload,priority)
 select verify.id(1210),tenant_id,'slack','slack.history_sync','slack.history:'||account_id::text,jsonb_build_object('connector_account_id',account_id),1 from verify.thread_history;
insert into platform_jobs(id,tenant_id,connector_id,job_type,job_key,payload,priority)
 select verify.id(1211),tenant_id,'slack','slack.thread_sync','synthetic-thread',jsonb_build_object('connector_account_id',account_id,'thread_import_id',id),2 from slack_thread_imports where id=verify.id(993);
insert into platform_jobs(id,tenant_id,connector_id,job_type,job_key,payload,priority)
 values(verify.id(1212),verify.id(902),'slack','slack.history_sync','synthetic-other-company',jsonb_build_object('connector_account_id',verify.id(1201)),3),
 (verify.id(1213),verify.id(902),'slack','slack.history_sync','synthetic-other-workspace',jsonb_build_object('connector_account_id',verify.id(1202)),4);
set role service_role;
do $$declare claimed uuid[];j record;r jsonb;before_pace jsonb;begin
 select array_agg(id order by id) into claimed from learn_slack_claim_jobs(verify.id(1220),5);
 assert claimed=array[verify.id(1210),verify.id(1213)],'Shared workspace allowed concurrent jobs or blocked a different workspace';
 assert (select attempt_count=0 and error_count=0 and status='queued' and available_at>clock_timestamp() from platform_jobs where id=verify.id(1211));
 assert (select attempt_count=0 and status='queued' from platform_jobs where id=verify.id(1212)),'Company partition bypassed workspace budget';
 assert (select active_job_id=verify.id(1210) and next_allowed_at>clock_timestamp()+interval '239 seconds' from slack_workspace_pacing where team_id='TTEST');
 select * into j from platform_jobs where id=verify.id(1210);
 begin
  perform learn_slack_finish_job(j.tenant_id,j.id,'wrong',j.attempt_count,'{"success":false,"code":"slack_history_rate_limited","retryable":true,"retry_after_seconds":3600}');
  raise exception 'Foreign claim changed budget';
 exception when sqlstate 'PT409' then assert sqlerrm='slack_queue_not_owned';end;
 assert (select blocked_until='-infinity'::timestamptz from slack_workspace_pacing where team_id='TTEST');
 r:=learn_slack_finish_job(j.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":false,"code":"slack_history_rate_limited","retryable":true,"retry_after_seconds":120}');
 assert r->>'status'='retrying';
 assert (select active_job_id is null and next_allowed_at>=clock_timestamp()+interval '119 seconds' and blocked_until>=clock_timestamp()+interval '119 seconds' from slack_workspace_pacing where team_id='TTEST');
 select to_jsonb(p) into before_pace from slack_workspace_pacing p where team_id='TTEST';
 assert r=learn_slack_finish_job(j.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":false,"code":"slack_history_rate_limited","retryable":true,"retry_after_seconds":120}');
 assert (select to_jsonb(p)=before_pace from slack_workspace_pacing p where team_id='TTEST'),'Completion replay extended shared cooldown';
 update platform_jobs set available_at='-infinity' where id in(verify.id(1211),verify.id(1212));
 assert (select count(*)=0 from learn_slack_claim_jobs(verify.id(1221),5));
 assert (select available_at>=clock_timestamp()+interval '119 seconds' and attempt_count=0 from platform_jobs where id=verify.id(1211)),'Rate limit not shared with thread';
 assert (select available_at>=clock_timestamp()+interval '119 seconds' and attempt_count=0 from platform_jobs where id=verify.id(1212)),'Rate limit not shared with another company';
end $$;
reset role;
-- Advance only synthetic timing gates. No sleeping or external provider calls.
update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity' where team_id='TTEST';
update platform_jobs set available_at='-infinity' where id=verify.id(1211);
set role service_role;
do $$declare j record;r jsonb;begin
 select * into j from learn_slack_claim_jobs(verify.id(1222),1);
 assert j.id=verify.id(1211) and j.attempt_count=1;
 r:=learn_slack_finish_thread_job(j.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":false,"code":"slack_history_rate_limited","retryable":true,"retry_after_seconds":180}');
 assert r->>'status'='retrying';
 assert (select active_job_id is null and blocked_until>clock_timestamp()+interval '179 seconds' from slack_workspace_pacing where team_id='TTEST'),'Thread rate limit failed to update workspace';
end $$;
reset role;
-- A committed page can settle without another provider request, even when the
-- provider attempt budget is exhausted and a different job owns the workspace.
update platform_jobs set status='cancelled' where id=verify.id(1210);
insert into platform_jobs(id,tenant_id,connector_id,job_type,job_key,payload,metadata,status,claimed_by,attempt_count,max_attempts,lease_expires_at,priority)
 select verify.id(1214),j.tenant_id,j.connector_id,j.job_type,j.job_key,j.payload,
 (j.metadata-'slack_finish_v1')||jsonb_build_object('slack_workspace_v1',jsonb_build_object('teamId','TTEST')),
 'running','learn-slack:'||verify.id(1223)::text,3,3,clock_timestamp()-interval '1 second',0
 from platform_jobs j join verify.thread_history h on h.job_id=j.id;
update slack_workspace_pacing set active_job_id=verify.id(1212),next_allowed_at=clock_timestamp()+interval '300 seconds' where team_id='TTEST';
set role service_role;
do $$declare j record;before_pace jsonb;r jsonb;begin
 select to_jsonb(p) into before_pace from slack_workspace_pacing p where team_id='TTEST';
 select * into j from learn_slack_claim_jobs(verify.id(1224),1);
 assert j.id=verify.id(1214) and j.attempt_count=4 and j.metadata ? 'slack_page_v1','Saved-page recovery was blocked by budget';
 r:=learn_slack_finish_job(j.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
 assert r->>'status'='succeeded' and r->'successor_id'='null'::jsonb;
 assert (select to_jsonb(p)=before_pace from slack_workspace_pacing p where team_id='TTEST'),'Old page settlement released a newer reservation';
 assert not has_table_privilege('authenticated','slack_workspace_pacing','SELECT,INSERT,UPDATE,DELETE,TRUNCATE');
 assert not has_table_privilege('anon','slack_workspace_pacing','SELECT,INSERT,UPDATE,DELETE,TRUNCATE');
 assert not has_table_privilege('service_role','slack_workspace_pacing','DELETE,TRUNCATE');
end $$;
reset role;
-- Completion and gate release are one transaction, including failure rollback.
update platform_jobs set status='cancelled' where id in (verify.id(1210),verify.id(1211),verify.id(1212),verify.id(1213));
update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null;
insert into platform_jobs(id,tenant_id,connector_id,job_type,job_key,payload,priority)
 select verify.id(1215),tenant_id,'slack','slack.history_sync','slack.history:'||account_id::text,jsonb_build_object('connector_account_id',account_id),1 from verify.thread_history;
set role service_role;
select id from learn_slack_claim_jobs(verify.id(1225),1);
reset role;
create function verify.reject_pacing_release() returns trigger language plpgsql as $$begin
 if new.active_job_id is null then raise exception 'Injected pacing release failure';end if;return new;end $$;
create trigger verify_pacing_failure before update on slack_workspace_pacing for each row execute function verify.reject_pacing_release();
set role service_role;
do $$declare j record;begin
 select * into j from platform_jobs where id=verify.id(1215);
 begin
  perform learn_slack_finish_job(j.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":false,"code":"slack_history_provider_error","retryable":true,"retry_after_seconds":0}');
  raise exception 'Injected pacing failure missed';
 exception when others then assert sqlerrm='Injected pacing release failure';end;
 assert (select status='running' and not metadata ? 'slack_finish_v1' from platform_jobs where id=j.id),'Pacing failure partially settled job';
 assert (select active_job_id=j.id from slack_workspace_pacing where team_id='TTEST');
end $$;
reset role;
drop trigger verify_pacing_failure on slack_workspace_pacing;
set role service_role;
do $$declare j record;begin
 select * into j from platform_jobs where id=verify.id(1215);
 perform learn_slack_finish_job(j.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":false,"code":"slack_history_provider_error","retryable":true,"retry_after_seconds":0}');
 assert (select active_job_id is null and next_allowed_at>clock_timestamp()+interval '59 seconds' and next_allowed_at<clock_timestamp()+interval '61 seconds' from slack_workspace_pacing where team_id='TTEST'),'Short job kept its full abandoned-lease reservation';
end $$;
reset role;
do $$begin
 assert (select emails is not distinct from (select jsonb_agg(to_jsonb(e) order by id) from email_messages e) and messages is not distinct from (select jsonb_agg(to_jsonb(m) order by id) from slack_messages m)
  and versions is not distinct from (select jsonb_agg(to_jsonb(v) order by id) from slack_message_versions v) and interactions is not distinct from (select jsonb_agg(to_jsonb(i) order by id) from interactions i) from verify.pacing_sources_before),'Existing communications changed';
end $$;
