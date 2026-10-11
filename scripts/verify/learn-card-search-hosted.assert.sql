-- Exact hosted role boundary, rolled back to its surrounding savepoint.
-- No identities, fixtures, source writes or provider requests.
do $probe$declare role_name text;kind text;denied boolean;t uuid:=gen_random_uuid();begin
 if not exists(select 1 from pg_proc where oid='public.learn_card_search(uuid,text,text,integer,uuid)'::regprocedure and not prosecdef and provolatile='s') then
  raise exception 'Stable caller-permission search required';end if;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_function_privilege(role_name,'public.learn_card_search(uuid,text,text,integer,uuid)','execute') is distinct from (role_name='authenticated') then
   raise exception 'Card search execute boundary differs';end if;
  perform set_config('request.jwt.claim.role',role_name,true);
  perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
  execute 'set local role '||quote_ident(role_name);
  foreach kind in array array['customer','job','member','team'] loop
   denied:=false;
   begin perform public.learn_card_search(t,kind,'Synthetic access probe',0,null);exception when insufficient_privilege then denied:=true;end;
   if not denied then raise exception 'Unauthenticated card search admitted';end if;
  end loop;
  execute 'reset role';
 end loop;
end $probe$;
