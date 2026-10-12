-- Continues the synthetic offline Slack fixture against actual production helpers.
-- No external provider, real credential, or live scheduling is used.
set search_path=public,pg_catalog;
set request.jwt.claim.sub='f7000000-0000-4000-8000-000000000011';
set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare a uuid;m slack_messages%rowtype;rev timestamptz;r jsonb;begin
 select (result->>'accountId')::uuid into a from verify.slack;
 select * into strict m from slack_messages where tenant_id='f7000000-0000-4000-8000-000000000001';
 select updated_at into rev from provider_connections where id='f7000000-0000-4000-8000-000000000021';
 r:=learn_slack_start_thread_import(m.tenant_id,'f7000000-0000-4000-8000-000000000061',a,m.id,m.source_version,rev,'2026-01-01','2026-01-02',1,'Synthetic thread recovery');
 assert learn_slack_start_thread_import(m.tenant_id,'f7000000-0000-4000-8000-000000000061',a,m.id,m.source_version,rev,'2026-01-01','2026-01-02',1,'Synthetic thread recovery')=r||'{"reused":true}';
end $$;
reset role;
-- Advance only this synthetic workspace's pacing clock; do not bypass a guard.
update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TPROBE';
create function verify.reply(stamp text,body text) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('tenant_id','f7000000-0000-4000-8000-000000000001','channel_id','CPROBE',
 'source_external_id','TPROBE:CPROBE:'||stamp,'provider_timestamp',stamp,'thread_timestamp','1767225700.000001','text',body,
 'provider_payload',jsonb_build_object('ts',stamp,'thread_ts','1767225700.000001','text',body))) $$;
-- Package 007 adds claim-time pause enforcement. The preceding fixture
-- deliberately left Slack paused; prove that guard before resuming this fixture.
set request.jwt.claim.role='service_role';set role service_role;
do $$begin
 if to_regprocedure('public.learn_capture_job_allowed(uuid,text,jsonb)') is not null then
  assert (select count(*) from learn_slack_claim_jobs('f7000000-0000-4000-8000-000000000060',1))=0;
  assert (select j.status='queued' and j.attempt_count=0 from platform_jobs j join slack_thread_imports t on t.initial_job_id=j.id where t.id='f7000000-0000-4000-8000-000000000061');
 end if;
end $$;
reset role;
-- Synthetic configuration only; the final release requires an enabled input.
update feature_flags set value='true' where tenant_id='f7000000-0000-4000-8000-000000000001'
 and flag='learn.inputs.slack.enabled'
 and to_regprocedure('public.learn_capture_job_allowed(uuid,text,jsonb)') is not null;
set role service_role;
do $$declare j platform_jobs%rowtype;t slack_thread_imports%rowtype;cp jsonb;n jsonb;p jsonb;begin
 select * into strict j from learn_slack_claim_jobs('f7000000-0000-4000-8000-000000000062',1);
 select * into strict t from slack_thread_imports where id='f7000000-0000-4000-8000-000000000061';
 assert j.id=t.initial_job_id;
 cp:=jsonb_build_object('scopeKey',array_to_json(array[t.tenant_id::text,t.scope->>'teamId',t.scope->>'channelId',t.scope->>'oldest',t.scope->>'latest',t.scope->>'consentReference',t.scope->>'parentTimestamp'])::text,'cursor',null,'pages',0,'complete',false);
 n:=cp||'{"pages":1,"cursor":"synthetic-next-page"}';p:=verify.reply('1767225900.000001','Synthetic first reply');
 assert slack_thread_commit_page(t.tenant_id,j.id,t.id,j.claimed_by,j.attempt_count,cp,n,p);
 assert slack_thread_commit_page(t.tenant_id,j.id,t.id,j.claimed_by,j.attempt_count,cp,n,p);
 perform learn_slack_finish_thread_job(t.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
 assert (select result->>'stopReason'='page_budget_exhausted' and result->>'threadCoverage'='observed_thread_window_incomplete' from platform_jobs where id=j.id);
end $$;
reset role;set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare s jsonb;r jsonb;begin
 s:=learn_slack_thread_recovery_read('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000061');
 assert s->'canContinue'='true'::jsonb and s::text not like '%synthetic-next-page%';
 r:=learn_slack_resume_thread('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000063','f7000000-0000-4000-8000-000000000061',s->>'stateVersion','continue',1,'Continue synthetic retained cursor');
 assert learn_slack_resume_thread('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000063','f7000000-0000-4000-8000-000000000061',s->>'stateVersion','continue',1,'Continue synthetic retained cursor')=r||'{"reused":true}';
 begin perform learn_slack_resume_thread('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000064','f7000000-0000-4000-8000-000000000061',s->>'stateVersion','continue',1,'Stale review');raise exception 'Stale review admitted';exception when sqlstate 'PT409' then null;end;
end $$;
reset role;
update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TPROBE';
set request.jwt.claim.role='service_role';set role service_role;
do $$declare j platform_jobs%rowtype;t slack_thread_imports%rowtype;p jsonb;begin
 select * into strict j from learn_slack_claim_jobs('f7000000-0000-4000-8000-000000000065',1);
 select * into strict t from slack_thread_imports where id='f7000000-0000-4000-8000-000000000063';
 assert j.id=t.initial_job_id and t.checkpoint->>'cursor'='synthetic-next-page';
 p:=verify.reply('1767225900.000001','Synthetic first reply')||verify.reply('1767226000.000001','Synthetic second reply');
 assert slack_thread_commit_page(t.tenant_id,j.id,t.id,j.claimed_by,j.attempt_count,t.checkpoint,t.checkpoint||'{"pages":1,"cursor":null,"complete":true}',p);
 perform learn_slack_finish_thread_job(t.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
 assert (select count(*)=3 from slack_messages where tenant_id=t.tenant_id);
 assert (select count(*)=3 from slack_message_versions where tenant_id=t.tenant_id);
 assert (select count(*)=3 from interactions where tenant_id=t.tenant_id and source_table='slack_messages');
 assert (select checkpoint->>'cursor'='synthetic-next-page' from slack_thread_imports where id='f7000000-0000-4000-8000-000000000061');
 assert (select sync_cursor->'complete'='true'::jsonb from connector_accounts where id=t.account_id);
end $$;
reset role;set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare s jsonb;begin
 s:=learn_slack_thread_recovery_read('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000063');
 assert s->'progress'->'complete'='true'::jsonb and s->'canContinue'='false'::jsonb;
 begin perform learn_slack_resume_thread('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000066','f7000000-0000-4000-8000-000000000063',s->>'stateVersion','continue',1,'Completed window');raise exception 'Completed window resumed';exception when sqlstate '55000' then null;end;
end $$;
reset role;
