-- Networkless production-schema journey. Synthetic operator approval, ten real
-- durable page transactions, automatic continuation and shared dispatch limits.
set search_path=public,pg_catalog;
create schema verify;
create function verify.id(n integer) returns uuid language sql immutable as $$select ('f7600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create table verify.campaign(definition jsonb,receipt jsonb);
grant usage on schema verify to authenticated,service_role;
grant execute on function verify.id(integer) to authenticated,service_role;
grant select,update on verify.campaign to authenticated,service_role;
insert into tenants(id,slug,display_name,status) values(verify.id(1),'slack-campaign-probe','Synthetic campaign','active'),(verify.id(2),'slack-campaign-foreign','Synthetic foreign','active');
insert into auth.users(id) values(verify.id(10)),(verify.id(11)),(verify.id(12));
update profiles set tenant_id=verify.id(2),role='viewer' where id in (verify.id(10),verify.id(11));
update profiles set tenant_id=verify.id(1),role='owner' where id=verify.id(12);
insert into platform_authority_grants(profile_id,permission,granted_by) values(verify.id(10),'platform.controlplane.admin','Synthetic campaign rehearsal');
insert into provider_connections(id,tenant_id,provider,status,non_secret_config,configured_fields,secret_refs) values
 (verify.id(20),verify.id(1),'slack','configured','{"team_id":"TCAMPAIGN"}',array['bot_token'],jsonb_build_object('bot_token',verify.id(21)));
insert into verify.campaign select jsonb_build_object('connectionId',id,'connectionRevision',updated_at,'channelIds',jsonb_build_array('CARCHIVEA','CARCHIVEB'),
 'start','2016-01-01T00:00:00Z','end','2026-10-01T00:00:00Z','expiresAt',clock_timestamp()+interval '2 days','requestBudget',100,'reason','Synthetic full channel history'),null from provider_connections where id=verify.id(20);
set request.jwt.claim.sub='f7600000-0000-4000-8000-000000000010';set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare d jsonb;r jsonb;begin
 select definition into d from verify.campaign;
 assert learn_slack_campaign_start(verify.id(1),verify.id(30),d,'check')->>'state'='pending';
 r:=learn_slack_campaign_start(verify.id(1),verify.id(30),d);
 assert r->>'state'='recorded';assert learn_slack_campaign_start(verify.id(1),verify.id(30),d)=r;
 assert learn_slack_campaign_start(verify.id(1),verify.id(30),d,'check')=r;
 update verify.campaign set receipt=r;
 begin perform learn_slack_campaign_start(verify.id(1),verify.id(30),d||'{"requestBudget":200}');raise exception 'Changed request accepted';exception when sqlstate 'PT409' then null;end;
 assert learn_slack_campaign_start(verify.id(1),verify.id(31),d,'cancel')->>'state'='cancelled';
 assert learn_slack_campaign_start(verify.id(1),verify.id(31),d)->>'state'='cancelled';
 assert learn_slack_campaign_read(verify.id(1),verify.id(30))->'complete'='false'::jsonb;
end$$;
reset role;
do $$begin
 assert (select count(*)=2 from slack_history_campaign_channels where campaign_id=verify.id(30));
 assert (select count(*)=2 from platform_jobs where tenant_id=verify.id(1));
 assert (select tenant_id=verify.id(2) and role='viewer' from profiles where id=verify.id(10)),'Operator profile was reassigned';
 assert not has_table_privilege('authenticated','slack_history_campaigns','SELECT,INSERT,UPDATE,DELETE');
 assert not has_table_privilege('service_role','slack_history_campaigns','UPDATE');
 assert not has_function_privilege('authenticated','learn_slack_campaign_reserve_request(uuid,uuid,text,integer,integer)','execute');
end$$;
-- Foreign clients cannot inspect or control the campaign even with its exact ID.
set request.jwt.claim.sub='f7600000-0000-4000-8000-000000000011';set role authenticated;
do $$begin
 begin perform learn_slack_campaign_read(verify.id(1),verify.id(30));raise exception 'Foreign campaign read accepted';exception when insufficient_privilege then null;end;
 begin perform learn_slack_campaign_control(verify.id(1),verify.id(32),verify.id(30),1,false,'Foreign pause');raise exception 'Foreign campaign control accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
-- Keep B queued while A traverses ten pages; only synthetic queue timing changes.
update platform_jobs set available_at='infinity' where tenant_id=verify.id(1) and payload->>'connector_account_id'=(select account_id::text from slack_history_campaign_channels where channel_id='CARCHIVEB');
set request.jwt.claim.role='service_role';
do $$declare page integer;ordinal integer;j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;cp jsonb;n jsonb;r jsonb;stamp text;begin
 for page in 1..10 loop
  update platform_jobs set available_at='-infinity' where tenant_id=verify.id(1) and status='queued' and payload->>'connector_account_id'=(select account_id::text from slack_history_campaign_channels where channel_id='CARCHIVEA');
  update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TCAMPAIGN';
  perform set_config('role','service_role',true);
  select * into strict j from learn_slack_claim_jobs(verify.id(40),1);
  select * into strict a from connector_accounts where id::text=j.payload->>'connector_account_id';
  assert a.settings->'slack_history'->>'channelId'='CARCHIVEA';
  for ordinal in 1..9 loop
   assert learn_slack_campaign_reserve_request(a.tenant_id,j.id,j.claimed_by,j.attempt_count,ordinal);
  end loop;
  assert not learn_slack_campaign_reserve_request(a.tenant_id,j.id,j.claimed_by,j.attempt_count,1),'Replayed reservation reopened allowance';
  assert not learn_slack_campaign_reserve_request(a.tenant_id,j.id,'wrong-worker',j.attempt_count,1);
  cp:=a.sync_cursor;
  if cp='{}' then cp:=jsonb_build_object('scopeKey',jsonb_build_array(a.tenant_id::text,'TCAMPAIGN','CARCHIVEA',a.settings#>>'{slack_history,oldest}',a.settings#>>'{slack_history,latest}',a.settings#>>'{slack_history,consentReference}')::text,'cursor',null,'pages',0,'complete',false);end if;
  n:=cp||jsonb_build_object('pages',page,'cursor','page-'||page,'complete',false);stamp:=(1767225700-page)::text||'.000001';
  r:=jsonb_build_array(jsonb_build_object('tenant_id',a.tenant_id,'channel_id','CARCHIVEA','source_external_id','TCAMPAIGN:CARCHIVEA:'||stamp,
   'provider_timestamp',stamp,'thread_timestamp',null,'text','Synthetic campaign history','provider_payload',jsonb_build_object('ts',stamp,'text','Synthetic campaign history','reply_count',1)));
  assert slack_history_commit_page(a.tenant_id,j.id,a.id,j.claimed_by,j.attempt_count,cp,n,r);
  assert slack_history_commit_page(a.tenant_id,j.id,a.id,j.claimed_by,j.attempt_count,cp,n,r);
  perform learn_slack_finish_job(a.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
  perform set_config('role','none',true);
 end loop;
 assert (select requests_reserved=90 from slack_history_campaigns where id=verify.id(30));
 assert (select count(*)=10 from slack_messages where tenant_id=verify.id(1));
end$$;
reset role;
-- The authorised scheduler renews only the exact old cursor/bounds, preserving
-- the prior approval and attributing new work to the real cross-client operator.
set role service_role;
do $$declare r jsonb;begin r:=learn_slack_schedule_campaigns(10);assert (r->>'queued')::integer=1, 'Unexpected scheduler result: '||r::text;end$$;
reset role;
do $$declare a public.connector_accounts%rowtype;i public.slack_history_imports%rowtype;begin
 select * into strict a from connector_accounts where tenant_id=verify.id(1) and settings->'slack_history'->>'channelId'='CARCHIVEA';
 select * into strict i from slack_history_imports where id=(select current_import from slack_history_campaign_channels where account_id=a.id);
 assert a.sync_cursor->>'cursor'='page-10' and a.sync_cursor->'pages'='0'::jsonb;
 assert a.sync_cursor->>'scopeKey'=array_to_json(array[a.tenant_id::text,'TCAMPAIGN','CARCHIVEA',a.settings#>>'{slack_history,oldest}',a.settings#>>'{slack_history,latest}',a.settings#>>'{slack_history,consentReference}'])::text,'Worker scope key is not canonical';
 assert i.approved_by=verify.id(10) and i.definition->>'campaignId'=verify.id(30)::text;
 assert i.previous_state->'checkpoint'->>'cursor'='page-10';
 assert i.previous_state->'checkpoint'->'pages'='10'::jsonb;
 assert i.previous_state->'settings'->>'oldest'=a.settings->'slack_history'->>'oldest';
 assert i.previous_state->'settings'->>'latest'=a.settings->'slack_history'->>'latest';
 assert (select count(*)=3 from slack_history_imports where tenant_id=verify.id(1));
end$$;
-- Pause excludes claims without consuming attempts; resume retains the scope.
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='f7600000-0000-4000-8000-000000000010';set role authenticated;
select learn_slack_campaign_control(verify.id(1),verify.id(50),verify.id(30),1,false,'Synthetic pause');
reset role;set request.jwt.claim.role='service_role';set role service_role;
do $$begin assert not exists(select 1 from learn_slack_claim_jobs(verify.id(40),1));end$$;
reset role;set request.jwt.claim.role='authenticated';set role authenticated;
do $$begin
 begin perform learn_slack_campaign_control(verify.id(1),verify.id(51),verify.id(30),1,true,'Stale resume');raise exception 'Stale control accepted';exception when sqlstate 'PT409' then null;end;
 assert learn_slack_campaign_control(verify.id(1),verify.id(52),verify.id(30),2,true,'Resume exact campaign')->>'revision'='3';
end$$;
reset role;set request.jwt.claim.role='service_role';
update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TCAMPAIGN';
set role service_role;
do $$declare j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;cp jsonb;n jsonb;ordinal integer;begin
 select * into strict j from learn_slack_claim_jobs(verify.id(40),1);
 select * into strict a from connector_accounts where id::text=j.payload->>'connector_account_id';
 for ordinal in 1..9 loop assert learn_slack_campaign_reserve_request(a.tenant_id,j.id,j.claimed_by,j.attempt_count,ordinal);end loop;
 cp:=a.sync_cursor;n:=cp||'{"pages":1,"cursor":null,"complete":true}';
 assert slack_history_commit_page(a.tenant_id,j.id,a.id,j.claimed_by,j.attempt_count,cp,n,'[]');
 perform learn_slack_finish_job(a.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
end$$;
reset role;
update slack_history_campaign_channels set next_check_at='-infinity' where campaign_id=verify.id(30);
update platform_jobs set available_at='-infinity' where tenant_id=verify.id(1) and status='queued';
update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TCAMPAIGN';
set role service_role;
do $$declare j public.platform_jobs%rowtype;begin
 perform learn_slack_schedule_campaigns(10);
 select * into strict j from learn_slack_claim_jobs(verify.id(40),1);
 assert learn_slack_campaign_reserve_request(j.tenant_id,j.id,j.claimed_by,j.attempt_count,1);
 assert not learn_slack_campaign_reserve_request(j.tenant_id,j.id,j.claimed_by,j.attempt_count,2),'Shared campaign exceeded 100 requests';
 -- Do not fake a provider page after budget exhaustion.
 perform learn_slack_finish_job(j.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":false,"code":"slack_history_campaign_request_unavailable","retryable":false,"retry_after_seconds":0}');
end$$;
reset role;
do $$begin
 assert (select requests_reserved=100 from slack_history_campaigns where id=verify.id(30));
 assert (select count(*)=100 from slack_history_campaign_dispatches where campaign_id=verify.id(30));
 assert (select state='history_captured_threads_pending' from slack_history_campaign_channels where campaign_id=verify.id(30) and channel_id='CARCHIVEA');
 assert (select count(*)=10 from slack_messages where tenant_id=verify.id(1));
end$$;
set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare r jsonb;begin
 r:=learn_slack_campaign_read(verify.id(1),verify.id(30));assert r->'requestsReserved'='100'::jsonb;
 assert r->'complete'='false'::jsonb and r->'threadsComplete'='false'::jsonb;
 begin perform learn_slack_campaign_control(verify.id(1),verify.id(53),verify.id(30),3,true,'Attempt budget extension');raise exception 'Exhausted campaign resumed';exception when sqlstate '55000' then null;end;
end$$;
reset role;
-- A second campaign leaves exactly one shared reservation for the Python runner
-- to race from two separately leased synthetic channel jobs.
create table verify.concurrent_jobs(slot integer primary key,job_id uuid,claimed_by text,attempt integer);
grant select on verify.concurrent_jobs to service_role;
set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare d jsonb;begin
 select definition||jsonb_build_object('channelIds',jsonb_build_array('CCONCURRENTA','CCONCURRENTB'),'requestBudget',9) into d from verify.campaign;
 perform learn_slack_campaign_start(verify.id(1),verify.id(60),d);
end$$;
reset role;set request.jwt.claim.role='service_role';
do $$declare slot integer;j public.platform_jobs%rowtype;ordinal integer;begin
 for slot in 1..2 loop
  update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TCAMPAIGN';
  perform set_config('role','service_role',true);
  select * into strict j from learn_slack_claim_jobs(verify.id(40+slot),1);
  if slot=1 then
   for ordinal in 1..8 loop assert learn_slack_campaign_reserve_request(j.tenant_id,j.id,j.claimed_by,j.attempt_count,ordinal);end loop;
  end if;
  perform set_config('role','none',true);
  insert into verify.concurrent_jobs values(slot,j.id,j.claimed_by,j.attempt_count);
 end loop;
end$$;
reset role;
-- Pause after a lease was claimed fences both dispatch and publication. A later
-- explicit resume may renew that interrupted scope once, without resetting budget.
create table verify.recovery_job(job_id uuid,account_id uuid,claimed_by text,attempt integer,checkpoint jsonb);
grant select on verify.recovery_job to authenticated,service_role;
set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare d jsonb;begin
 select definition||jsonb_build_object('channelIds',jsonb_build_array('CRECOVERY'),'requestBudget',50) into d from verify.campaign;
 perform learn_slack_campaign_start(verify.id(1),verify.id(70),d);
end$$;
reset role;set request.jwt.claim.role='service_role';
update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TCAMPAIGN';
do $$declare j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;cp jsonb;begin
 perform set_config('role','service_role',true);
 select * into strict j from learn_slack_claim_jobs(verify.id(44),1);
 select * into strict a from connector_accounts where id::text=j.payload->>'connector_account_id';
 assert a.settings->'slack_history'->>'channelId'='CRECOVERY';
 cp:=jsonb_build_object('scopeKey',array_to_json(array[a.tenant_id::text,'TCAMPAIGN','CRECOVERY',a.settings#>>'{slack_history,oldest}',a.settings#>>'{slack_history,latest}',a.settings#>>'{slack_history,consentReference}'])::text,'cursor',null,'pages',0,'complete',false);
 perform set_config('role','none',true);
 insert into verify.recovery_job values(j.id,a.id,j.claimed_by,j.attempt_count,cp);
end$$;
set request.jwt.claim.role='authenticated';set role authenticated;
select learn_slack_campaign_control(verify.id(1),verify.id(71),verify.id(70),1,false,'Pause during request');
reset role;set request.jwt.claim.role='service_role';set role service_role;
do $$declare j verify.recovery_job%rowtype;begin
 select * into strict j from verify.recovery_job;
 assert not learn_slack_campaign_reserve_request(verify.id(1),j.job_id,j.claimed_by,j.attempt,1);
 begin
  perform slack_history_commit_page(verify.id(1),j.job_id,j.account_id,j.claimed_by,j.attempt,j.checkpoint,j.checkpoint||'{"pages":1,"complete":true}','[]');
  raise exception 'Paused campaign published a new page';
 exception when insufficient_privilege then null;end;
 perform learn_slack_finish_job(verify.id(1),j.job_id,j.claimed_by,j.attempt,'{"success":false,"code":"slack_history_campaign_request_unavailable","retryable":false,"retry_after_seconds":0}');
end$$;
reset role;set request.jwt.claim.role='authenticated';set role authenticated;
select learn_slack_campaign_control(verify.id(1),verify.id(72),verify.id(70),2,true,'Resume interrupted scope');
reset role;set request.jwt.claim.role='service_role';set role service_role;
do $$declare r jsonb;begin r:=learn_slack_schedule_campaigns(10);assert (r->>'queued')::integer=1,'Interrupted campaign did not renew';end$$;
reset role;
do $$declare m public.slack_history_campaign_channels%rowtype;job uuid;begin
 select * into strict m from slack_history_campaign_channels where campaign_id=verify.id(70);
 select job_id into strict job from slack_history_imports where id=m.current_import;
 assert job<>(select job_id from verify.recovery_job);
 assert (select requests_reserved=0 from slack_history_campaigns where id=verify.id(70));
 assert (select payload->'campaign_revision'='3'::jsonb from platform_jobs where id=job);
 assert learn_slack_campaign_job_allowed(verify.id(1),job);
 begin
  update platform_authority_grants set effective_to='epoch' where profile_id=verify.id(10);
  assert not learn_slack_campaign_job_allowed(verify.id(1),job),'Revoked operator retained campaign authority';
  raise exception 'synthetic_rollback';
 exception when raise_exception then if sqlerrm<>'synthetic_rollback' then raise;end if;end;
 assert learn_slack_campaign_job_allowed(verify.id(1),job);
 begin
  update provider_connections set status='revoked',revoked_at=clock_timestamp() where id=verify.id(20);
  assert not learn_slack_campaign_job_allowed(verify.id(1),job),'Revoked credential retained campaign authority';
  raise exception 'synthetic_rollback';
 exception when raise_exception then if sqlerrm<>'synthetic_rollback' then raise;end if;end;
 assert learn_slack_campaign_job_allowed(verify.id(1),job);
 begin
  insert into feature_flags(tenant_id,flag,value) values(verify.id(1),'learn.inputs.slack.enabled','false');
  assert not learn_slack_campaign_job_allowed(verify.id(1),job),'Disabled capture retained campaign authority';
  raise exception 'synthetic_rollback';
 exception when raise_exception then if sqlerrm<>'synthetic_rollback' then raise;end if;end;
 assert learn_slack_campaign_job_allowed(verify.id(1),job);
end$$;
-- No time override: an actual short approval expires before any claim/request.
set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare d jsonb;begin
 select definition||jsonb_build_object('channelIds',jsonb_build_array('CEXPIRES'),'expiresAt',clock_timestamp()+interval '2 seconds') into d from verify.campaign;
 perform learn_slack_campaign_start(verify.id(1),verify.id(80),d);
end$$;
reset role;select pg_sleep(2.1);set request.jwt.claim.role='service_role';
do $$declare job uuid;begin
 select i.job_id into strict job from slack_history_campaign_channels m join slack_history_imports i on i.id=m.current_import where m.campaign_id=verify.id(80);
 assert not learn_slack_campaign_job_allowed(verify.id(1),job),'Expired campaign retained authority';
 assert (select requests_reserved=0 from slack_history_campaigns where id=verify.id(80));
end$$;
