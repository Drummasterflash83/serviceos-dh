insert into tenants(id) values(fixture_id(1)),(fixture_id(2));
insert into tenant_connectors(id,tenant_id,connector_id,provider,category,status,enabled)
 values(fixture_id(3),fixture_id(1),'simwood','simwood','communications','active',true);
insert into connector_accounts(id,tenant_id,tenant_connector_id,account_key,status)
 values(fixture_id(4),fixture_id(1),fixture_id(3),'3950','active');
insert into phone_sync_runs(id,tenant_id,sync_type) select fixture_id(n),fixture_id(1),case when n in(11,12,21,22) then 'recordings' else 'calls' end from generate_series(10,30)n;
create function fixture_rows(kind text,key text default 'one') returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('tenant_id',fixture_id(1),'provider','simwood',
  case when kind='calls' then 'provider_call_id' else 'provider_recording_id' end,key,'raw_payload',jsonb_build_object('synthetic',true)));$$;
create function fixture_page(run integer,kind text,page integer default 1,key text default 'one') returns jsonb language sql as $$
 select learn_phone_publish_page(fixture_id(1),fixture_id(run),fixture_id(4),fixture_id(3),'3950',kind,page,fixture_rows(kind,key));$$;
set role service_role;
do $$declare a jsonb;b jsonb;begin
 a:=fixture_page(10,'calls');b:=fixture_page(10,'calls');assert a=b;assert a->>'recordsProcessed'='1';
 assert a->'newRecordingIds'='[]';
 begin perform fixture_page(10,'calls',1,'changed');raise exception 'Changed replay accepted';exception when sqlstate 'PT409' then null;end;
 begin perform fixture_page(13,'calls',2);raise exception 'Skipped page accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_phone_publish_page(fixture_id(2),fixture_id(10),fixture_id(4),fixture_id(3),'3950','calls',1,'[]');raise exception 'Cross tenant accepted';exception when sqlstate 'PT409' then null;end;
 a:=fixture_page(11,'recordings');assert jsonb_array_length(a->'newRecordingIds')=1;
end$$;
reset role;
do $$begin assert(select count(*) from phone_calls)=1;assert(select count(*) from learn_phone_capture_pages)=2;end$$;
select 'PASS: atomic page receipts, exact replay, changed replay, sequence and tenant checks';
update phone_recordings set storage_path='retained-original.wav';
set role service_role;
do $$declare a jsonb;begin a:=fixture_page(12,'recordings');assert a->'newRecordingIds'='[]';end$$;
reset role;
do $$begin assert(select count(*) from phone_recordings)=1;assert(select storage_path from phone_recordings)='retained-original.wav';end$$;
select 'PASS: existing recording metadata update preserves audio and is not new work';
insert into feature_flags values(fixture_id(1),'learn.inputs.phone.enabled','false');
set role service_role;
do $$begin
 begin perform fixture_page(10,'calls',2,'paused');raise exception 'Paused page accepted';exception when sqlstate 'PT409' then assert SQLERRM='learn_capture_paused';end;
 assert fixture_page(10,'calls')->>'recordsProcessed'='1';
end$$;
reset role;
update feature_flags set value='true';
update tenant_connectors set enabled=false;
set role service_role;
do $$begin begin perform fixture_page(13,'calls');raise exception 'Disabled connector accepted';exception when sqlstate 'PT409' then assert SQLERRM='phone_account_unavailable';end;end$$;
reset role;
update tenant_connectors set enabled=true;
update connector_accounts set settings='{"provider_customer_id":"8000"}';
set role service_role;
do $$begin begin perform fixture_page(13,'calls');raise exception 'Rebound account accepted';exception when sqlstate 'PT409' then assert SQLERRM='phone_account_unavailable';end;end$$;
reset role;update connector_accounts set settings='{}';
select 'PASS: paused capture and changed account denied; retained receipt still settles';
create function fixture_fail_receipt() returns trigger language plpgsql as $$begin raise exception 'receipt_failure' using errcode='P0002';end$$;
create trigger fixture_receipt_failure before insert on learn_phone_capture_pages for each row execute function fixture_fail_receipt();
set role service_role;
do $$begin begin perform fixture_page(13,'calls',1,'rollback');raise exception 'Missing atomic failure';exception when sqlstate 'P0002' then null;end;end$$;
reset role;drop trigger fixture_receipt_failure on learn_phone_capture_pages;
do $$begin assert not exists(select 1 from phone_calls where provider_call_id='rollback');assert not exists(select 1 from learn_phone_capture_pages where run_id=fixture_id(13));end$$;
select 'PASS: receipt failure rolls back all page writes';
set role service_role;
do $$declare rows jsonb;begin
 rows:=fixture_rows('calls')||fixture_rows('calls');
 begin perform learn_phone_publish_page(fixture_id(1),fixture_id(13),fixture_id(4),fixture_id(3),'3950','calls',1,rows);raise exception 'Duplicate source IDs accepted';exception when invalid_parameter_value then null;end;
 rows:=jsonb_set(fixture_rows('recordings'),'{0,storage_path}','"replace-original.wav"');
 begin perform learn_phone_publish_page(fixture_id(1),fixture_id(13),fixture_id(4),fixture_id(3),'3950','recordings',1,rows);raise exception 'Storage mutation accepted';exception when invalid_parameter_value then null;end;
 select jsonb_agg(fixture_rows('calls',n::text)->0) into rows from generate_series(1,201)n;
 begin perform learn_phone_publish_page(fixture_id(1),fixture_id(13),fixture_id(4),fixture_id(3),'3950','calls',1,rows);raise exception 'Oversize page accepted';exception when invalid_parameter_value then null;end;
end$$;
reset role;
do $$begin
 assert not has_function_privilege('authenticated','learn_phone_publish_page(uuid,uuid,uuid,uuid,text,text,integer,jsonb)','execute');
 assert not has_function_privilege('anon','learn_phone_publish_page(uuid,uuid,uuid,uuid,text,text,integer,jsonb)','execute');
 assert not has_table_privilege('authenticated','learn_phone_capture_pages','select,insert,update,delete');
 assert not has_table_privilege('service_role','learn_phone_capture_pages','insert,update,delete,truncate');
 begin update learn_phone_capture_pages set receipt='{}';raise exception 'Receipt overwritten';exception when sqlstate '55000' then null;end;
 begin truncate learn_phone_capture_pages;raise exception 'Receipts truncated';exception when sqlstate '55000' then null;end;
end$$;
select 'PASS: bounded validation, private authority, retained receipts and storage-pointer protection';
