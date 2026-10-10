-- Metadata and denial checks only; no accounts, grants, private estimate output or persistent mutations.
begin;
set local statement_timeout='15s';
set local search_path=public,pg_catalog;
do $$begin
 if has_function_privilege('anon','openfolk_build_investment()','execute')
 or has_function_privilege('anon','care_desk_operator()','execute')
 or not has_function_privilege('authenticated','openfolk_build_investment()','execute') then raise exception 'Unexpected private estimate execution privileges';end if;
 if exists(select 1 from pg_proc where oid in ('public.openfolk_build_investment()'::regprocedure,'public.care_desk_operator()'::regprocedure) and (not prosecdef or provolatile<>'s' or not ('search_path=""'=any(proconfig)))) then raise exception 'Unexpected private estimate function boundary';end if;
end $$;
set local request.jwt.claims='{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000099"}';
set local role authenticated;
do $$declare denied boolean:=false;begin
 if public.care_desk_operator() then raise exception 'Unassigned identity passed private operator gate';end if;
 begin perform public.openfolk_build_investment();exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Unassigned identity read private estimate';end if;
end $$;
reset role;
set local request.jwt.claims='{}';
set local role service_role;
do $$declare denied boolean:=false;begin
 begin perform public.openfolk_build_investment();exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'No-user service identity read private estimate';end if;
end $$;
reset role;
select 'learn-build-investment-hosted/1' as marker,true as unassigned_read_denied,true as service_without_user_denied,true as anon_execute_denied,true as functions_stable_and_search_path_fixed;
rollback;
