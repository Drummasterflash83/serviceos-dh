-- Synthetic completion metadata fixtures. Transport/claim behavior is covered by
-- the existing worker suites; this exercises actual recurring SQL and history rows.
insert into tenants(id) values('00000000-0000-4000-8000-000000000010');
insert into profiles values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000010','owner'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000010','viewer');
insert into provider_connections(id,tenant_id,provider,status,non_secret_config,configured_fields,secret_refs)
 values('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','slack','configured','{"team_id":"TSETUP"}',array['bot_token'],'{"bot_token":"00000000-0000-4000-8000-000000000021"}');
insert into slack_messages(id,tenant_id,source_external_id,team_id,channel_id,provider_timestamp,message_text,provider_payload,source_version,source_updated_at)
 values('00000000-0000-4000-8000-000000000050','00000000-0000-4000-8000-000000000010','synthetic-retained','TSETUP','CSETUP','1767225600.000001','Retained synthetic message','{"text":"Retained synthetic message"}','synthetic-version',1767225600.000001);
insert into slack_message_versions(tenant_id,message_id,source_version,provider_payload)
 select tenant_id,id,source_version,provider_payload from slack_messages;
create table verify.source_before as select 'messages' as name,md5(jsonb_agg(to_jsonb(s) order by s.id)::text) as fingerprint from slack_messages s
 union all select 'versions',md5(jsonb_agg(to_jsonb(s) order by s.id)::text) from slack_message_versions s;
set test.actor='00000000-0000-4000-8000-000000000011';
set test.role='authenticated';
set role authenticated;
select learn_slack_start_import('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000040',
 '00000000-0000-4000-8000-000000000020','2026-10-09T10:00:00Z','CSETUP','2026-01-01','2026-01-02',10,'Initial approved capture');
reset role;
insert into verify.fixture select id,(select job_id from slack_history_imports limit 1),null,settings from connector_accounts;
update connector_accounts set sync_cursor=jsonb_build_object('scopeKey',jsonb_build_array(tenant_id::text,
 settings->'slack_history'->>'teamId',settings->'slack_history'->>'channelId',settings->'slack_history'->>'oldest',
 settings->'slack_history'->>'latest',settings->'slack_history'->>'consentReference')::text,'complete',true,'pages',1,'cursor',null);
update verify.fixture set initial_cursor=(select sync_cursor from connector_accounts);
update platform_jobs set status='succeeded',metadata=jsonb_build_object('slack_page_v1',jsonb_build_object('account_id',
 payload->>'connector_account_id','next',(select initial_cursor from verify.fixture)));

set role authenticated;
do $$declare account uuid:=(select account_id from verify.fixture);r jsonb;again jsonb;denied boolean:=false;begin
 r:=learn_slack_recurring_control('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000041',account,0,true,'Keep this channel current');
 again:=learn_slack_recurring_control('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000041',account,0,true,'Keep this channel current');
 if r<>again or r->>'revision'<>'1' then raise exception 'Lost reply repeated enable';end if;
 begin perform learn_slack_recurring_control('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000041',account,0,false,'Changed identity');
 exception when serialization_failure then denied:=true;end;
 if not denied then raise exception 'Changed retry accepted';end if;
 denied:=false;
 begin perform learn_slack_schedule_recurring(1);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Browser can schedule';end if;
end $$;
reset role;
select 'PASS: owner approval, request replay and service-only scheduler';

-- Tenant/viewer/preview checks and RLS are exercised under actual authenticated role.
set role authenticated;
set test.actor='00000000-0000-4000-8000-000000000012';
do $$declare denied boolean:=false;begin
 if (select count(*) from slack_recurring_channels)<>0 then raise exception 'Viewer reads operator configuration';end if;
 begin perform learn_slack_recurring_control('00000000-0000-4000-8000-000000000010',gen_random_uuid(),(select account_id from verify.fixture),1,false,'Viewer');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Viewer changed subscription';end if;
end $$;
reset role;
insert into view_as_context values('00000000-0000-4000-8000-000000000011',null,null);
set role authenticated;
set test.actor='00000000-0000-4000-8000-000000000011';
do $$declare denied boolean:=false;begin
 begin perform learn_slack_recurring_control('00000000-0000-4000-8000-000000000010',gen_random_uuid(),(select account_id from verify.fixture),1,false,'Preview');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Preview changed subscription';end if;
end $$;
reset role;
update view_as_context set ended_at=clock_timestamp();
select 'PASS: viewer and View-As denial';

set test.role='service_role';
set role service_role;
do $$declare r jsonb;begin
 r:=learn_slack_schedule_recurring(10);
 if r<>jsonb_build_object('checked',1,'queued',1,'held',0) then raise exception 'First window not queued: %',r;end if;
 r:=learn_slack_schedule_recurring(10);
 if r->>'queued'<>'0' then raise exception 'Repeat scheduler duplicated window';end if;
end $$;
reset role;
do $$declare a connector_accounts%rowtype;i slack_history_imports%rowtype;begin
 select * into a from connector_accounts limit 1;
 select * into i from slack_history_imports where id=(select current_import from slack_recurring_channels);
 if a.settings->'slack_history'->>'oldest'<>'1767312000.000000' or
  (a.settings->'slack_history'->>'latest')::numeric-(a.settings->'slack_history'->>'oldest')::numeric<>900 then raise exception 'Window boundary gap or wrong size';end if;
 if i.previous_state->'checkpoint'<>(select initial_cursor from verify.fixture) or
  i.previous_state->'settings'<>(select initial_settings->'slack_history' from verify.fixture) then raise exception 'Previous evidence not retained';end if;
 if (select count(*) from platform_jobs where status='queued')<>1 then raise exception 'Unexpected jobs';end if;
end $$;
select 'PASS: atomic bounded window enqueue, replay and previous-checkpoint retention';

-- Terminal status with an unfinished checkpoint cannot skip the window.
update platform_jobs set status='dead_letter' where status='queued';
update slack_recurring_channels set next_check_at=clock_timestamp();
set role service_role;
select learn_slack_schedule_recurring(10);
reset role;
do $$begin if (select last_state from slack_recurring_channels)<>'window_incomplete' or
 (select count(*) from slack_history_imports)<>2 then raise exception 'Skipped unfinished window';end if;end $$;

-- Completing the current window requires a matching receipt, not just a boolean.
update connector_accounts set sync_cursor=jsonb_build_object('scopeKey',jsonb_build_array(tenant_id::text,
 settings->'slack_history'->>'teamId',settings->'slack_history'->>'channelId',settings->'slack_history'->>'oldest',
 settings->'slack_history'->>'latest',settings->'slack_history'->>'consentReference')::text,'complete',true,'pages',1,'cursor',null);
update slack_recurring_channels set next_check_at=clock_timestamp();
set role service_role;
select learn_slack_schedule_recurring(10);
reset role;
do $$begin if (select last_state from slack_recurring_channels)<>'completion_unverified' then raise exception 'Boolean checkpoint treated as proof';end if;end $$;
update platform_jobs set status='succeeded',metadata=jsonb_build_object('slack_page_v1',jsonb_build_object('account_id',payload->>'connector_account_id','next',(select sync_cursor from connector_accounts))) where status='dead_letter';
select 'PASS: unfinished and unverified windows are held';

-- Switch and credential changes hold the exact completed boundary.
insert into feature_flags values('00000000-0000-4000-8000-000000000010','learn.inputs.slack.enabled','false');
update slack_recurring_channels set next_check_at=clock_timestamp();
set role service_role;
select learn_slack_schedule_recurring(10);
reset role;
do $$begin if (select last_state from slack_recurring_channels)<>'capture_paused' then raise exception 'Pause ignored';end if;end $$;
update feature_flags set value='true';
update provider_connections set updated_at=updated_at+interval '1 second';
update slack_recurring_channels set next_check_at=clock_timestamp();
set role service_role;
select learn_slack_schedule_recurring(10);
reset role;
do $$begin if (select last_state from slack_recurring_channels)<>'connection_changed' then raise exception 'Credential revision change ignored';end if;end $$;
update provider_connections set updated_at=updated_at-interval '1 second';
select 'PASS: capture pause and changed connection hold scheduling';

update profiles set role='viewer' where id='00000000-0000-4000-8000-000000000011';
update slack_recurring_channels set next_check_at=clock_timestamp();
set role service_role;
select learn_slack_schedule_recurring(10);
reset role;
do $$begin if (select last_state from slack_recurring_channels)<>'approval_changed' then raise exception 'Approver revocation ignored';end if;end $$;
update profiles set role='owner' where id='00000000-0000-4000-8000-000000000011';
update connector_accounts set settings=jsonb_set(settings,'{slack_history,approved}','false');
update slack_recurring_channels set next_check_at=clock_timestamp();
set role service_role;
select learn_slack_schedule_recurring(10);
reset role;
do $$begin if (select last_state from slack_recurring_channels)<>'approval_changed' then raise exception 'Scope withdrawal ignored';end if;end $$;
update connector_accounts set settings=jsonb_set(settings,'{slack_history,approved}','true');
select 'PASS: approver revocation and scope withdrawal block new windows';

-- Inject a queue insertion failure: no scope/checkpoint/approval is partially lost.
alter table platform_jobs add constraint recurring_queue_failure check(status<>'queued');
update slack_recurring_channels set next_check_at=clock_timestamp();
set role service_role;
do $$declare denied boolean:=false;begin
 begin perform learn_slack_schedule_recurring(10);exception when check_violation then denied:=true;end;
 if not denied then raise exception 'Injected failure did not fire';end if;
end $$;
reset role;
do $$begin if (select sync_cursor->>'complete' from connector_accounts)<>'true' or
 (select count(*) from slack_history_imports)<>2 then raise exception 'Queue failure partially advanced checkpoint';end if;end $$;
alter table platform_jobs drop constraint recurring_queue_failure;
set role service_role;
select learn_slack_schedule_recurring(10);
reset role;
do $$begin if (select settings->'slack_history'->>'oldest' from connector_accounts)<>'1767312900.000000' then raise exception 'Next window has gap';end if;end $$;
select 'PASS: insertion failure rolls back all changes; next window has no gap';

-- Disabling stops further fetch authority while retaining the unfinished page.
set test.role='authenticated';
set role authenticated;
select learn_slack_recurring_control('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000042',
 (select account_id from verify.fixture),1,false,'Pause recurring capture');
reset role;
do $$begin
 if (select enabled from slack_recurring_channels) or (select settings->'slack_history'->>'approved' from connector_accounts)<>'false' then raise exception 'Disable did not withdraw authority';end if;
 if (select count(*) from slack_history_imports)<>3 or (select count(*) from slack_recurring_requests)<>2 then raise exception 'Approval evidence changed';end if;
 if has_table_privilege('authenticated','slack_recurring_channels','update') or has_function_privilege('anon','learn_slack_schedule_recurring(integer)','execute') then raise exception 'Broad grants introduced';end if;
 if (select fingerprint from verify.source_before where name='messages')<>(select md5(jsonb_agg(to_jsonb(s) order by s.id)::text) from slack_messages s)
  or (select fingerprint from verify.source_before where name='versions')<>(select md5(jsonb_agg(to_jsonb(s) order by s.id)::text) from slack_message_versions s) then raise exception 'Retained source history changed';end if;
end $$;
select 'PASS: explicit disable withdraws current recurring scope and retains history';

-- Re-enable cannot skip an unfinished page or renew its expiry/budget.
create table verify.paused_scope as select settings,sync_cursor from connector_accounts;
set test.role='authenticated';set role authenticated;
select learn_slack_recurring_control('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000044',
 (select account_id from verify.fixture),2,true,'Resume the same paused window');
reset role;
do $$begin
 if (select sync_cursor from connector_accounts)<>(select sync_cursor from verify.paused_scope)
  or (select settings from connector_accounts)<>(select jsonb_set(settings,'{slack_history,approved}','true') from verify.paused_scope)
  or (select current_import is null from slack_recurring_channels) then raise exception 'Resume replaced or extended unfinished scope';end if;
end $$;
set test.role='service_role';set role service_role;
select learn_slack_schedule_recurring(10);
reset role;
do $$begin if (select last_state from slack_recurring_channels)<>'window_active' or (select count(*) from slack_history_imports)<>3 then raise exception 'Resume advanced unfinished window';end if;end $$;
select 'PASS: re-enable retains exact unfinished window, cursor, expiry and budget';
