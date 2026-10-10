-- Date contract and real database-role denials; no users or retained source fixtures.
do $probe$ declare role_name text;denied boolean;t uuid:=gen_random_uuid();c uuid:=gen_random_uuid();v uuid:=gen_random_uuid();begin
 assert public.learn_business_input_time_detail('"2026-01-02 01:00:00"')->>'state'='timezone_required';
 assert public.learn_business_input_time_detail('"2026-01-02 01:00:00"')->'instant'='null'::jsonb;
 assert public.learn_business_input_time_detail('"2026-01-02T01:00:00.000001+01:00"')->>'instant'='2026-01-02T00:00:00.000001Z';
 assert public.learn_business_input_time_detail('"2026-02-30 01:00:00"')->>'state'='invalid';
 assert public.learn_business_input_time_detail('{}')->>'state'='invalid';
 assert public.learn_business_input_time_detail('null')->>'state'='absent';
 foreach role_name in array array['anon','authenticated','service_role'] loop
  assert not has_function_privilege(role_name,'public.learn_business_input_time_detail(jsonb)','execute');
  perform set_config('request.jwt.claim.role',role_name,true);
  perform set_config('request.jwt.claim.sub','',true);
  execute 'set local role '||quote_ident(role_name);
  denied:=false;
  begin perform public.learn_commusoft_job_details(t,c,v);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unauthenticated job detail admitted';end if;
  execute 'reset role';
 end loop;
 assert has_function_privilege('authenticated','public.learn_commusoft_job_details(uuid,uuid,uuid)','execute');
 assert not has_function_privilege('anon','public.learn_commusoft_job_details(uuid,uuid,uuid)','execute');
 assert not has_function_privilege('service_role','public.learn_commusoft_job_details(uuid,uuid,uuid)','execute');
end $probe$;
