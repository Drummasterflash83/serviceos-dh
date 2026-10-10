insert into phone_sync_runs(id,tenant_id,sync_type,metadata)
 select fixture_id(n),fixture_id(1),'calls','{"from":"2026-10-10T00:00:00.000Z","to":"2026-10-10T01:00:00.000Z","include_local":false}'
 from generate_series(100,120)n;
create function fixture_complete(run integer,pages integer default 1,records integer default 1) returns jsonb language sql as $$
 select learn_phone_complete_import(fixture_id(1),fixture_id(run),fixture_id(4),fixture_id(3),'3950','calls',pages,records,
  jsonb_build_object('from','2026-10-10T00:00:00.000Z','to','2026-10-10T01:00:00.000Z','include_local',false,
  'customer_id','3950','pages_fetched',pages,'skipped_no_call_id',0,'window_complete',true));$$;
set role service_role;
do $$begin perform fixture_page(n,'calls',1,'completion-'||n) from generate_series(100,113)n;end$$;
do $$declare a jsonb;b jsonb;begin
 a:=fixture_complete(100);b:=fixture_complete(100);assert a=b;
 assert a->>'version'='learn-phone-import/1';assert a->>'recordsProcessed'='1';
 assert a->>'accountId'=fixture_id(4)::text;assert a->>'windowComplete'='true';
 assert fixture_page(100,'calls',1,'completion-100')->>'recordsProcessed'='1';
 begin perform fixture_page(100,'calls',2,'too-late');raise exception 'Page after completion accepted';exception when sqlstate 'PT409' then null;end;
 begin perform fixture_complete(100,1,0);raise exception 'Conflicting replay accepted';exception when sqlstate 'PT409' then null;end;
 begin perform fixture_complete(101,2,1);raise exception 'Missing pages accepted';exception when sqlstate 'PT409' then assert SQLERRM='phone_completion_pages_changed';end;
 begin perform fixture_complete(101,1,0);raise exception 'Wrong record count accepted';exception when sqlstate 'PT409' then assert SQLERRM='phone_completion_pages_changed';end;
 begin perform fixture_complete(120,1,0);raise exception 'No page receipt accepted';exception when sqlstate 'PT409' then null;end;
end$$;
reset role;
do $$begin
 assert (select status='success' and records_processed=1 and completed_at is not null from phone_sync_runs where id=fixture_id(100));
 assert (select status='running' from phone_sync_runs where id=fixture_id(101));
end$$;
select 'PASS: completion receipt and status agree; exact replay; no extra pages or false counts';

create function fixture_fail_completion() returns trigger language plpgsql as $$begin raise exception 'completion_failure' using errcode='P0002';end$$;
create trigger fixture_completion_failure before insert on learn_phone_import_completions for each row execute function fixture_fail_completion();
set role service_role;
do $$begin begin perform fixture_complete(101);raise exception 'Receipt failure ignored';exception when sqlstate 'P0002' then null;end;end$$;
reset role;
drop trigger fixture_completion_failure on learn_phone_import_completions;
do $$begin
 assert (select status='running' and completed_at is null from phone_sync_runs where id=fixture_id(101));
 assert not exists(select 1 from learn_phone_import_completions where run_id=fixture_id(101));
 assert exists(select 1 from phone_calls where provider_call_id='completion-101');
end$$;
select 'PASS: completion failure rolls back success without losing previously committed pages';

update feature_flags set value='false';
set role service_role;
do $$begin
 assert fixture_complete(100)->>'windowComplete'='true';
 begin perform fixture_complete(102);raise exception 'Pause accepted';exception when sqlstate 'PT409' then assert SQLERRM='learn_capture_paused';end;
end$$;
reset role;update feature_flags set value='true';
update connector_accounts set settings='{"provider_customer_id":"8000"}';
set role service_role;
do $$begin begin perform fixture_complete(102);raise exception 'Rebind accepted';exception when sqlstate 'PT409' then assert SQLERRM='phone_account_unavailable';end;end$$;
reset role;update connector_accounts set settings='{}';
update tenant_connectors set enabled=false;
set role service_role;
do $$begin begin perform fixture_complete(102);raise exception 'Disabled connector accepted';exception when sqlstate 'PT409' then assert SQLERRM='phone_account_unavailable';end;end$$;
reset role;update tenant_connectors set enabled=true;
select 'PASS: final capture/account checks; immutable replay settles after pause';

set role service_role;
do $$declare m jsonb;begin
 m:='{"from":"2026-10-10T00:00:00.000Z","to":"2026-10-10T01:00:00.000Z","include_local":false,"customer_id":"3950","pages_fetched":1,"skipped_no_call_id":0,"window_complete":true}';
 begin perform learn_phone_complete_import(fixture_id(2),fixture_id(103),fixture_id(4),fixture_id(3),'3950','calls',1,1,m);raise exception 'Tenant mismatch accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_phone_complete_import(fixture_id(1),fixture_id(103),fixture_id(5),fixture_id(3),'3950','calls',1,1,m);raise exception 'Page account mismatch accepted';exception when sqlstate 'PT409' then assert SQLERRM='phone_completion_pages_changed';end;
 begin perform learn_phone_complete_import(fixture_id(1),fixture_id(103),fixture_id(4),fixture_id(3),'3950','calls',1,1,m||'{"from":"2026-10-09T00:00:00.000Z"}');raise exception 'Window change accepted';exception when sqlstate 'PT409' then assert SQLERRM='phone_completion_window_changed';end;
 begin perform learn_phone_complete_import(fixture_id(1),fixture_id(103),fixture_id(4),fixture_id(3),'3950','calls',1,1,m||'{"include_local":true}');raise exception 'Filter change accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_phone_complete_import(fixture_id(1),fixture_id(103),fixture_id(4),fixture_id(3),'3950','calls',1,1,m||'{"window_complete":false}');raise exception 'Partial window accepted';exception when invalid_parameter_value then null;end;
 begin perform learn_phone_complete_import(fixture_id(1),fixture_id(103),fixture_id(4),fixture_id(3),'3950','calls',1,1,m||'{"skipped_no_call_id":1}');raise exception 'Skipped ID accepted';exception when invalid_parameter_value then null;end;
 -- Even an empty provider window must have a durable page receipt.
 perform learn_phone_publish_page(fixture_id(1),fixture_id(114),fixture_id(4),fixture_id(3),'3950','calls',1,'[]');
 assert fixture_complete(114,1,0)->>'recordsProcessed'='0';
end$$;
reset role;
update phone_sync_runs set status='failed' where id=fixture_id(104);
set role service_role;
do $$begin begin perform fixture_complete(104);raise exception 'Failed run completed';exception when sqlstate 'PT409' then assert SQLERRM='phone_completion_run_changed';end;end$$;
reset role;
do $$begin
 assert not has_function_privilege('authenticated','learn_phone_complete_import(uuid,uuid,uuid,uuid,text,text,integer,integer,jsonb)','execute');
 assert not has_function_privilege('anon','learn_phone_complete_import(uuid,uuid,uuid,uuid,text,text,integer,integer,jsonb)','execute');
 assert not has_table_privilege('authenticated','learn_phone_import_completions','select,insert,update,delete');
 assert not has_table_privilege('service_role','learn_phone_import_completions','insert,update,delete,truncate');
 begin update learn_phone_import_completions set receipt='{}';raise exception 'Receipt overwritten';exception when sqlstate '55000' then null;end;
 begin truncate learn_phone_import_completions;raise exception 'Receipts truncated';exception when sqlstate '55000' then null;end;
end$$;
select 'PASS: window/filter/tenant/page scope validation, empty window, failed run and private immutable authority';

insert into phone_sync_runs(id,tenant_id,sync_type,metadata) values(fixture_id(200),fixture_id(1),'recordings',
 '{"from":"2026-10-10T00:00:00.000Z","to":"2026-10-10T01:00:00.000Z"}');
set role service_role;
do $$declare a jsonb;begin
 perform fixture_page(200,'recordings',1,'one');
 a:=learn_phone_complete_import(fixture_id(1),fixture_id(200),fixture_id(4),fixture_id(3),'3950','recordings',1,1,
  '{"from":"2026-10-10T00:00:00.000Z","to":"2026-10-10T01:00:00.000Z","customer_id":"3950","pages_fetched":1,"skipped_no_recording_id":0,"window_complete":true}');
 assert a->>'kind'='recordings';assert a->>'recordsProcessed'='1';
end$$;
reset role;
do $$begin
 assert(select status='success' from phone_sync_runs where id=fixture_id(200));
 assert(select storage_path='retained-original.wav' from phone_recordings where provider_recording_id='one');
end$$;
select 'PASS: recording import completion retains previously stored audio';
