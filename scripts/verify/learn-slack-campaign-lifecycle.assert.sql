-- Continues the synthetic completed-thread journey in the same disposable clone.
reset role;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='f7600000-0000-4000-8000-000000000011';set role authenticated;
do $$begin
 begin perform learn_slack_campaign_close(verify.id(1),verify.id(89),verify.id(30),3,'handoff','Unauthorised caller');raise exception 'Viewer changed campaign';exception when insufficient_privilege then null;end;
end$$;
reset role;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='f7600000-0000-4000-8000-000000000010';set role authenticated;
do $$declare r jsonb;begin
 r:=learn_slack_campaign_close(verify.id(1),verify.id(90),verify.id(30),3,'handoff','Synthetic ongoing approval','check');
 assert r->>'state'='pending';
 begin perform learn_slack_campaign_close(verify.id(2),verify.id(90),verify.id(30),3,'handoff','Synthetic ongoing approval');raise exception 'Foreign campaign accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_slack_campaign_close(verify.id(1),verify.id(91),verify.id(30),2,'handoff','Stale revision');raise exception 'Stale close accepted';exception when sqlstate 'PT409' then null;end;
 r:=learn_slack_campaign_close(verify.id(1),verify.id(92),verify.id(30),3,'stop','Cancelled pending decision','cancel');
 assert r->>'state'='cancelled';
 assert learn_slack_campaign_close(verify.id(1),verify.id(92),verify.id(30),3,'stop','Cancelled pending decision')->>'state'='cancelled';
 assert learn_slack_campaign_read(verify.id(1),verify.id(30))->'enabled'='true'::jsonb;
 r:=learn_slack_campaign_close(verify.id(1),verify.id(90),verify.id(30),3,'handoff','Synthetic ongoing approval');
 assert r->>'lifecycle'='ongoing' and r->'historicalComplete'='true'::jsonb;
 assert r=learn_slack_campaign_close(verify.id(1),verify.id(90),verify.id(30),3,'handoff','Synthetic ongoing approval','check');
 begin perform learn_slack_campaign_close(verify.id(1),verify.id(90),verify.id(30),3,'stop','Synthetic ongoing approval');raise exception 'Changed request accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_slack_campaign_control(verify.id(1),verify.id(93),verify.id(30),4,true,'Reopen closed campaign');raise exception 'Closed campaign reopened';exception when sqlstate '55000' then null;end;
 r:=learn_slack_campaign_read(verify.id(1),verify.id(30));
 assert r->>'lifecycle'='ongoing' and r->'enabled'='false'::jsonb and r->'complete'='true'::jsonb;
end$$;
reset role;
do $$begin
 assert (select count(*)=1 from slack_history_campaign_closures where campaign_id=verify.id(30));
 assert (select enabled and include_threads and approved_by=verify.id(10) and next_start='2026-10-01'::timestamptz from slack_recurring_channels where tenant_id=verify.id(1));
 assert (select not(settings->'slack_history' ? 'campaignId') from connector_accounts where tenant_id=verify.id(1) and settings->'slack_history'->>'channelId'='CWINDOW');
 assert (select count(*)=53 from slack_messages where tenant_id=verify.id(1));
 assert not has_table_privilege('authenticated','slack_history_campaign_closures','SELECT,INSERT,UPDATE,DELETE');
 assert not has_function_privilege('service_role','learn_slack_campaign_close(uuid,uuid,uuid,bigint,text,text,text)','EXECUTE');
 begin update slack_history_campaign_closures set snapshot='{}' where campaign_id=verify.id(30);raise exception 'Closure modified';exception when sqlstate '55000' then null;end;
end$$;
-- Retired jobs are denied even after the account moves into a non-campaign scope.
set request.jwt.claim.role='service_role';
do $$declare j public.platform_jobs%rowtype;begin
 for j in select * from platform_jobs where tenant_id=verify.id(1) and payload->>'campaign_id'=verify.id(30)::text loop
  assert not learn_slack_campaign_job_allowed(j.tenant_id,j.id);
 end loop;
end$$;
set role service_role;
do $$declare r jsonb;begin r:=learn_slack_schedule_recurring(10);assert r->'queued'='1'::jsonb,'Handoff did not schedule';end$$;
reset role;
do $$declare a public.connector_accounts%rowtype;begin
 select * into strict a from connector_accounts where tenant_id=verify.id(1) and settings->'slack_history'->>'channelId'='CWINDOW';
 assert (a.settings->'slack_history'->>'oldest')::numeric=extract(epoch from '2026-10-01'::timestamptz),'Ongoing capture skipped the cutoff';
 assert (a.settings->'slack_history'->>'latest')::numeric=extract(epoch from '2026-10-01 00:15:00Z'::timestamptz);
 assert learn_slack_campaign_channel_progress(verify.id(30),a.id)->'complete'='true'::jsonb;
end$$;
-- One actual new-window page transaction, not just a queued subscription.
update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TCAMPAIGN';
set role service_role;
do $$declare j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;cp jsonb;begin
 select * into strict j from learn_slack_claim_jobs(verify.id(40),1);
 assert not(j.payload ? 'campaign_id');assert learn_slack_campaign_job_allowed(j.tenant_id,j.id);
 select * into strict a from connector_accounts where id::text=j.payload->>'connector_account_id';
 assert learn_slack_campaign_reserve_request(a.tenant_id,j.id,j.claimed_by,j.attempt_count,1);
 cp:=jsonb_build_object('scopeKey',array_to_json(array[a.tenant_id::text,'TCAMPAIGN','CWINDOW',a.settings#>>'{slack_history,oldest}',a.settings#>>'{slack_history,latest}',a.settings#>>'{slack_history,consentReference}'])::text,'cursor',null,'pages',0,'complete',false);
 assert slack_history_commit_page(a.tenant_id,j.id,a.id,j.claimed_by,j.attempt_count,cp,cp||'{"pages":1,"complete":true}','[]');
 perform learn_slack_finish_job(a.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
end$$;
reset role;
-- New active campaign: stop after claim, preserve its checkpoint and evidence.
set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare d jsonb;begin
 select definition||jsonb_build_object('channelIds',jsonb_build_array('CSTOP')) into d from verify.campaign;
 perform learn_slack_campaign_start(verify.id(1),verify.id(100),d);
 begin perform learn_slack_campaign_close(verify.id(1),verify.id(101),verify.id(100),1,'handoff','Incomplete handoff');raise exception 'Incomplete handoff accepted';exception when sqlstate '55000' then null;end;
end$$;
reset role;
create table verify.stopped_job(job uuid,account uuid,owner text,attempt integer,checkpoint jsonb);
grant select on verify.stopped_job to service_role;
update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TCAMPAIGN';
set request.jwt.claim.role='service_role';
do $$declare j public.platform_jobs%rowtype;begin
 perform set_config('role','service_role',true);select * into strict j from learn_slack_claim_jobs(verify.id(40),1);perform set_config('role','none',true);
 insert into verify.stopped_job select j.id,a.id,j.claimed_by,j.attempt_count,a.sync_cursor from connector_accounts a where a.id::text=j.payload->>'connector_account_id';
end$$;
set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare r jsonb;begin
 r:=learn_slack_campaign_close(verify.id(1),verify.id(102),verify.id(100),1,'stop','Synthetic permanent stop');
 assert r->>'lifecycle'='stopped' and r->'historicalComplete'='false'::jsonb;
 assert r=learn_slack_campaign_close(verify.id(1),verify.id(102),verify.id(100),1,'stop','Synthetic permanent stop');
 r:=learn_slack_campaign_read(verify.id(1),verify.id(100));assert r->>'lifecycle'='stopped' and r->'complete'='false'::jsonb;
 begin perform learn_slack_campaign_control(verify.id(1),verify.id(103),verify.id(100),2,true,'Reopen stopped campaign');raise exception 'Stopped campaign reopened';exception when sqlstate '55000' then null;end;
end$$;
reset role;set request.jwt.claim.role='service_role';set role service_role;
do $$declare x record;a public.connector_accounts%rowtype;cp jsonb;begin
 select * into strict x from verify.stopped_job;
 assert not learn_slack_campaign_job_allowed(verify.id(1),x.job);
 assert not learn_slack_campaign_reserve_request(verify.id(1),x.job,x.owner,x.attempt,1);
 select * into strict a from connector_accounts where id=x.account;
 cp:=jsonb_build_object('scopeKey',array_to_json(array[a.tenant_id::text,'TCAMPAIGN','CSTOP',a.settings#>>'{slack_history,oldest}',a.settings#>>'{slack_history,latest}',a.settings#>>'{slack_history,consentReference}'])::text,'cursor',null,'pages',0,'complete',false);
 begin perform slack_history_commit_page(a.tenant_id,x.job,a.id,x.owner,x.attempt,cp,cp||'{"pages":1,"complete":true}','[]');raise exception 'Stopped campaign published';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$begin
 assert (select a.sync_cursor=x.checkpoint from connector_accounts a join verify.stopped_job x on x.account=a.id);
 assert (select requests_reserved=0 and not enabled from slack_history_campaigns where id=verify.id(100));
 assert (select count(*)=53 from slack_messages where tenant_id=verify.id(1));
 assert (select requests_reserved=297 from slack_history_campaigns where id=verify.id(30));
end$$;
set request.jwt.claim.role='authenticated';set role authenticated;
do $$begin
 assert learn_slack_campaign_read(verify.id(1),verify.id(30))->'complete'='true'::jsonb;
end$$;
reset role;
