-- TEST metadata/denials/idle scheduler only. No identities or approvals created.
begin;
set local statement_timeout='15s';
set local search_path=public,pg_catalog;
do $$declare t text;begin
 if exists(select 1 from slack_recurring_channels) or exists(select 1 from slack_recurring_requests)
 or exists(select 1 from slack_recurring_thread_windows) or exists(select 1 from slack_recurring_thread_members) then raise exception 'Empty recurring TEST state required';end if;
 if has_function_privilege('anon','learn_slack_recurring_threads_control(uuid,uuid,uuid,bigint,boolean,text,text,uuid)','execute')
 or has_function_privilege('authenticated','learn_slack_recurring_thread_allowed(uuid,uuid)','execute')
 or has_function_privilege('authenticated','learn_slack_schedule_recurring(integer)','execute') then raise exception 'Unexpected public thread authority';end if;
 foreach t in array array['slack_recurring_thread_windows','slack_recurring_thread_members'] loop
  if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass)
  or has_table_privilege('authenticated','public.'||t,'select,insert,update,delete')
  or has_table_privilege('service_role','public.'||t,'insert,update,delete,truncate') then raise exception 'Unexpected thread table privileges';end if;
 end loop;
end $$;
set local request.jwt.claims='{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000099"}';
set local role authenticated;
do $$declare denied boolean;m text;begin
 foreach m in array array['apply','check','cancel'] loop
  denied:=false;
  begin perform learn_slack_recurring_threads_control('00000000-0000-4000-8000-000000000098','00000000-0000-4000-8000-000000000097','00000000-0000-4000-8000-000000000096',1,true,'Synthetic denied check',m);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unassigned identity used thread control';end if;
 end loop;
end $$;
reset role;
set local request.jwt.claims='{"role":"service_role"}';
set local role service_role;
do $$begin
 if learn_slack_recurring_thread_allowed('00000000-0000-4000-8000-000000000098','00000000-0000-4000-8000-000000000096') then raise exception 'Missing import passed recurring gate';end if;
 if learn_slack_schedule_recurring(10) <> '{"checked":0,"queued":0,"held":0}'::jsonb then raise exception 'Unexpected initial scheduler work';end if;
end $$;
reset role;
select 'learn-slack-auto-threads-hosted/1' as marker,true as role_denials,true as private_tables,true as empty_scheduler,true as no_activation;
rollback;
