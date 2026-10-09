insert into tenants values('00000000-0000-4000-8000-000000000010');
insert into profiles values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000010','owner'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000010','viewer');
insert into provider_connections(id,tenant_id,provider,status,non_secret_config,configured_fields,secret_refs)
 values('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','slack','configured','{"team_id":"TSETUP"}',array['bot_token'],'{"bot_token":"00000000-0000-4000-8000-000000000021"}');
set role authenticated;
select set_config('test.actor','00000000-0000-4000-8000-000000000011',false);
do $$
declare
 t uuid:='00000000-0000-4000-8000-000000000010';
 c uuid:='00000000-0000-4000-8000-000000000020';
 request uuid:='00000000-0000-4000-8000-000000000030';
 result jsonb;
 again jsonb;
 errors integer:=0;
begin
 result:=learn_slack_start_import(t,request,c,'2026-10-09T10:00:00Z','CSETUP','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z',3,'Initial import');
 again:=learn_slack_start_import(t,request,c,'2026-10-09T10:00:00Z','CSETUP','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z',3,'Initial import');
 if result->>'jobId'<>again->>'jobId' or again->'reused'<>'true'::jsonb then raise exception 'Retry created another import';end if;
 begin perform learn_slack_start_import(t,request,c,'2026-10-09T10:00:00Z','COTHER','2026-01-01','2026-01-02',3,'Initial import');exception when serialization_failure then errors:=errors+1;end;
 begin perform learn_slack_start_import(t,gen_random_uuid(),c,'2026-10-09T10:00:00Z','CSETUP','2026-01-02','2026-01-03',3,'Next import');exception when sqlstate '55000' then errors:=errors+1;end;
 begin perform learn_slack_start_import(t,gen_random_uuid(),c,'2026-10-09T11:00:00Z','COTHER','2026-01-01','2026-01-02',3,'Stale connection');exception when serialization_failure then errors:=errors+1;end;
 begin perform learn_slack_start_import(t,gen_random_uuid(),c,'2026-10-09T10:00:00Z','COTHER','2026-01-01','2026-01-03',3,'Too wide');exception when invalid_parameter_value then errors:=errors+1;end;
 begin perform learn_slack_start_import('00000000-0000-4000-8000-000000000099',gen_random_uuid(),c,'2026-10-09T10:00:00Z','COTHER','2026-01-01','2026-01-02',3,'Other tenant');exception when insufficient_privilege then errors:=errors+1;end;
 perform set_config('test.actor','00000000-0000-4000-8000-000000000012',false);
 begin perform learn_slack_start_import(t,gen_random_uuid(),c,'2026-10-09T10:00:00Z','COTHER','2026-01-01','2026-01-02',3,'Viewer');exception when insufficient_privilege then errors:=errors+1;end;
 if errors<>6 then raise exception 'Setup authorization, retry or validation guard failed';end if;
end $$;
reset role;
-- A missing role must fail closed; preview grants no mutation authority.
update profiles set role=null where id='00000000-0000-4000-8000-000000000012';
set role authenticated;
select set_config('test.actor','00000000-0000-4000-8000-000000000012',false);
do $$ declare denied boolean:=false;begin
 begin perform learn_slack_start_import('00000000-0000-4000-8000-000000000010',gen_random_uuid(),'00000000-0000-4000-8000-000000000020','2026-10-09T10:00:00Z','COTHER','2026-01-01','2026-01-02',3,'Missing role');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Missing role granted authority';end if;
end $$;
reset role;
insert into view_as_context values('00000000-0000-4000-8000-000000000011',null,null);
set role authenticated;
select set_config('test.actor','00000000-0000-4000-8000-000000000011',false);
do $$ declare denied boolean:=false;begin
 begin perform learn_slack_start_import('00000000-0000-4000-8000-000000000010',gen_random_uuid(),'00000000-0000-4000-8000-000000000020','2026-10-09T10:00:00Z','COTHER','2026-01-01','2026-01-02',3,'Preview');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Preview granted authority';end if;
end $$;
reset role;
update view_as_context set ended_at=now();
do $$ begin
 if (select count(*) from slack_history_imports)<>1 or (select count(*) from platform_jobs where tenant_id='00000000-0000-4000-8000-000000000010')<>1 then raise exception 'Failed request wrote rows';end if;
 if (select sync_cursor from connector_accounts where tenant_id='00000000-0000-4000-8000-000000000010')<>'{}'::jsonb then raise exception 'Canonical worker checkpoint not initialised';end if;
end $$;
-- A terminal job alone cannot erase incomplete source progress.
update platform_jobs set status='succeeded' where tenant_id='00000000-0000-4000-8000-000000000010';
set role authenticated;
select set_config('test.actor','00000000-0000-4000-8000-000000000011',false);
do $$ declare denied boolean:=false;begin
 begin perform learn_slack_start_import('00000000-0000-4000-8000-000000000010',gen_random_uuid(),'00000000-0000-4000-8000-000000000020','2026-10-09T10:00:00Z','CSETUP','2026-01-02','2026-01-03',3,'Incomplete predecessor');exception when sqlstate '55000' then denied:=true;end;
 if not denied then raise exception 'Incomplete cursor overwritten';end if;
end $$;
reset role;
update connector_accounts set sync_cursor='{"pages":1,"cursor":null,"complete":true}' where tenant_id='00000000-0000-4000-8000-000000000010';
set role authenticated;
select learn_slack_start_import('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000020','2026-10-09T10:00:00Z','CSETUP','2026-01-02','2026-01-03',3,'Next completed window');
reset role;
do $$ begin
 if (select count(*) from slack_history_imports)<>2 or not exists(select 1 from slack_history_imports where previous_state->'checkpoint'->'complete'='true'::jsonb) then raise exception 'Previous approval/checkpoint not retained';end if;
 if has_table_privilege('authenticated','slack_history_imports','insert') or has_function_privilege('anon','learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text)','execute') then raise exception 'Unexpected setup grant';end if;
end $$;
select 'PASS: owner scope, atomic approval/enqueue, idempotent retry, no checkpoint overwrite and retained previous scope' as result;
