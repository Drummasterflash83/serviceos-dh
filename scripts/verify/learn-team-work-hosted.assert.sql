-- Run inside the release savepoint. No identities, source fixtures or provider calls.
do $probe$ declare role_name text; privilege_name text; denied boolean; n bigint;
 signature text:='public.learn_team_work_residence_collect(uuid,uuid,uuid,integer,timestamp with time zone,timestamp with time zone,uuid,text)';
 t uuid:=gen_random_uuid();begin
 if not exists(select 1 from pg_class where oid='public.learn_team_work_measurement_runs'::regclass and relrowsecurity) then raise exception 'Team ledger RLS missing';end if;
 if (select count(*) from pg_trigger where tgrelid='public.learn_team_work_measurement_runs'::regclass and not tgisinternal and tgenabled='O')<>2 then raise exception 'Team ledger immutable guards missing';end if;
 if exists(select 1 from public.learn_team_work_measurement_runs) then raise exception 'New team ledger must be empty';end if;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_function_privilege(role_name,signature,'execute') is distinct from (role_name='authenticated') then raise exception 'Team collector execute boundary changed';end if;
  foreach privilege_name in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
   if has_table_privilege(role_name,'public.learn_team_work_measurement_runs',privilege_name) then raise exception 'Team ledger write permission admitted';end if;
  end loop;
  if has_table_privilege(role_name,'public.learn_team_work_measurement_runs','SELECT') is distinct from (role_name='authenticated') then raise exception 'Team ledger read boundary changed';end if;
  perform set_config('request.jwt.claim.role',role_name,true);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  execute 'set local role '||quote_ident(role_name);
  denied:=false;
  begin perform public.learn_team_work_residence_collect(t,t,t,1,now()-interval '1 day',now()-interval '1 hour',t,'Hosted boundary check');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unauthenticated team collection admitted';end if;
  denied:=false;
  begin select count(*) into n from public.learn_team_work_measurement_runs;exception when insufficient_privilege then denied:=true;end;
  if role_name='authenticated' then
   if denied or n<>0 then raise exception 'Unauthenticated team evidence visible';end if;
  elsif not denied then raise exception 'Unprivileged team ledger read admitted';end if;
  execute 'reset role';
 end loop;
end $probe$;
