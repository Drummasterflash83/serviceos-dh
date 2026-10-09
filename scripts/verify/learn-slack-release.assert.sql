reset role;
create function auth.role() returns text language sql stable as $$ select current_setting('role') $$;
grant execute on function auth.role() to postgres,service_role,authenticated,anon;
insert into tenants(id,slug,display_name) values(verify.id(901),'synthetic-slack-a','Synthetic Slack A'),(verify.id(902),'synthetic-slack-b','Synthetic Slack B');
insert into auth.users(id) values(verify.id(911)),(verify.id(912));
insert into profiles(id,tenant_id,role) values(verify.id(911),verify.id(901),'owner'),(verify.id(912),verify.id(902),'owner');
insert into provider_connections(id,tenant_id,provider,status,non_secret_config,configured_fields,secret_refs)
 values(verify.id(921),verify.id(901),'slack','configured','{"team_id":"TTEST"}',array['bot_token'],jsonb_build_object('bot_token',verify.id(922)));
create table verify.slack_import(result jsonb);
grant all on verify.slack_import to authenticated;
set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000911';
set role authenticated;
do $$ declare r jsonb;rev text;errors int:=0;begin
 select updated_at::text into rev from provider_connections where id=verify.id(921);
 r:=learn_slack_start_import(verify.id(901),verify.id(931),verify.id(921),rev,'CTEST','2026-01-01','2026-01-02',5,'Synthetic isolated approval');
 insert into verify.slack_import values(r);
 assert (learn_slack_start_import(verify.id(901),verify.id(931),verify.id(921),rev,'CTEST','2026-01-01','2026-01-02',5,'Synthetic isolated approval')->>'jobId')=r->>'jobId';
 begin perform learn_slack_start_import(verify.id(901),verify.id(931),verify.id(921),rev,'COTHER','2026-01-01','2026-01-02',5,'Synthetic isolated approval');exception when sqlstate 'PT409' then errors:=errors+1;end;
 begin perform learn_slack_start_import(verify.id(901),verify.id(932),verify.id(921),'2020-01-01','COTHER','2026-01-01','2026-01-02',5,'Stale connection');exception when sqlstate 'PT409' then errors:=errors+1;end;
 begin perform learn_slack_start_import(verify.id(902),verify.id(932),verify.id(921),rev,'COTHER','2026-01-01','2026-01-02',5,'Other company');exception when insufficient_privilege then errors:=errors+1;end;
 assert errors=3;
 assert not has_function_privilege('authenticated','slack_history_commit_page(uuid,uuid,uuid,jsonb,jsonb,jsonb)','execute');
 assert not has_function_privilege('anon','learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text)','execute');
end $$;
reset role;
update platform_jobs set status='running' where id=(select (result->>'jobId')::uuid from verify.slack_import);
-- No direct service DML on Slack facts, source interactions or queue is needed.
create table verify.slack_page as select a.tenant_id,a.id as account_id,(v.result->>'jobId')::uuid as job_id,
 jsonb_build_object('scopeKey',jsonb_build_array(a.tenant_id::text,s->>'teamId',s->>'channelId',s->>'oldest',s->>'latest',s->>'consentReference')::text,'cursor',null,'pages',0,'complete',false) as checkpoint
 from connector_accounts a cross join verify.slack_import v cross join lateral (select a.settings->'slack_history' as s) x where a.id=(v.result->>'accountId')::uuid;
grant select on verify.slack_page to service_role;
set role service_role;
do $$ declare r record;payload jsonb;denied boolean:=false;begin
 select * into r from verify.slack_page;
 payload:=jsonb_build_array(jsonb_build_object('tenant_id',r.tenant_id,'channel_id','CTEST','source_external_id','TTEST:CTEST:1767225700.000001','provider_timestamp','1767225700.000001','thread_timestamp',null,'text','Synthetic retained message','provider_payload',jsonb_build_object('ts','1767225700.000001','text','Synthetic retained message')));
 assert not has_table_privilege('service_role','slack_messages','insert,update,delete,truncate');
 perform slack_history_commit_page(r.tenant_id,r.job_id,r.account_id,r.checkpoint,r.checkpoint||'{"pages":1,"complete":true}',payload);
 begin perform slack_history_commit_page(r.tenant_id,r.job_id,r.account_id,r.checkpoint,r.checkpoint||'{"pages":1,"complete":true}',payload);exception when others then denied:=true;end;
 assert denied,'Stale checkpoint accepted';
 assert (select count(*)=1 from slack_messages where tenant_id=r.tenant_id);
 assert (select count(*)=1 from slack_message_versions where tenant_id=r.tenant_id);
end $$;
reset role;
do $$ declare n text;errors int:=0;begin
 assert (select count(*)=1 from interactions where source_table='slack_messages' and tenant_id=verify.id(901));
 assert (select count(*)=1 from slack_history_imports where tenant_id=verify.id(901));
 assert (select to_jsonb(e)=b.payload from email_messages e cross join verify.email_before b),'Existing email changed';
 foreach n in array array['slack_messages','slack_message_versions','slack_history_imports','provider_connection_events'] loop
  begin execute format('truncate public.%I cascade',n);exception when sqlstate '55000' then errors:=errors+1;end;
 end loop;
 assert errors=4,'Evidence truncation succeeded';
 begin delete from slack_messages where tenant_id=verify.id(901);exception when sqlstate '55000' then errors:=errors+1;end;
 begin update slack_history_imports set definition='{}' where tenant_id=verify.id(901);exception when sqlstate '55000' then errors:=errors+1;end;
 assert errors=6,'Retained source or approval changed';
end $$;
set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000912';
set role authenticated;
do $$begin assert (select count(*)=0 from slack_messages);assert (select count(*)=0 from slack_message_versions);assert (select count(*)=0 from slack_history_imports);end $$;
reset role;
update profiles set role='viewer' where id=verify.id(911);
set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000911';
set role authenticated;
do $$declare denied boolean:=false;begin
 begin perform learn_slack_start_import(verify.id(901),verify.id(934),verify.id(921),'2026-01-01','COTHER','2026-01-01','2026-01-02',5,'Revoked owner');exception when insufficient_privilege then denied:=true;end;
 assert denied,'Revoked owner approved an import';
end $$;
reset role;
