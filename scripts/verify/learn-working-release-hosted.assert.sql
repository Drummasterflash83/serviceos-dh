-- Run inside a savepoint; no users, grants, provider calls or retained fixtures.
do $probe$declare role_name text;fn record;table_name text;privilege_name text;denied boolean;n bigint;t uuid:=gen_random_uuid();statement text;begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  for fn in select p.oid,p.proname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and
   (p.proname like 'learn_work_calendar_%' or p.proname like 'learn_work_delay_%' or p.proname like 'learn_working_%') loop
   if has_function_privilege(role_name,fn.oid,'EXECUTE') is distinct from (role_name='authenticated' and fn.proname in
    ('learn_work_calendar_resolve','learn_work_calendar_save','learn_work_calendar_publish','learn_work_calendar_read','learn_work_calendar_preview',
     'learn_work_delay_record','learn_work_delay_resolve','learn_work_delay_read','learn_work_delay_evidence')) then
    raise exception 'Working-time function privilege differs';end if;
  end loop;
  foreach table_name in array array['learn_work_calendar_versions','learn_work_calendar_publications','learn_work_calendar_cancellations',
    'learn_work_delay_events','learn_work_delay_cancellations','learn_working_collection_runs','learn_working_collection_items'] loop
   if not exists(select 1 from pg_class where oid=('public.'||table_name)::regclass and relrowsecurity) then raise exception 'Working-time RLS missing';end if;
   foreach privilege_name in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege(role_name,'public.'||table_name,privilege_name) then raise exception 'Direct working-time write allowed';end if;
   end loop;
  end loop;
  perform set_config('request.jwt.claim.role',role_name,true);perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
  execute 'set local role '||quote_ident(role_name);
  foreach statement in array array[
   format('select learn_work_calendar_save(%L,0,''{}'',%L,''Access probe'')',t,t),
   format('select learn_work_calendar_publish(%L,%L,null,%L,''Access probe'')',t,t,t),
   format('select learn_work_calendar_read(%L)',t),
   format('select learn_work_calendar_preview(%L,%L,now()-interval ''2 days'',now()-interval ''1 day'')',t,t),
   format('select learn_work_calendar_resolve(%L,''save'',%L,''{}'',false)',t,t),
   format('select learn_work_delay_record(%L,%L,''{}'')',t,t),
   format('select learn_work_delay_resolve(%L,%L,''{}'',false)',t,t),
   format('select learn_work_delay_read(%L,%L,0,null)',t,t),
   format('select learn_work_delay_evidence(%L,%L,%L)',t,t,t),
   format('select learn_work_collection_begin(%L,''workingTime'',%L,%L,1,now()-interval ''2 days'',now()-interval ''1 day'',%L,''Access probe'')',t,t,t,t),
   format('select learn_work_collection_begin(%L,''teamWorkingTime'',%L,%L,1,now()-interval ''2 days'',now()-interval ''1 day'',%L,''Access probe'')',t,t,t,t),
   format('select learn_work_collection_evidence(%L,%L,''calendar'',0)',t,t),
   format('select learn_work_collection_evidence(%L,%L,''workingItem'',1)',t,t)
  ] loop
   denied:=false;begin execute statement;exception when insufficient_privilege then denied:=true;end;
   if not denied then raise exception 'Unauthenticated working-time RPC admitted';end if;
  end loop;
  foreach table_name in array array['learn_work_calendar_versions','learn_work_calendar_publications','learn_work_calendar_cancellations',
    'learn_work_delay_events','learn_work_delay_cancellations','learn_working_collection_runs','learn_working_collection_items'] loop
   denied:=false;begin execute format('select count(*) from public.%I',table_name) into n;exception when insufficient_privilege then denied:=true;end;
   if role_name='authenticated' then if denied or n<>0 then raise exception 'Unauthenticated working-time rows visible';end if;
   elsif not denied then raise exception 'Unprivileged working-time read admitted';end if;
  end loop;
  execute 'reset role';
 end loop;
end $probe$;
