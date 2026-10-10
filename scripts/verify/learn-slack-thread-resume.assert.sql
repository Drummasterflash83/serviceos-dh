reset role;
update platform_jobs set status='cancelled' where job_type in ('slack.history_sync','slack.thread_sync') and status in ('queued','running','retrying');
update profiles set role='owner' where id=verify.id(911);
update connector_accounts set status='active' where id=(select account_id from verify.thread_history);
set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000911';
create table verify.thread_resume_before as select
 (select count(*) from slack_messages where channel_id='CTHREAD') thread_message_count,
 (select jsonb_agg(to_jsonb(e) order by id) from email_messages e) emails,
 (select jsonb_agg(to_jsonb(m) order by id) from slack_messages m) messages,
 (select array_agg(id) from slack_messages) message_ids,
 (select jsonb_agg(to_jsonb(v) order by id) from slack_message_versions v) versions,
 (select array_agg(id) from slack_message_versions) version_ids;
grant select on verify.thread_resume_before to service_role;
create table verify.thread_recovery_review(state jsonb,receipt jsonb);
grant select,insert,update on verify.thread_recovery_review to authenticated,service_role;
create function verify.thread_resume_payload(stamp text,body text) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('tenant_id',verify.id(901),'channel_id','CTHREAD','source_external_id','TTEST:CTHREAD:'||stamp,
 'provider_timestamp',stamp,'thread_timestamp','1767225700.000001','text',body,'provider_payload',jsonb_build_object('ts',stamp,'thread_ts','1767225700.000001','text',body))) $$;
set role authenticated;
select learn_slack_start_thread_import(verify.id(901),verify.id(1500),(select account_id from verify.thread_history),
 (select id from slack_messages where channel_id='CTHREAD' and provider_timestamp='1767225700.000001'),
 (select source_version from slack_messages where channel_id='CTHREAD' and provider_timestamp='1767225700.000001'),
 (select updated_at from provider_connections where id=verify.id(921)),'2026-01-01','2026-01-02',1,'Synthetic bounded thread');
reset role;
update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TTEST';
set role service_role;
do $$declare j record;t record;cp jsonb;begin
 select * into j from learn_slack_claim_jobs(verify.id(1501),1);select * into t from slack_thread_imports where id=verify.id(1500);
 assert j.id=t.initial_job_id;
 cp:=jsonb_build_object('scopeKey',array_to_json(array[t.tenant_id::text,t.scope->>'teamId',t.scope->>'channelId',t.scope->>'oldest',t.scope->>'latest',t.scope->>'consentReference',t.scope->>'parentTimestamp'])::text,'cursor',null,'pages',0,'complete',false);
 assert slack_thread_commit_page(t.tenant_id,j.id,t.id,j.claimed_by,j.attempt_count,cp,cp||'{"pages":1,"cursor":"retained-thread-cursor"}',verify.thread_resume_payload('1767225900.000001','Synthetic first retained reply'));
 perform learn_slack_finish_thread_job(t.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
 assert not has_function_privilege('service_role','learn_slack_resume_thread(uuid,uuid,uuid,text,text,integer,text)','execute');
 assert not has_function_privilege('authenticated','learn_slack_thread_recovery_state(uuid,uuid)','execute');
 assert not has_function_privilege('anon','learn_slack_thread_recovery_read(uuid,uuid)','execute');
end $$;
reset role;
-- Synthetic expiry advancement only, with the immutable trigger immediately restored.
alter table slack_thread_imports disable trigger learn_thread_approval_immutable;
update slack_thread_imports set scope=jsonb_set(scope,'{expiresAt}',to_jsonb(clock_timestamp()-interval '1 hour')) where id=verify.id(1500);
alter table slack_thread_imports enable trigger learn_thread_approval_immutable;
create table verify.thread_recovery_original as select to_jsonb(t) value from slack_thread_imports t where id=verify.id(1500);
update profiles set role='viewer' where id=verify.id(911);
set role authenticated;
do $$declare s jsonb;begin
 s:=learn_slack_thread_recovery_read(verify.id(901),verify.id(1500));
 assert s->>'version'='learn-slack-thread-recovery/1' and s->'canContinue'='true'::jsonb and s->'canRestart'='true'::jsonb;
 assert s->'progress'='{"pagesThisApproval":1,"complete":false,"hasCursor":true}'::jsonb;
 assert s::text not like '%retained-thread-cursor%' and s::text not like '%scopeKey%' and not(s ? 'jobKey') and not(s ? 'scope');
 begin perform learn_slack_resume_thread(verify.id(901),verify.id(1502),verify.id(1500),s->>'stateVersion','continue',1,'Viewer approval');raise exception 'Viewer approved';exception when insufficient_privilege then null;end;
 begin perform learn_slack_thread_recovery_read(verify.id(902),verify.id(1500));raise exception 'Foreign read';exception when insufficient_privilege then null;end;
 insert into verify.thread_recovery_review(state) values(s);
end $$;
reset role;update profiles set role='owner' where id=verify.id(911);
insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref) values(verify.id(901),verify.id(911),'role','viewer');
set role authenticated;
do $$begin
 begin perform learn_slack_resume_thread(verify.id(901),verify.id(1502),verify.id(1500),(select state->>'stateVersion' from verify.thread_recovery_review),'continue',1,'Preview approval');raise exception 'Preview approved';exception when insufficient_privilege then null;end;
end $$;
reset role;update view_as_context set ended_at=clock_timestamp() where actor_user_id=verify.id(911) and ended_at is null;
set role authenticated;
do $$declare s jsonb;r jsonb;begin
 select state into s from verify.thread_recovery_review;
 r:=learn_slack_resume_thread(verify.id(901),verify.id(1502),verify.id(1500),s->>'stateVersion','continue',1,'Continue retained thread');
 assert r->'reused'='false'::jsonb and r->>'previousImportId'=verify.id(1500)::text;
 assert learn_slack_resume_thread(verify.id(901),verify.id(1502),verify.id(1500),s->>'stateVersion','continue',1,'Continue retained thread')=r||'{"reused":true}';
 begin perform learn_slack_resume_thread(verify.id(901),verify.id(1502),verify.id(1500),s->>'stateVersion','restart',1,'Continue retained thread');raise exception 'Changed identity accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_slack_resume_thread(verify.id(901),verify.id(1503),verify.id(1500),s->>'stateVersion','continue',1,'Stale review');raise exception 'Stale accepted';exception when sqlstate 'PT409' then null;end;
 s:=learn_slack_thread_recovery_read(verify.id(901),verify.id(1500));assert s->>'supersededBy'=verify.id(1502)::text and s->'canContinue'='false'::jsonb;
 s:=learn_slack_thread_recovery_read(verify.id(901),verify.id(1502));assert s->'active'='true'::jsonb and s->'canRestart'='false'::jsonb;
 begin perform learn_slack_resume_thread(verify.id(901),verify.id(1503),verify.id(1502),s->>'stateVersion','restart',1,'Active review');raise exception 'Active replaced';exception when sqlstate '55000' then null;end;
 update verify.thread_recovery_review set receipt=r;
end $$;
reset role;
do $$declare t record;begin
 select * into t from slack_thread_imports where id=verify.id(1502);
 assert (select value=to_jsonb(s) from slack_thread_imports s cross join verify.thread_recovery_original where s.id=verify.id(1500));
 assert t.checkpoint->>'cursor'='retained-thread-cursor' and t.checkpoint->'pages'='0'::jsonb;
 assert strpos(t.checkpoint->>'scopeKey',', ')=0 and (t.checkpoint->>'scopeKey')::jsonb->>5='learn-slack-thread:'||verify.id(1502)::text;
 assert t.definition->'previousState'->'checkpoint'->>'cursor'='retained-thread-cursor';
 assert (t.scope->>'expiresAt')::timestamptz>clock_timestamp()+interval '23 hours';
 assert t.scope-array['expiresAt','maxPages','consentReference']=(select scope-array['expiresAt','maxPages','consentReference'] from slack_thread_imports where id=verify.id(1500));
 assert (select sync_cursor->'complete'='true'::jsonb from connector_accounts where id=t.account_id),'Thread recovery changed channel progress';
end $$;
update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TTEST';
set role service_role;
do $$declare j record;t record;payload jsonb;begin
 select * into j from learn_slack_claim_jobs(verify.id(1504),1);select * into t from slack_thread_imports where id=verify.id(1502);assert j.id=t.initial_job_id;
 payload:=verify.thread_resume_payload('1767225900.000001','Synthetic first retained reply')||verify.thread_resume_payload('1767226000.000001','Synthetic next retained reply');
 assert slack_thread_commit_page(t.tenant_id,j.id,t.id,j.claimed_by,j.attempt_count,t.checkpoint,t.checkpoint||'{"pages":1,"cursor":"next-thread-cursor"}',payload);
 perform learn_slack_finish_thread_job(t.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
 assert (select count(*)=(select thread_message_count+2 from verify.thread_resume_before) from slack_messages where channel_id='CTHREAD');
 assert (select count(*)=4 from slack_message_versions v join slack_messages m on m.id=v.message_id where m.channel_id='CTHREAD');
end $$;
reset role;
create function verify.reject_thread_recovery() returns trigger language plpgsql as $$begin
 if new.payload->>'thread_import_id'=verify.id(1505)::text then raise exception 'Injected thread recovery queue failure';end if;return new;end $$;
create trigger verify_thread_recovery_failure before insert on platform_jobs for each row execute function verify.reject_thread_recovery();
set role authenticated;
do $$declare s jsonb;begin
 s:=learn_slack_thread_recovery_read(verify.id(901),verify.id(1502));
 begin perform learn_slack_resume_thread(verify.id(901),verify.id(1505),verify.id(1502),s->>'stateVersion','restart',2,'Reviewed restart');raise exception 'Failure injection missed';exception when others then assert sqlerrm='Injected thread recovery queue failure';end;
 assert learn_slack_thread_recovery_read(verify.id(901),verify.id(1502))=s;
 assert not exists(select 1 from slack_thread_imports where id=verify.id(1505));
end $$;
reset role;drop trigger verify_thread_recovery_failure on platform_jobs;
set role authenticated;
do $$declare s jsonb;begin
 s:=learn_slack_thread_recovery_read(verify.id(901),verify.id(1502));
 perform learn_slack_resume_thread(verify.id(901),verify.id(1505),verify.id(1502),s->>'stateVersion','restart',2,'Reviewed restart');
 assert (select checkpoint->'cursor'='null'::jsonb and checkpoint->'pages'='0'::jsonb and definition->'previousState'->'checkpoint'->>'cursor'='next-thread-cursor' from slack_thread_imports where id=verify.id(1505));
end $$;
reset role;update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TTEST';
set role service_role;
do $$declare j record;t record;begin
 select * into j from learn_slack_claim_jobs(verify.id(1506),1);select * into t from slack_thread_imports where id=verify.id(1505);assert j.id=t.initial_job_id;
 assert slack_thread_commit_page(t.tenant_id,j.id,t.id,j.claimed_by,j.attempt_count,t.checkpoint,t.checkpoint||'{"pages":1,"cursor":null,"complete":true}','[]');
 perform learn_slack_finish_thread_job(t.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
end $$;
set role authenticated;
do $$declare s jsonb;begin
 s:=learn_slack_thread_recovery_read(verify.id(901),verify.id(1505));assert s->'progress'->'complete'='true'::jsonb and s->'canRestart'='false'::jsonb;
 begin perform learn_slack_resume_thread(verify.id(901),verify.id(1507),verify.id(1505),s->>'stateVersion','continue',1,'Completed');raise exception 'Completed resumed';exception when sqlstate '55000' then null;end;
 s:=learn_slack_thread_recovery_read(verify.id(901),verify.id(1500));
 assert s->'active'='false'::jsonb and s->'canRestart'='false'::jsonb;
 begin perform learn_slack_resume_thread(verify.id(901),verify.id(1508),verify.id(1500),s->>'stateVersion','restart',1,'Superseded approval');raise exception 'Superseded resumed';exception when sqlstate '55000' then null;end;
 -- Exact retry resolves the old receipt after several later state transitions.
 select state into s from verify.thread_recovery_review;
 assert learn_slack_resume_thread(verify.id(901),verify.id(1502),verify.id(1500),s->>'stateVersion','continue',1,'Continue retained thread')->'reused'='true'::jsonb;
end $$;
reset role;
do $$begin
 assert (select emails is not distinct from (select jsonb_agg(to_jsonb(e) order by id) from email_messages e)
  and messages is not distinct from (select jsonb_agg(to_jsonb(m) order by id) from slack_messages m where m.id=any(b.message_ids))
  and versions is not distinct from (select jsonb_agg(to_jsonb(v) order by id) from slack_message_versions v where v.id=any(b.version_ids)) from verify.thread_resume_before b),'Existing communication evidence changed';
 assert (select value=to_jsonb(s) from slack_thread_imports s cross join verify.thread_recovery_original where s.id=verify.id(1500));
 begin update slack_thread_imports set definition=definition||'{"reason":"rewrite"}' where id=verify.id(1502);raise exception 'Approval changed';exception when sqlstate '55000' then null;end;
end $$;
-- Leave a stopped, untouched new approval for controlled transaction races.
set role authenticated;
select learn_slack_start_thread_import(verify.id(901),verify.id(1520),(select account_id from verify.thread_history),
 (select id from slack_messages where channel_id='CTHREAD' and provider_timestamp='1767225700.000001'),
 (select source_version from slack_messages where channel_id='CTHREAD' and provider_timestamp='1767225700.000001'),
 (select updated_at from provider_connections where id=verify.id(921)),'2026-01-01','2026-01-02',1,'Synthetic race candidate');
reset role;update platform_jobs set status='cancelled' where id=(select initial_job_id from slack_thread_imports where id=verify.id(1520));
