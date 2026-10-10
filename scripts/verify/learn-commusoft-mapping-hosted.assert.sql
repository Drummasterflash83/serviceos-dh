-- The deployment does not grant an identity. Verify actual anonymous/no-subject
-- refusal and unchanged execution grants; positive tenant-owner cases run locally.
do $probe$ declare role_name text;denied boolean;t uuid:=gen_random_uuid();v uuid:=gen_random_uuid();begin
 foreach role_name in array array['anon','authenticated'] loop
  perform set_config('request.jwt.claim.role',role_name,true);
  perform set_config('request.jwt.claim.sub','',true);
  execute 'set local role '||quote_ident(role_name);
  denied:=false;
  begin perform public.learn_commusoft_customer_candidates(t,v,'person');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unauthenticated candidate access accepted';end if;
  denied:=false;
  begin perform public.learn_commusoft_confirm_work_record(t,v,null,'No identity must be denied');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unauthenticated projection accepted';end if;
  execute 'reset role';
 end loop;
end $probe$;
