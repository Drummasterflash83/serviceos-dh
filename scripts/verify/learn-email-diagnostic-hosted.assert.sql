-- Rollback probe: existing functions only, no identities, grants or provider work.
do $probe$declare code text;role_name text;denied boolean;evidence jsonb;begin
 evidence:=jsonb_build_object('persistence','confirmed','message_upsert_count',0,'thread_upsert_count',0,'ids_seen',0,'gone_count',0,'unresolved_count',1,'classification','source_ineligible','coverage_complete',false);
 foreach code in array array['sa_config_missing','sa_credentials_invalid','admin_delegation_missing','scopes_missing','delegation_grant_invalid','delegation_denied'] loop
  perform public.email_ingestion_payload_v2('block','recent',jsonb_build_object('error_code',code,'attempt_evidence',evidence));
  perform public.email_ingestion_payload_v2('finish_attempt','historical',jsonb_build_object('error_code',code,'attempt_evidence',evidence,'outcome','failed'));
 end loop;
 denied:=false;
 begin perform public.email_ingestion_payload_v2('block','recent',jsonb_build_object('error_code','PRIVATE_UNKNOWN_PROVIDER_RESPONSE','attempt_evidence',evidence));exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Unknown provider diagnostic accepted';end if;
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 foreach role_name in array array['anon','authenticated','service_role'] loop
  execute 'set local role '||quote_ident(role_name);
  denied:=false;
  begin perform public.learn_operator_capture_health(gen_random_uuid());exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Actorless operator read admitted';end if;
  if role_name<>'service_role' then
   denied:=false;
   begin perform public.learn_email_job_fail(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'diagnostic-probe',1);exception when insufficient_privilege then denied:=true;end;
   if not denied then raise exception 'Client failure settlement admitted';end if;
  end if;
  execute 'reset role';
 end loop;
end $probe$;
