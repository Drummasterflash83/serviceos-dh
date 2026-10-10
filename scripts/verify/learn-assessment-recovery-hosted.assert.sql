-- Actual application-role denial. No user, tenant, grant or source fixture is created.
do $probe$ declare role_name text; denied boolean; t uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); definition text; begin
 if not (select relrowsecurity from pg_class where oid='public.learn_assessment_cancellations'::regclass) then raise exception 'Cancellation RLS absent';end if;
 if exists(select 1 from public.learn_assessment_cancellations) then raise exception 'Unexpected cancellation rows';end if;
 definition:=pg_get_functiondef('public.learn_assessment_save(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text)'::regprocedure);
 if position('learn_assessment_cancellations' in definition)=0 or position('pg_advisory_xact_lock' in definition)=0 then raise exception 'Save cancellation guard absent';end if;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_table_privilege(role_name,'public.learn_assessment_cancellations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then raise exception 'Raw cancellation authority admitted';end if;
  if role_name<>'authenticated' and has_function_privilege(role_name,'public.learn_assessment_resolve(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text,boolean)','execute') then raise exception 'Unexpected recovery RPC authority';end if;
  perform set_config('request.jwt.claim.role',role_name,true);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  execute 'set local role '||quote_ident(role_name);
  denied:=false;
  begin perform public.learn_assessment_resolve(t,r,r,'member',r,null,'2026-01-01','2026-01-02','[]','Synthetic denied check',true);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unauthenticated assessment recovery admitted';end if;
  execute 'reset role';
 end loop;
 if not has_function_privilege('authenticated','public.learn_assessment_resolve(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text,boolean)','execute') then raise exception 'Owner recovery entrypoint absent';end if;
end $probe$;
