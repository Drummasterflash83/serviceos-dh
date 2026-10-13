-- Continues the disposable production-schema Slack fixtures; never run hosted.
set search_path=public,pg_catalog;
reset role;
create table verify.historical(receipt jsonb, original_scope jsonb, checkpoint jsonb);
grant select,insert,update on verify.historical to authenticated,service_role;
set request.jwt.claim.sub='f7000000-0000-4000-8000-000000000011';
set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare r jsonb;rev text;begin
 select updated_at::text into rev from provider_connections where id='f7000000-0000-4000-8000-000000000021';
 r:=learn_slack_start_import('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000071',
  'f7000000-0000-4000-8000-000000000021',rev,'CHISTORICAL','2016-01-01','2026-10-01',1,'Ten-year cursor recovery');
 insert into verify.historical(receipt) values(r);
 begin
  perform learn_slack_start_import('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000071',
   'f7000000-0000-4000-8000-000000000021',rev,'CHISTORICAL','2015-01-01','2026-10-01',1,'Ten-year cursor recovery');
  raise exception 'Changed historical cutoff accepted under existing request';
 exception when sqlstate '40001' or sqlstate 'PT409' then null;end;
end$$;
reset role;
create function verify.historical_record(stamp text) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('tenant_id','f7000000-0000-4000-8000-000000000001',
  'channel_id','CHISTORICAL','source_external_id','TPROBE:CHISTORICAL:'||stamp,'provider_timestamp',stamp,
  'thread_timestamp',null,'text','Synthetic historical record',
  'provider_payload',jsonb_build_object('ts',stamp,'text','Synthetic historical record')))
$$;
grant execute on function verify.historical_record(text) to service_role;
update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TPROBE';
set request.jwt.claim.role='service_role';set role service_role;
do $$declare j platform_jobs%rowtype;a connector_accounts%rowtype;cp jsonb;n jsonb;r jsonb;begin
 select * into strict j from learn_slack_claim_jobs('f7000000-0000-4000-8000-000000000072',1);
 assert j.id=(select (receipt->>'jobId')::uuid from verify.historical);
 select * into strict a from connector_accounts where id=(j.payload->>'connector_account_id')::uuid;
 cp:=jsonb_build_object('scopeKey',jsonb_build_array(a.tenant_id::text,a.settings#>>'{slack_history,teamId}',
  a.settings#>>'{slack_history,channelId}',a.settings#>>'{slack_history,oldest}',a.settings#>>'{slack_history,latest}',
  a.settings#>>'{slack_history,consentReference}')::text,'cursor',null,'pages',0,'complete',false);
 n:=cp||'{"pages":1,"cursor":"synthetic-ten-year-cursor"}';
 assert slack_history_commit_page(a.tenant_id,j.id,a.id,j.claimed_by,j.attempt_count,cp,n,verify.historical_record('1790812799.000001'));
 assert slack_history_commit_page(a.tenant_id,j.id,a.id,j.claimed_by,j.attempt_count,cp,n,verify.historical_record('1790812799.000001'));
 r:=learn_slack_finish_job(a.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
 assert r->'successor_id'='null'::jsonb;
 assert (select result->>'stopReason'='page_budget_exhausted' from platform_jobs where id=j.id);
 update verify.historical set original_scope=a.settings->'slack_history',checkpoint=n;
end$$;
reset role;
-- Approval lifetime is independent of the historical span. Expiry does not
-- erase a cursor and a fresh reviewed approval does not widen its fixed bounds.
update connector_accounts set settings=jsonb_set(settings,'{slack_history,expiresAt}',
 to_jsonb(clock_timestamp()-interval '1 hour')) where id=(select (receipt->>'accountId')::uuid from verify.historical);
set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare a uuid;s jsonb;r jsonb;begin
 select (receipt->>'accountId')::uuid into a from verify.historical;
 s:=learn_slack_history_read('f7000000-0000-4000-8000-000000000001',a);
 assert s->'stateValid'='true'::jsonb and s->'canContinue'='true'::jsonb;
 assert s->'progress'->'complete'='false'::jsonb and s->'progress'->'hasCursor'='true'::jsonb;
 assert s::text not like '%synthetic-ten-year-cursor%';
 assert (s#>>'{window,start}')::timestamptz='2016-01-01'::timestamptz;
 assert (s#>>'{window,end}')::timestamptz='2026-10-01'::timestamptz;
 r:=learn_slack_resume_history('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000073',
  a,s->>'stateVersion','continue',1,'Continue ten-year cursor');
 assert learn_slack_resume_history('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000073',
  a,s->>'stateVersion','continue',1,'Continue ten-year cursor')=r||'{"reused":true}';
 update verify.historical set receipt=r;
end$$;
reset role;
update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TPROBE';
set request.jwt.claim.role='service_role';set role service_role;
do $$declare j platform_jobs%rowtype;a connector_accounts%rowtype;old_scope jsonb;cp jsonb;n jsonb;begin
 select * into strict j from learn_slack_claim_jobs('f7000000-0000-4000-8000-000000000074',1);
 assert j.id=(select (receipt->>'jobId')::uuid from verify.historical);
 select * into strict a from connector_accounts where id=(j.payload->>'connector_account_id')::uuid;
 select original_scope into old_scope from verify.historical;
 assert a.settings#>'{slack_history,oldest}'=old_scope->'oldest' and a.settings#>'{slack_history,latest}'=old_scope->'latest';
 cp:=a.sync_cursor;
 assert cp->>'cursor'='synthetic-ten-year-cursor' and cp->'pages'='0'::jsonb;
 n:=cp||'{"pages":1,"cursor":null,"complete":true}';
 assert slack_history_commit_page(a.tenant_id,j.id,a.id,j.claimed_by,j.attempt_count,cp,n,verify.historical_record('1451606400.000000'));
 perform learn_slack_finish_job(a.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
 assert (select count(*)=2 from slack_messages where tenant_id=a.tenant_id and channel_id='CHISTORICAL');
 assert (select count(*)=2 from slack_message_versions v join slack_messages m on m.id=v.message_id where m.tenant_id=a.tenant_id and m.channel_id='CHISTORICAL');
 assert (select sync_cursor->'complete'='true'::jsonb from connector_accounts where id=a.id);
 assert exists(select 1 from slack_history_imports where id='f7000000-0000-4000-8000-000000000071');
 assert (select previous_state->'checkpoint'->>'cursor'='synthetic-ten-year-cursor' from slack_history_imports where id='f7000000-0000-4000-8000-000000000073');
end$$;
reset role;
select 'PASS: ten-year channel pages, exact replay, exhausted approval, expiry, lost-response retry, saved cursor and original bounds';
