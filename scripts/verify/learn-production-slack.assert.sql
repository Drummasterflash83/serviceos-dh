-- Synthetic source-to-storage journey after the entire production Slack package.
-- Only executed in the disposable offline clone; never calls Slack or reads a key.
set search_path=public,pg_catalog;
create schema verify;
create table verify.slack(result jsonb);
grant usage on schema verify to authenticated,service_role;
grant select,insert on verify.slack to authenticated,service_role;
insert into tenants(id,slug,display_name) values
 ('f7000000-0000-4000-8000-000000000001','production-slack-probe','Synthetic Slack company'),
 ('f7000000-0000-4000-8000-000000000002','production-slack-foreign','Synthetic foreign company');
insert into auth.users(id) values('f7000000-0000-4000-8000-000000000011'),('f7000000-0000-4000-8000-000000000012');
update profiles set tenant_id='f7000000-0000-4000-8000-000000000001',role='owner' where id='f7000000-0000-4000-8000-000000000011';
update profiles set tenant_id='f7000000-0000-4000-8000-000000000002',role='owner' where id='f7000000-0000-4000-8000-000000000012';
insert into provider_connections(id,tenant_id,provider,status,non_secret_config,configured_fields,secret_refs) values
 ('f7000000-0000-4000-8000-000000000021','f7000000-0000-4000-8000-000000000001','slack','configured','{"team_id":"TPROBE"}',array['bot_token'],'{"bot_token":"f7000000-0000-4000-8000-000000000022"}');
set request.jwt.claim.sub='f7000000-0000-4000-8000-000000000011';set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare r jsonb;rev text;begin
 select updated_at::text into rev from provider_connections where id='f7000000-0000-4000-8000-000000000021';
 r:=learn_slack_start_import('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000031','f7000000-0000-4000-8000-000000000021',rev,'CPROBE','2026-01-01','2026-01-02',3,'Synthetic archived-schema journey');
 insert into verify.slack values(r);
 assert learn_slack_start_import('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000031','f7000000-0000-4000-8000-000000000021',rev,'CPROBE','2026-01-01','2026-01-02',3,'Synthetic archived-schema journey')->>'jobId'=r->>'jobId';
 begin perform learn_slack_start_import('f7000000-0000-4000-8000-000000000002',gen_random_uuid(),'f7000000-0000-4000-8000-000000000021',rev,'CPROBE','2026-01-01','2026-01-02',3,'Foreign company');raise exception 'Foreign approval admitted';exception when insufficient_privilege then null;end;
end $$;
reset role;set request.jwt.claim.role='service_role';set role service_role;
do $$declare j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;c jsonb;n jsonb;p jsonb;r jsonb;begin
 select * into strict j from learn_slack_claim_jobs('f7000000-0000-4000-8000-000000000041',1);
 assert j.id=(select (result->>'jobId')::uuid from verify.slack);
 select * into strict a from connector_accounts where id=(select (result->>'accountId')::uuid from verify.slack);
 c:=jsonb_build_object('scopeKey',jsonb_build_array(a.tenant_id::text,a.settings#>>'{slack_history,teamId}',a.settings#>>'{slack_history,channelId}',a.settings#>>'{slack_history,oldest}',a.settings#>>'{slack_history,latest}',a.settings#>>'{slack_history,consentReference}')::text,'cursor',null,'pages',0,'complete',false);
 n:=c||'{"pages":1,"complete":true}';
 p:=jsonb_build_array(jsonb_build_object('tenant_id',a.tenant_id,'channel_id','CPROBE','source_external_id','TPROBE:CPROBE:1767225700.000001','provider_timestamp','1767225700.000001','thread_timestamp',null,'text','Synthetic retained communication','provider_payload','{"ts":"1767225700.000001","text":"Synthetic retained communication","reply_count":2}'::jsonb));
 begin perform slack_history_commit_page(a.tenant_id,j.id,a.id,'expired-worker',1,c,n,p);raise exception 'Unowned publication admitted';exception when sqlstate 'PT409' then null;end;
 assert slack_history_commit_page(a.tenant_id,j.id,a.id,j.claimed_by,j.attempt_count,c,n,p);
 assert slack_history_commit_page(a.tenant_id,j.id,a.id,j.claimed_by,j.attempt_count,c,n,p),'Exact replay failed';
 r:=learn_slack_finish_job(a.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
 assert (select status='succeeded' from platform_jobs where id=j.id);
 assert (select count(*)=1 from slack_messages where tenant_id=a.tenant_id);
 assert (select count(*)=1 from slack_message_versions where tenant_id=a.tenant_id);
 assert (select count(*)=1 from interactions where tenant_id=a.tenant_id and source_table='slack_messages');
 assert not has_table_privilege('service_role','slack_messages','INSERT,UPDATE,DELETE,TRUNCATE');
end $$;
reset role;
-- An ongoing approval is explicit. Pause stops admission while retained history stays.
set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare r jsonb;a uuid;begin
 select (result->>'accountId')::uuid into a from verify.slack;
 r:=learn_slack_recurring_control('f7000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000051',a,0,true,'Synthetic ongoing approval');
 assert r is not null;
end $$;
reset role;
insert into feature_flags(tenant_id,flag,value) values('f7000000-0000-4000-8000-000000000001','learn.inputs.slack.enabled','false');
set request.jwt.claim.role='service_role';set role service_role;
do $$declare before_jobs bigint;r jsonb;begin
 select count(*) into before_jobs from platform_jobs where tenant_id='f7000000-0000-4000-8000-000000000001';
 assert not learn_capture_allowed('f7000000-0000-4000-8000-000000000001','slack');
 r:=learn_slack_schedule_recurring(10);
 assert (select count(*) from platform_jobs where tenant_id='f7000000-0000-4000-8000-000000000001')=before_jobs;
 assert (select count(*)=1 from slack_messages where tenant_id='f7000000-0000-4000-8000-000000000001');
end $$;
reset role;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='f7000000-0000-4000-8000-000000000012';set role authenticated;
do $$begin
 assert not exists(select 1 from slack_messages);
 assert not exists(select 1 from slack_message_versions);
 begin perform learn_slack_recurring_read('f7000000-0000-4000-8000-000000000001');raise exception 'Foreign status read admitted';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
 begin delete from slack_messages where tenant_id='f7000000-0000-4000-8000-000000000001';raise exception 'Source deletion admitted';exception when sqlstate '55000' then null;end;
 insert into provider_connection_events(tenant_id,provider,event) values('f7000000-0000-4000-8000-000000000001','slack','synthetic_retention_probe');
 begin update provider_connection_events set detail='{}' where tenant_id='f7000000-0000-4000-8000-000000000001';raise exception 'Audit overwrite admitted';exception when sqlstate '55000' then null;end;
end $$;
