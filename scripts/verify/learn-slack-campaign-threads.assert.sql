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
insert into verify.campaign select jsonb_build_object('connectionId',id,'connectionRevision',updated_at,'channelIds',jsonb_build_array('CWINDOW'),
 'start','2016-01-01T00:00:00Z','end','2026-10-01T00:00:00Z','expiresAt',clock_timestamp()+interval '2 days','requestBudget',500,'reason','Synthetic full channel history'),null from provider_connections where id=verify.id(20);
create table verify.history(n integer primary key,message jsonb);
grant select on verify.history to authenticated,service_role;
create function verify.record(m jsonb) returns jsonb language sql immutable as $$select jsonb_build_object(
 'tenant_id',verify.id(1),'channel_id','CWINDOW','source_external_id','TCAMPAIGN:CWINDOW:'||(m->>'ts'),
 'provider_timestamp',m->>'ts','thread_timestamp',m->>'thread_ts','text',m->>'text','provider_payload',m)$$;
grant execute on function verify.record(jsonb) to service_role;
do $$declare n integer;stamp text;begin
 for n in 1..20 loop
  stamp:=(1451606500+n)::text||'.000001';
  insert into verify.history values(n,jsonb_build_object('type','message','ts',stamp,'thread_ts',stamp,'text','Synthetic root '||n,'reply_count',1));
 end loop;
 for n in 21..22 loop
  stamp:=(1767225700+n)::text||'.000001';
  insert into verify.history values(n,jsonb_build_object('type','message','subtype','thread_broadcast','ts',stamp,'thread_ts','1230768000.000001','text','Synthetic broadcast '||n));
 end loop;
end$$;
set request.jwt.claim.sub='f7600000-0000-4000-8000-000000000010';set request.jwt.claim.role='authenticated';set role authenticated;
select learn_slack_campaign_start(verify.id(1),verify.id(30),(select definition from verify.campaign));
reset role;set request.jwt.claim.role='service_role';
do $$declare page integer;ordinal integer;j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;cp jsonb;n jsonb;records jsonb;begin
 for page in 1..2 loop
  update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TCAMPAIGN';
  update platform_jobs set available_at='-infinity' where tenant_id=verify.id(1) and status='queued';
  perform set_config('role','service_role',true);
  select * into strict j from learn_slack_claim_jobs(verify.id(40),1);
  select * into strict a from connector_accounts where id::text=j.payload->>'connector_account_id';
  for ordinal in 1..9 loop assert learn_slack_campaign_reserve_request(a.tenant_id,j.id,j.claimed_by,j.attempt_count,ordinal);end loop;
  cp:=a.sync_cursor;
  if cp='{}' then cp:=jsonb_build_object('scopeKey',array_to_json(array[a.tenant_id::text,'TCAMPAIGN','CWINDOW',a.settings#>>'{slack_history,oldest}',a.settings#>>'{slack_history,latest}',a.settings#>>'{slack_history,consentReference}'])::text,'cursor',null,'pages',0,'complete',false);end if;
  n:=cp||jsonb_build_object('pages',page,'cursor',case when page=1 then 'history-next' else null end,'complete',page=2);
  select jsonb_agg(verify.record(q.message) order by q.n) into records from (select h.* from verify.history h order by h.n limit 15 offset (page-1)*15) q;
  assert slack_history_commit_page(a.tenant_id,j.id,a.id,j.claimed_by,j.attempt_count,cp,n,records);
  perform learn_slack_finish_job(a.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
  perform set_config('role','none',true);
 end loop;
 assert (select count(*)=22 from slack_messages where tenant_id=verify.id(1));
end$$;
reset role;
-- Twenty-parent discovery is bounded; two broadcasts refer to the same old root.
set role service_role;
do $$declare r jsonb;begin r:=learn_slack_schedule_campaigns(10);assert r->'queued'='1'::jsonb;end$$;
reset role;
do $$begin
 assert (select count(*)=20 from slack_history_campaign_threads where campaign_id=verify.id(30));
 assert (select not discovery_complete from slack_history_campaign_thread_scans where campaign_id=verify.id(30));
 assert (select count(*)=1 from platform_jobs where tenant_id=verify.id(1) and job_type='slack.thread_sync' and status='queued');
 assert not has_table_privilege('authenticated','slack_history_campaign_threads','SELECT,INSERT,UPDATE,DELETE');
 assert not has_table_privilege('service_role','slack_history_campaign_threads','UPDATE');
end$$;
update slack_history_campaign_channels set next_check_at='-infinity' where campaign_id=verify.id(30);
set role service_role;
do $$declare r jsonb;begin r:=learn_slack_schedule_campaigns(10);assert r->'queued'='0'::jsonb;end$$;
reset role;
do $$declare a uuid;p jsonb;begin
 select account_id into strict a from slack_history_campaign_channels where campaign_id=verify.id(30);
 p:=learn_slack_campaign_channel_progress(verify.id(30),a);
 assert p->'discoveryComplete'='true'::jsonb and p->'observedThreads'='21'::jsonb and p->'completedThreads'='0'::jsonb and p->'complete'='false'::jsonb;
 -- A checkpoint flag without a matching durable successful receipt is not proof.
 begin
  update slack_thread_imports set checkpoint=checkpoint||'{"pages":1,"cursor":null,"complete":true}' where tenant_id=verify.id(1);
  assert learn_slack_campaign_channel_progress(verify.id(30),a)->'completedThreads'='0'::jsonb;
  raise exception 'synthetic_rollback';
 exception when raise_exception then if sqlerrm<>'synthetic_rollback' then raise;end if;end;
end$$;
-- 11 pages for the observed 2009 root, then one page each for 20 roots in 2016.
-- All reply content stays in the approved 2016–2026 period. The old root is not guessed or fetched outside scope.
do $$declare step integer;ordinal integer;old_pages integer:=0;j public.platform_jobs%rowtype;t public.slack_thread_imports%rowtype;
 cp jsonb;next_cp jsonb;records jsonb;message jsonb;stamp text;complete boolean;account uuid;before_count bigint;begin
 for step in 1..31 loop
  update slack_history_campaign_channels set next_check_at='-infinity' where campaign_id=verify.id(30);
  update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity',active_job_id=null where team_id='TCAMPAIGN';
  update platform_jobs set available_at='-infinity' where tenant_id=verify.id(1) and status='queued';
  perform set_config('role','service_role',true);
  perform learn_slack_schedule_campaigns(10);
  select * into strict j from learn_slack_claim_jobs(verify.id(40),1);
  assert j.job_type='slack.thread_sync';
  select * into strict t from slack_thread_imports where id::text=j.payload->>'thread_import_id';account:=t.account_id;
  assert learn_slack_campaign_job_allowed(verify.id(1),j.id);
  assert not learn_slack_campaign_job_allowed(verify.id(2),j.id);
  cp:=t.checkpoint;
  assert cp->>'scopeKey'=array_to_json(array[t.tenant_id::text,'TCAMPAIGN','CWINDOW',t.scope->>'oldest',t.scope->>'latest',t.scope->>'consentReference',t.scope->>'parentTimestamp'])::text;
  if t.scope->>'parentTimestamp'='1230768000.000001' then
   old_pages:=old_pages+1;stamp:=(1577836800+old_pages)::text||'.000001';complete:=old_pages=11;
   if old_pages=11 then
    assert cp->'pages'='0'::jsonb and cp->>'cursor'='reply-10';
    assert t.definition->'previousState'->'checkpoint'->'pages'='10'::jsonb;
    assert t.definition->'previousState'->'scope'->>'oldest'=t.scope->>'oldest';
    assert t.definition->'previousState'->'scope'->>'latest'=t.scope->>'latest';
   end if;
   records:=jsonb_build_array(verify.record(jsonb_build_object('type','message','ts',stamp,'thread_ts',t.scope->>'parentTimestamp','text','Synthetic old-root reply '||old_pages)));
   if complete then records:=records||(select jsonb_agg(verify.record(h.message) order by h.n) from verify.history h where h.n>=21);end if;
  else
   select h.message into strict message from verify.history h where h.message->>'ts'=t.scope->>'parentTimestamp';
   stamp:=((t.scope->>'parentTimestamp')::numeric+0.100000)::text;complete:=true;
   records:=jsonb_build_array(verify.record(message),verify.record(jsonb_build_object('type','message','ts',stamp,'thread_ts',t.scope->>'parentTimestamp','text','Synthetic later reply')));
  end if;
  next_cp:=cp||jsonb_build_object('pages',(cp->>'pages')::integer+1,'cursor',case when complete then null else 'reply-'||old_pages end,'complete',complete);
  if step=6 then
   perform set_config('role','none',true);perform set_config('request.jwt.claim.role','authenticated',true);perform set_config('role','authenticated',true);
   perform learn_slack_campaign_control(verify.id(1),verify.id(50),verify.id(30),1,false,'Pause active thread');
   perform set_config('role','none',true);perform set_config('request.jwt.claim.role','service_role',true);perform set_config('role','service_role',true);
   assert not learn_slack_campaign_reserve_request(t.tenant_id,j.id,j.claimed_by,j.attempt_count,1);
   begin perform slack_thread_commit_page(t.tenant_id,j.id,t.id,j.claimed_by,j.attempt_count,cp,next_cp,records);raise exception 'Paused thread published';exception when insufficient_privilege then null;end;
   perform set_config('role','none',true);perform set_config('request.jwt.claim.role','authenticated',true);perform set_config('role','authenticated',true);
   perform learn_slack_campaign_control(verify.id(1),verify.id(51),verify.id(30),2,true,'Resume active thread');
   perform set_config('role','none',true);perform set_config('request.jwt.claim.role','service_role',true);perform set_config('role','service_role',true);
  end if;
  for ordinal in 1..9 loop assert learn_slack_campaign_reserve_request(t.tenant_id,j.id,j.claimed_by,j.attempt_count,ordinal);end loop;
  assert slack_thread_commit_page(t.tenant_id,j.id,t.id,j.claimed_by,j.attempt_count,cp,next_cp,records);
  assert slack_thread_commit_page(t.tenant_id,j.id,t.id,j.claimed_by,j.attempt_count,cp,next_cp,records);
  perform learn_slack_finish_thread_job(t.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
  perform set_config('role','none',true);
  if step<31 then assert learn_slack_campaign_channel_progress(verify.id(30),account)->'complete'='false'::jsonb;end if;
 end loop;
 assert old_pages=11;
 assert (select requests_reserved=297 from slack_history_campaigns where id=verify.id(30));
 assert (select count(*)=297 from slack_history_campaign_dispatches where campaign_id=verify.id(30));
 assert (select count(*)=53 from slack_messages where tenant_id=verify.id(1));
 assert (select count(*)=53 from slack_message_versions where tenant_id=verify.id(1));
 assert (select count(*)=53 from interactions where tenant_id=verify.id(1) and source_table='slack_messages');
 assert (select count(*)=22 from slack_thread_imports where tenant_id=verify.id(1));
 assert not exists(select 1 from platform_jobs where tenant_id=verify.id(1) and status in ('queued','running','retrying'));
end$$;
reset role;
update slack_history_campaign_channels set next_check_at='-infinity' where campaign_id=verify.id(30);
set role service_role;
do $$begin perform learn_slack_schedule_campaigns(10);end$$;
reset role;set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare r jsonb;begin
 r:=learn_slack_campaign_read(verify.id(1),verify.id(30));
 assert r->'complete'='true'::jsonb and r->'threadsComplete'='true'::jsonb;
 assert r->>'coverage'='fixed_window_observed_threads';
 assert r->'channels'->0->'observedThreads'='21'::jsonb and r->'channels'->0->'completedThreads'='21'::jsonb;
 assert r->'channels'->0->>'state'='campaign_window_complete';
end$$;
reset role;
