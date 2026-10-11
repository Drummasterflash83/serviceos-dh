-- Executed inside a rollback savepoint. No identities, grants or retained source writes.
do $probe$declare r text;denied boolean;definition text;begin
 if exists(select 1 from public.learn_correction_cancellations) then raise exception 'New cancellation ledger must be empty';end if;
 if not exists(select 1 from pg_class where oid='public.learn_correction_cancellations'::regclass and relrowsecurity) then raise exception 'Cancellation RLS missing';end if;
 if exists(select 1 from pg_policies where schemaname='public' and tablename='learn_correction_cancellations') then raise exception 'Unexpected direct cancellation read policy';end if;
 foreach r in array array['anon','authenticated','service_role'] loop
  if has_table_privilege(r,'public.learn_correction_cancellations','select,insert,update,delete,truncate,references,trigger') then raise exception 'Cancellation ledger exposed';end if;
 end loop;
 if not has_function_privilege('authenticated','public.learn_performance_correction_resolve(uuid,uuid,uuid,integer,numeric,text,boolean)','execute')
 or has_function_privilege('anon','public.learn_performance_correction_resolve(uuid,uuid,uuid,integer,numeric,text,boolean)','execute')
 or has_function_privilege('service_role','public.learn_performance_correction_resolve(uuid,uuid,uuid,integer,numeric,text,boolean)','execute') then raise exception 'Correction resolution authority differs';end if;
 if not exists(select 1 from pg_proc where oid='public.learn_performance_correction_resolve(uuid,uuid,uuid,integer,numeric,text,boolean)'::regprocedure and prosecdef and proconfig=array['search_path=pg_catalog']) then raise exception 'Recovery execution boundary differs';end if;
 if (select count(*) from pg_trigger where tgrelid='public.learn_correction_cancellations'::regclass and not tgisinternal and tgenabled='O' and tgfoid='public.objectives_append_only()'::regprocedure and tgname in ('learn_correction_cancellations_immutable','learn_correction_cancellations_no_truncate'))<>2 then raise exception 'Immutable cancellation guards missing';end if;
 definition:=pg_get_functiondef('public.learn_performance_correct(uuid,uuid,uuid,integer,numeric,text)'::regprocedure);
 if position('if exists(select 1 from public.learn_correction_cancellations where id=p_request)' in definition)=0 then raise exception 'Correction cancellation check missing';end if;
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 foreach r in array array['anon','authenticated','service_role'] loop
  execute 'set local role '||quote_ident(r);denied:=false;
  begin perform public.learn_performance_correction_resolve(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),0,17,'Access check',false);exception when insufficient_privilege then denied:=true;end;
  execute 'reset role';
  if not denied then raise exception 'Missing actor recovered correction';end if;
 end loop;
end $probe$;
