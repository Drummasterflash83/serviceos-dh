-- Installed TEST schema checks. No identities or channel approvals are created.
begin;
set local statement_timeout='15s';
set local search_path=public,pg_catalog;
do $$begin
 if exists(select 1 from slack_recurring_channels) or exists(select 1 from slack_recurring_requests) then raise exception 'Empty initial recurring state required';end if;
 if has_function_privilege('anon','learn_slack_recurring_read(uuid,uuid)','execute') or has_function_privilege('authenticated','learn_slack_schedule_recurring(integer)','execute') then raise exception 'Unexpected public scheduler/status authority';end if;
end $$;
set local request.jwt.claims='{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000099"}';
set local role authenticated;
do $$declare denied boolean:=false;begin
 begin perform learn_slack_recurring_read('00000000-0000-4000-8000-000000000098');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Unassigned identity read recurring status';end if;
 denied:=false;
 begin perform learn_slack_recurring_control('00000000-0000-4000-8000-000000000098','00000000-0000-4000-8000-000000000097','00000000-0000-4000-8000-000000000096',0,true,'Synthetic denied check');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Unassigned identity changed recurring status';end if;
end $$;
reset role;
set local request.jwt.claims='{"role":"service_role"}';
set local role service_role;
do $$begin
 if learn_slack_schedule_recurring(10) <> '{"checked":0,"queued":0,"held":0}'::jsonb then raise exception 'Unexpected initial scheduler work';end if;
end $$;
reset role;
select 'learn-slack-recurring-hosted/1' as marker,true as role_denials,true as empty_scheduler,true as no_activation;
rollback;
