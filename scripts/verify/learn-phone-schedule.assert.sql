update connector_accounts set sync_cursor='{"last_synced_until":"2026-10-10T00:15:00.000Z","retain":"other-progress"}',last_successful_sync_at='2026-10-10T00:15:00Z';
create function fixture_schedule(n integer) returns void language plpgsql as $$
declare a connector_accounts%rowtype;m jsonb;fm text;tm text;k text;rid uuid;begin
 select * into a from connector_accounts where id=fixture_id(4);
 fm:=to_char((a.sync_cursor->>'last_synced_until')::timestamptz-interval '15 minutes','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 tm:=to_char((a.sync_cursor->>'last_synced_until')::timestamptz+interval '1 hour','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 insert into platform_jobs(id,tenant_id,connector_id,job_type,status,claimed_by,attempt_count,lease_expires_at,payload)
 values(fixture_id(n+1),fixture_id(1),'simwood','phone.scheduled_sync','running','fixture-owner',1,clock_timestamp()+interval '5 minutes',jsonb_build_object('provider_customer_id','3950','from',fm,'to',tm));
 insert into phone_sync_runs(id,tenant_id,sync_type,metadata) values(fixture_id(n),fixture_id(1),'scheduled_sync',
  jsonb_build_object('connector_account_id',fixture_id(4),'tenant_connector_id',fixture_id(3),'job_id',fixture_id(n+1),
   'job_owner','fixture-owner','provider_customer_id','3950','account_updated_at',a.updated_at,'include_local',false,'from',fm,'to',tm));
 foreach k in array array['calls','recordings'] loop
  rid:=fixture_id(n+case when k='calls' then 2 else 3 end);
  m:=jsonb_build_object('from',fm,'to',tm,'limit',null)||case when k='calls' then '{"include_local":false,"direction":null}'::jsonb else '{"call_id":null,"linked_id":null}'::jsonb end;
  insert into phone_sync_runs(id,tenant_id,sync_type,metadata) values(rid,fixture_id(1),k,m);
  perform learn_phone_publish_page(fixture_id(1),rid,fixture_id(4),fixture_id(3),'3950',k,1,fixture_rows(k,'schedule-'||n||'-'||k));
  perform learn_phone_complete_import(fixture_id(1),rid,fixture_id(4),fixture_id(3),'3950',k,1,1,
   m||jsonb_build_object('customer_id','3950','pages_fetched',1,'window_complete',true,case when k='calls' then 'skipped_no_call_id' else 'skipped_no_recording_id' end,0));
 end loop;
end$$;
create function fixture_settle(n integer,outcome text default 'success',errors jsonb default '{}') returns jsonb language sql as $$
 select learn_phone_settle_schedule(fixture_id(1),fixture_id(n),fixture_id(n+2),fixture_id(n+3),outcome,errors);$$;
select fixture_schedule(300);
set role service_role;
do $$declare a jsonb;begin a:=fixture_settle(300);assert a=fixture_settle(300);assert a->'cursorAdvanced'='true';assert a->>'callsProcessed'='1';assert a->>'recordingsProcessed'='1';end$$;
reset role;
do $$begin
 assert(select status='success' and records_processed=2 from phone_sync_runs where id=fixture_id(300));
 assert(select status='succeeded' and lease_expires_at is null and records_processed=2 from platform_jobs where id=fixture_id(301));
 assert(select sync_cursor->>'retain'='other-progress' and sync_cursor->>'last_synced_until'='2026-10-10T01:15:00.000Z' from connector_accounts where id=fixture_id(4));
 assert(select health_status='healthy' from tenant_connectors where id=fixture_id(3));
end$$;
select 'PASS: durable child evidence, merged cursor, run/job/health and exact replay settle together';

select fixture_schedule(310);
create function fixture_fail_schedule() returns trigger language plpgsql as $$begin raise exception 'settlement_failure' using errcode='P0002';end$$;
create trigger fixture_schedule_failure before insert on learn_phone_schedule_settlements for each row execute function fixture_fail_schedule();
set role service_role;
do $$begin begin perform fixture_settle(310);raise exception 'Receipt failure ignored';exception when sqlstate 'P0002' then null;end;end$$;
reset role;drop trigger fixture_schedule_failure on learn_phone_schedule_settlements;
do $$begin
 assert(select status='running' from phone_sync_runs where id=fixture_id(310));
 assert(select status='running' and lease_expires_at is not null from platform_jobs where id=fixture_id(311));
 assert(select sync_cursor->>'last_synced_until'='2026-10-10T01:15:00.000Z' from connector_accounts where id=fixture_id(4));
 assert not exists(select 1 from learn_phone_schedule_settlements where run_id=fixture_id(310));
end$$;
select 'PASS: receipt insertion failure rolls back all progress and status writes';

-- An account modification after the initial read fences both success and failure.
select fixture_schedule(320);
update connector_accounts set display_name='changed after dispatch' where id=fixture_id(4);
set role service_role;
do $$begin
 begin perform fixture_settle(320);raise exception 'Stale success admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_schedule_account_changed';end;
 begin perform fixture_settle(320,'failed','{"calls":"provider_unavailable"}');raise exception 'Stale failure admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_schedule_account_changed';end;
end$$;
reset role;
select fixture_schedule(330);
update platform_jobs set claimed_by='another-owner',attempt_count=2 where id=fixture_id(331);
set role service_role;
do $$begin begin perform fixture_settle(330);raise exception 'Lost job admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_schedule_job_changed';end;end$$;
reset role;
select fixture_schedule(340);
update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=fixture_id(341);
set role service_role;
do $$begin begin perform fixture_settle(340);raise exception 'Expired lease admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_schedule_job_changed';end;end$$;
reset role;
select 'PASS: stale success/failure, replaced owner and expired job cannot settle';

select fixture_schedule(350);
update phone_sync_runs set status='failed' where id=fixture_id(352);
set role service_role;
do $$begin
 begin perform fixture_settle(350);raise exception 'Failed child admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_schedule_child_unconfirmed';end;
 begin perform learn_phone_settle_schedule(fixture_id(2),fixture_id(350),fixture_id(352),fixture_id(353),'success','{}');raise exception 'Cross tenant admitted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_phone_settle_schedule(fixture_id(1),fixture_id(350),fixture_id(353),fixture_id(352),'success','{}');raise exception 'Swapped child kinds admitted';exception when sqlstate 'PT409' then null;end;
end$$;
reset role;
select fixture_schedule(360);
update phone_sync_runs set metadata=metadata||'{"direction":"IN"}' where id=fixture_id(362);
set role service_role;
do $$begin begin perform fixture_settle(360);raise exception 'Changed filters admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_schedule_child_unconfirmed';end;end$$;
reset role;
select 'PASS: unsuccessful, foreign, swapped and changed-filter children do not advance';

select fixture_schedule(370);
update feature_flags set value='false';
set role service_role;
do $$begin
 begin perform fixture_settle(370);raise exception 'Paused capture advanced';exception when sqlstate 'PT409' then assert SQLERRM='learn_capture_paused';end;
 assert fixture_settle(370,'paused','{"recordings":"learn_capture_paused"}')->'cursorAdvanced'='false';
 assert fixture_settle(300)->'cursorAdvanced'='true';
end$$;
reset role;
do $$begin
 assert(select status='paused' from phone_sync_runs where id=fixture_id(370));
 assert(select status='cancelled' and lease_expires_at is null from platform_jobs where id=fixture_id(371));
 assert(select sync_cursor->>'last_synced_until'='2026-10-10T01:15:00.000Z' from connector_accounts where id=fixture_id(4));
end$$;
update feature_flags set value='true';
select fixture_schedule(380);
set role service_role;
select fixture_settle(380,'failed','{"calls":"provider_unavailable"}')->>'outcome';
reset role;
do $$begin
 assert(select status='failed' from phone_sync_runs where id=fixture_id(380));
 assert(select status='failed' and lease_expires_at is null from platform_jobs where id=fixture_id(381));
 assert(select health_status='warning' and last_error='phone_sync_failed' from tenant_connectors where id=fixture_id(3));
 assert(select sync_cursor->>'last_synced_until'='2026-10-10T01:15:00.000Z' from connector_accounts where id=fixture_id(4));
end$$;
select 'PASS: pause/failure retain cursor and settle their run/job without false healthy status';

insert into connector_accounts(id,tenant_id,tenant_connector_id,account_key,status,last_error)
 values(fixture_id(5),fixture_id(1),fixture_id(3),'other-provider-customer','active','needs_attention');
select fixture_schedule(390);
set role service_role;select fixture_settle(390)->>'outcome';reset role;
do $$begin assert(select health_status='warning' and last_error='phone_accounts_need_attention' from tenant_connectors where id=fixture_id(3));end$$;
update connector_accounts set status='disabled' where id=fixture_id(5);
select 'PASS: one successful account cannot hide another active account needing attention';

do $$begin
 assert not has_function_privilege('anon','learn_phone_settle_schedule(uuid,uuid,uuid,uuid,text,jsonb)','execute');
 assert not has_function_privilege('authenticated','learn_phone_settle_schedule(uuid,uuid,uuid,uuid,text,jsonb)','execute');
 assert not has_table_privilege('authenticated','learn_phone_schedule_settlements','select,insert,update,delete');
 assert not has_table_privilege('service_role','learn_phone_schedule_settlements','insert,update,delete,truncate');
 begin update learn_phone_schedule_settlements set receipt='{}';raise exception 'Receipt overwritten';exception when sqlstate '55000' then null;end;
 begin truncate learn_phone_schedule_settlements;raise exception 'Receipt truncated';exception when sqlstate '55000' then null;end;
end$$;
select 'PASS: private settlement authority and immutable retained receipts';

begin;
select fixture_schedule(440);
insert into phone_sync_runs(id,tenant_id,sync_type,metadata)
 select fixture_id(444),tenant_id,sync_type,metadata from phone_sync_runs where id=fixture_id(442);
select learn_phone_publish_page(fixture_id(1),fixture_id(444),fixture_id(4),fixture_id(3),'3950','calls',1,fixture_rows('calls','no-completion-proof'));
update phone_sync_runs set status='success' where id=fixture_id(444);
set local role service_role;
do $$begin
 begin perform learn_phone_settle_schedule(fixture_id(1),fixture_id(440),fixture_id(444),fixture_id(443),'success','{}');raise exception 'Success flag without receipt admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_schedule_child_unconfirmed';end;
 begin perform learn_phone_settle_schedule(fixture_id(1),fixture_id(440),fixture_id(302),fixture_id(303),'success','{}');raise exception 'Old child window admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_schedule_child_changed';end;
end$$;
rollback;
select 'PASS: legacy success flag without completion evidence and old-window children are refused';

begin;
select fixture_schedule(450);
-- Simulate an internally constructed window that omitted required older work.
update connector_accounts set sync_cursor=jsonb_set(sync_cursor,'{last_synced_until}','"2026-10-09T00:00:00.000Z"') where id=fixture_id(4);
update phone_sync_runs set metadata=metadata||jsonb_build_object('account_updated_at',(select updated_at from connector_accounts where id=fixture_id(4))) where id=fixture_id(450);
set local role service_role;
do $$begin begin perform fixture_settle(450);raise exception 'Gap in cursor coverage admitted';exception when sqlstate 'PT409' then assert SQLERRM='phone_schedule_window_gap';end;end$$;
rollback;
select 'PASS: even complete child windows cannot skip an older saved cursor';
