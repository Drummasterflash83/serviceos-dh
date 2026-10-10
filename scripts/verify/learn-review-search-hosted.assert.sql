-- Pure matcher checks and actual role denial. No identity or source fixture retained.
do $probe$ declare role_name text;denied boolean;t uuid:=gen_random_uuid();c uuid:=gen_random_uuid();begin
 assert public.learn_commusoft_source_matches('{"description":"Boiler repair 100%"}','10','job','REPAIR');
 assert not public.learn_commusoft_source_matches('{"description":"Boiler repair"}','10','job','%repair%');
 assert public.learn_commusoft_source_matches('{"propertyID":321}','10','job','321');
 assert public.learn_commusoft_source_matches('{"contact":{"mobile":"07700900999"}}','10','customer','07700900999');
 assert public.learn_commusoft_source_matches(null,'10','job','10');
 assert not public.learn_commusoft_source_matches(null,'10','job','unknown');
 foreach role_name in array array['anon','authenticated','service_role'] loop
  assert not has_function_privilege(role_name,'public.learn_commusoft_source_matches(jsonb,text,text,text)','execute');
  perform set_config('request.jwt.claim.role',role_name,true);
  perform set_config('request.jwt.claim.sub','',true);
  execute 'set local role '||quote_ident(role_name);
  denied:=false;
  begin perform public.learn_commusoft_review_search(t,c,'retained');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unauthenticated customer search admitted';end if;
  denied:=false;
  begin perform public.learn_commusoft_work_review_search(t,c,'job','retained');exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unauthenticated work search admitted';end if;
  execute 'reset role';
 end loop;
 assert has_function_privilege('authenticated','public.learn_commusoft_review_search(uuid,uuid,text,text,integer)','execute');
 assert has_function_privilege('authenticated','public.learn_commusoft_work_review_search(uuid,uuid,text,text,text,integer)','execute');
end $probe$;
