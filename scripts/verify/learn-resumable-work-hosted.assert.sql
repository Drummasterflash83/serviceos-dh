-- No user creation or retained fixtures. Use within a savepoint/rollback transaction.
do $probe$declare role_name text;fn record;privilege_name text;denied boolean;n bigint;t uuid:=gen_random_uuid();begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  for fn in select p.oid,p.proname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and (p.proname like 'learn_work_collection_%' or p.proname='learn_work_frozen_owner') loop
   if has_function_privilege(role_name,fn.oid,'EXECUTE') is distinct from (role_name='authenticated' and fn.proname in
    ('learn_work_collection_begin','learn_work_collection_step','learn_work_collection_status','learn_work_collection_abandon','learn_work_collection_evidence')) then
    raise exception 'Resumable collection function privilege differs';end if;
  end loop;
  foreach privilege_name in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
   if has_table_privilege(role_name,'public.learn_work_collection_runs',privilege_name)
    or has_table_privilege(role_name,'public.learn_work_collection_items',privilege_name) then
    raise exception 'Direct collection evidence write allowed';end if;
  end loop;
  perform set_config('request.jwt.claim.role',role_name,true);perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
  execute 'set local role '||quote_ident(role_name);
  denied:=false;begin perform learn_work_collection_begin(t,'residence',t,t,1,now()-interval '2 days',now()-interval '1 day',t,'Access probe');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unauthenticated collection start admitted';end if;
  denied:=false;begin perform learn_work_collection_step(t,t,0);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unauthenticated collection step admitted';end if;
  denied:=false;begin perform learn_work_collection_status(t,t);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unauthenticated collection status admitted';end if;
  denied:=false;begin perform learn_work_collection_abandon(t,'residence',t,t,1,now()-interval '2 days',now()-interval '1 day',t,'Access probe','Access probe');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unauthenticated collection abandonment admitted';end if;
  denied:=false;begin perform learn_work_collection_evidence(t,t,'overview');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unauthenticated calculation evidence admitted';end if;
  denied:=false;begin select count(*) into n from learn_work_collection_runs;exception when insufficient_privilege then denied:=true;end;
  if role_name='authenticated' then if denied or n<>0 then raise exception 'Unauthenticated run rows visible';end if;
  elsif not denied then raise exception 'Unprivileged run read admitted';end if;
  denied:=false;begin select count(*) into n from learn_work_collection_items;exception when insufficient_privilege then denied:=true;end;
  if role_name='authenticated' then if denied or n<>0 then raise exception 'Unauthenticated item rows visible';end if;
  elsif not denied then raise exception 'Unprivileged item read admitted';end if;
  execute 'reset role';
 end loop;
end $probe$;
