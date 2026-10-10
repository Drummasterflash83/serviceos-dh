reset role;
update platform_jobs set status='cancelled' where job_type in ('slack.history_sync','slack.thread_sync') and status in ('queued','running','retrying');
update profiles set role='owner' where id=verify.id(911);
create table verify.resume_sources_before as select
 (select jsonb_agg(to_jsonb(e) order by id) from email_messages e) as emails,
 (select jsonb_agg(to_jsonb(m) order by id) from slack_messages m) as messages,
 (select jsonb_agg(to_jsonb(v) order by id) from slack_message_versions v) as versions;
set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000911';
set role authenticated;
insert into verify.slack_import select learn_slack_start_import(verify.id(901),verify.id(1310),verify.id(921),updated_at::text,'CRESUME','2026-01-01','2026-01-02',1,'Synthetic initial window') from provider_connections where id=verify.id(921);
reset role;
create table verify.history_recovery as select a.id as account_id,a.settings->'slack_history' as original_scope,
 jsonb_build_object('scopeKey',array_to_json(array[a.tenant_id::text,s->>'teamId',s->>'channelId',s->>'oldest',s->>'latest',s->>'consentReference'])::text,'cursor',null,'pages',0,'complete',false) as initial_cp
 from connector_accounts a cross join lateral(select a.settings->'slack_history' as s)x where a.tenant_id=verify.id(901) and a.settings->'slack_history'->>'channelId'='CRESUME';
grant select,update on verify.history_recovery to authenticated,service_role;
create table verify.history_review(state jsonb,receipt jsonb);
grant select,insert,update on verify.history_review to authenticated,service_role;
update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TTEST';
set role service_role;
do $$declare j record;a record;r jsonb;payload jsonb;begin
 select * into j from learn_slack_claim_jobs(verify.id(1311),1);select * into a from verify.history_recovery;
 payload:=jsonb_build_array(jsonb_build_object('tenant_id',verify.id(901),'channel_id','CRESUME','source_external_id','TTEST:CRESUME:1767225700.000001','provider_timestamp','1767225700.000001','thread_timestamp',null,'text','Synthetic retained first page','provider_payload',jsonb_build_object('ts','1767225700.000001','text','Synthetic retained first page')));
 assert slack_history_commit_page(j.tenant_id,j.id,a.account_id,j.claimed_by,j.attempt_count,a.initial_cp,a.initial_cp||'{"pages":1,"cursor":"saved-provider-cursor"}',payload);
 r:=learn_slack_finish_job(j.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
 assert r->>'status'='succeeded' and r->'successor_id'='null'::jsonb;
 assert (select result->>'stopReason'='page_budget_exhausted' from platform_jobs where id=j.id);
 assert not has_function_privilege('service_role','learn_slack_resume_history(uuid,uuid,uuid,text,text,integer,text)','execute');
 assert not has_function_privilege('authenticated','learn_slack_history_state(uuid,uuid)','execute');
 assert not has_function_privilege('anon','learn_slack_history_read(uuid,uuid)','execute');
end $$;
reset role;
-- A fresh approval can renew an expired window without changing its bounds/cursor.
update connector_accounts set settings=jsonb_set(settings,'{slack_history,expiresAt}',to_jsonb(clock_timestamp()-interval '1 hour')) where id=(select account_id from verify.history_recovery);
update profiles set role='viewer' where id=verify.id(911);
set role authenticated;
do $$declare state jsonb;a uuid;begin
 select account_id into a from verify.history_recovery;state:=learn_slack_history_read(verify.id(901),a);
 assert state->>'version'='learn-slack-history/1' and state->'stateValid'='true'::jsonb and state->'canContinue'='true'::jsonb and state->'canRestart'='true'::jsonb;
 assert state->'progress'='{"pagesThisApproval":1,"complete":false,"hasCursor":true}'::jsonb;
 assert state->'latestJob'->>'stopReason'='page_budget_exhausted';
 assert state->>'stateVersion' ~ '^[a-f0-9]{64}$';
 assert state::text not like '%saved-provider-cursor%' and state::text not like '%secret_refs%' and state::text not like '%scopeKey%';
 begin perform learn_slack_resume_history(verify.id(901),verify.id(1312),a,state->>'stateVersion','continue',1,'Viewer recovery');raise exception 'Viewer approved';exception when insufficient_privilege then null;end;
 begin perform learn_slack_history_read(verify.id(902),a);raise exception 'Foreign company read';exception when insufficient_privilege then null;end;
 insert into verify.history_review(state)values(state);
end $$;
reset role;update profiles set role='owner' where id=verify.id(911);
set role authenticated;
do $$declare a uuid;state jsonb;r jsonb;begin
 select account_id into a from verify.history_recovery;select v.state into state from verify.history_review v;
 r:=learn_slack_resume_history(verify.id(901),verify.id(1312),a,state->>'stateVersion','continue',1,'Continue saved window');
 assert r->'reused'='false'::jsonb;
 assert learn_slack_resume_history(verify.id(901),verify.id(1312),a,state->>'stateVersion','continue',1,'Continue saved window')=r||'{"reused":true}';
 begin perform learn_slack_resume_history(verify.id(901),verify.id(1312),a,state->>'stateVersion','restart',1,'Continue saved window');raise exception 'Changed request reused';exception when sqlstate 'PT409' then null;end;
 begin perform learn_slack_resume_history(verify.id(901),verify.id(1313),a,state->>'stateVersion','continue',1,'Stale recovery');raise exception 'Stale state accepted';exception when sqlstate 'PT409' then null;end;
 state:=learn_slack_history_read(verify.id(901),a);
 assert state->'active'='true'::jsonb and state->'canContinue'='false'::jsonb;
 begin perform learn_slack_resume_history(verify.id(901),verify.id(1313),a,state->>'stateVersion','continue',1,'Duplicate work');raise exception 'Active import replaced';exception when sqlstate '55000' then null;end;
 update verify.history_review set receipt=r;
end $$;
reset role;
do $$declare a record;h record;begin
 select * into a from connector_accounts where id=(select account_id from verify.history_recovery);select * into h from slack_history_imports where id=verify.id(1312);
 assert h.previous_state->'checkpoint'->>'cursor'='saved-provider-cursor' and h.previous_state->'checkpoint'->'pages'='1'::jsonb;
 assert h.definition->>'resumesImportId'=verify.id(1310)::text;
 assert a.sync_cursor->>'cursor'='saved-provider-cursor' and a.sync_cursor->'pages'='0'::jsonb;
 assert (a.sync_cursor->>'scopeKey')::jsonb->>5='learn-slack-import:'||verify.id(1312)::text;
 assert strpos(a.sync_cursor->>'scopeKey',', ')=0,'Checkpoint key differs from JavaScript JSON.stringify';
 assert a.settings->'slack_history'->>'oldest'=(select original_scope->>'oldest' from verify.history_recovery);
 assert a.settings->'slack_history'->>'latest'=(select original_scope->>'latest' from verify.history_recovery);
 assert (a.settings->'slack_history'->>'expiresAt')::timestamptz>clock_timestamp()+interval '23 hours';
 assert (select count(*)=1 from slack_messages where channel_id='CRESUME');
 assert (select count(*)=1 from slack_history_imports where id=verify.id(1310));
end $$;
update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TTEST';
set role service_role;
do $$declare j record;a record;payload jsonb;begin
 select * into j from learn_slack_claim_jobs(verify.id(1314),1);select * into a from connector_accounts where id=(select account_id from verify.history_recovery);
 assert j.id=(select (receipt->>'jobId')::uuid from verify.history_review);
 payload:=jsonb_build_array(jsonb_build_object('tenant_id',verify.id(901),'channel_id','CRESUME','source_external_id','TTEST:CRESUME:1767225700.000001','provider_timestamp','1767225700.000001','thread_timestamp',null,'text','Synthetic retained first page','provider_payload',jsonb_build_object('ts','1767225700.000001','text','Synthetic retained first page')),
 jsonb_build_object('tenant_id',verify.id(901),'channel_id','CRESUME','source_external_id','TTEST:CRESUME:1767225601.000001','provider_timestamp','1767225601.000001','thread_timestamp',null,'text','Synthetic next page','provider_payload',jsonb_build_object('ts','1767225601.000001','text','Synthetic next page')));
 assert slack_history_commit_page(j.tenant_id,j.id,a.id,j.claimed_by,j.attempt_count,a.sync_cursor,a.sync_cursor||'{"pages":1,"cursor":"next-saved-cursor"}',payload);
 perform learn_slack_finish_job(j.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
 assert (select count(*)=2 from slack_messages where channel_id='CRESUME');
 assert (select count(*)=2 from slack_message_versions v join slack_messages m on m.id=v.message_id where m.channel_id='CRESUME'),'Replay duplicated a version';
end $$;
reset role;
create function verify.reject_resume_job() returns trigger language plpgsql as $$begin
 if new.payload ? 'history_import_id' then raise exception 'Injected resume queue failure';end if;return new;end $$;
create trigger verify_resume_failure before insert on platform_jobs for each row execute function verify.reject_resume_job();
set role authenticated;
do $$declare a uuid;s jsonb;begin
 select account_id into a from verify.history_recovery;s:=learn_slack_history_read(verify.id(901),a);
 begin perform learn_slack_resume_history(verify.id(901),verify.id(1315),a,s->>'stateVersion','restart',2,'Reviewed expired-cursor restart');raise exception 'Injected failure missed';exception when others then assert sqlerrm='Injected resume queue failure';end;
 assert learn_slack_history_read(verify.id(901),a)=s,'Queue failure partially replaced checkpoint';
 assert not exists(select 1 from slack_history_imports where id=verify.id(1315));
end $$;
reset role;drop trigger verify_resume_failure on platform_jobs;
set role authenticated;
do $$declare a uuid;s jsonb;r jsonb;begin
 select account_id into a from verify.history_recovery;s:=learn_slack_history_read(verify.id(901),a);
 r:=learn_slack_resume_history(verify.id(901),verify.id(1315),a,s->>'stateVersion','restart',2,'Reviewed expired-cursor restart');
 assert (select sync_cursor->'cursor'='null'::jsonb and sync_cursor->'pages'='0'::jsonb from connector_accounts where id=a);
 assert (select previous_state->'checkpoint'->>'cursor'='next-saved-cursor' from slack_history_imports where id=verify.id(1315));
end $$;
reset role;update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TTEST';
set role service_role;
do $$declare j record;a record;begin
 select * into j from learn_slack_claim_jobs(verify.id(1316),1);select * into a from connector_accounts where id=(select account_id from verify.history_recovery);
 assert slack_history_commit_page(j.tenant_id,j.id,a.id,j.claimed_by,j.attempt_count,a.sync_cursor,a.sync_cursor||'{"pages":1,"cursor":null,"complete":true}','[]');
 perform learn_slack_finish_job(j.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
end $$;
set role authenticated;
do $$declare a uuid;s jsonb;begin
 select account_id into a from verify.history_recovery;s:=learn_slack_history_read(verify.id(901),a);
 assert s->'progress'->'complete'='true'::jsonb and s->'canContinue'='false'::jsonb and s->'canRestart'='false'::jsonb;
 begin perform learn_slack_resume_history(verify.id(901),verify.id(1317),a,s->>'stateVersion','continue',1,'Unneeded recovery');raise exception 'Completed window resumed';exception when sqlstate '55000' then null;end;
 -- Existing setup can move to the next window after recovery completed this one.
 perform learn_slack_start_import(verify.id(901),verify.id(1318),verify.id(921),(select updated_at::text from provider_connections where id=verify.id(921)),'CRESUME','2026-01-02','2026-01-03',1,'Next bounded window');
end $$;
reset role;
update platform_jobs set status='cancelled' where id=(select job_id from slack_history_imports where id=verify.id(1318));
do $$begin
 assert (select emails is not distinct from (select jsonb_agg(to_jsonb(e) order by id) from email_messages e)
  and messages is not distinct from (select jsonb_agg(to_jsonb(m) order by id) from slack_messages m where channel_id<>'CRESUME')
  and versions is not distinct from (select jsonb_agg(to_jsonb(v) order by v.id) from slack_message_versions v where message_id not in(select id from slack_messages where channel_id='CRESUME')) from verify.resume_sources_before),'Pre-existing communications changed';
end $$;
