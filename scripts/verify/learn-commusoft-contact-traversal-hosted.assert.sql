-- Caller-owned rollback probe. Synthetic tenant and service path only; no login,
-- operator grant, Vault secret or provider request. Does not prove operator setup.
do $probe$ declare
 t uuid:=gen_random_uuid();c uuid:=gen_random_uuid();tc uuid:=gen_random_uuid();a uuid:=gen_random_uuid();approval uuid:=gen_random_uuid();secret_id uuid:=gen_random_uuid();
 v1 uuid:=gen_random_uuid();v2 uuid:=gen_random_uuid();j public.platform_jobs%rowtype;pid uuid;b jsonb;cfg jsonb;cp jsonb;target jsonb;revision timestamptz;
 result jsonb;again jsonb;envelope jsonb;fingerprint text:=encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex');step integer;denied boolean;role_name text;
begin
 insert into public.tenants(id,slug,display_name,status,metadata) values(t,'contact-traversal-fixture-'||t,'Contact traversal rollback fixture','active','{"synthetic":true}');
 insert into public.feature_flags(tenant_id,flag,value) values(t,'learn.enabled','true'),(t,'learn.inputs.commusoft.enabled','true');
 insert into public.tenant_connectors(id,tenant_id,connector_id,provider,category,status,enabled) values(tc,t,'commusoft','commusoft','business_input','active',true);
 insert into public.provider_connections(id,tenant_id,provider,status,auth_mode,verified_at,non_secret_config,configured_fields,secret_refs)
  values(c,t,'commusoft','configured','private_api_key',clock_timestamp(),'{"region":"uk","account_key":"synthetic-contact-fixture"}',array['api_key'],jsonb_build_object('api_key',secret_id)) returning updated_at into revision;
 cfg:=jsonb_build_object('approved',true,'approvalId',approval,'connectionId',c,'consentReference','rollback fixture only','expiresAt',clock_timestamp()+interval '5 minutes',
  'maxPages',10002,'pageSize',1,'resource','propertyContacts','contactType','customer','contactPlanVersion',1,'contactTargetCount',2,'firstPropertyId',101);
 insert into public.connector_accounts(id,tenant_id,tenant_connector_id,account_key,status,settings,sync_cursor)
  values(a,t,tc,'synthetic-contact-fixture','active',jsonb_build_object('commusoft_import',cfg),'{}');
 insert into public.learn_business_input_versions(id,tenant_id,connection_id,provider,collection,external_id,content_hash,payload)
  values(v1,t,c,'commusoft','properties','101','synthetic-property-101','{"id":101,"type":"customer"}'),
        (v2,t,c,'commusoft','properties','202','synthetic-property-202','{"id":202,"type":"customer"}');
 insert into public.learn_commusoft_contact_targets values(t,c,approval,101,'customer',v1,1,202),(t,c,approval,202,'customer',v2,2,null);
 insert into public.learn_business_input_request_gates values(fingerprint,clock_timestamp());
 insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,max_attempts,payload)
  values(t,'commusoft','learn','commusoft.source_sync','commusoft.source:'||a||':'||approval,'queued',5,jsonb_build_object('connector_account_id',a));
 foreach role_name in array array['anon','authenticated'] loop
  execute 'set local role '||quote_ident(role_name);denied:=false;
  begin perform 1 from public.learn_commusoft_contact_targets;exception when insufficient_privilege then denied:=true;end;
  execute 'reset role';if not denied then raise exception 'Browser read private contact targets';end if;
 end loop;
 if has_function_privilege('service_role','public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text)','execute')
  or has_function_privilege('service_role','public.learn_commusoft_contact_target(uuid,uuid,jsonb,jsonb)','execute') then raise exception 'Operator/private authority broadened';end if;
 for step in 1..3 loop
  update public.platform_jobs set available_at=clock_timestamp()-interval '1 second' where tenant_id=t and status='queued';
  perform set_config('request.jwt.claim.role','service_role',true);execute 'set local role service_role';
  select * into j from public.learn_commusoft_claim_jobs(gen_random_uuid());
  execute 'reset role';
  if j.id is null or j.tenant_id<>t then raise exception 'Unexpected fixture claim';end if;
  select sync_cursor into cp from public.connector_accounts where id=a;
  target:=public.learn_commusoft_contact_target(t,c,cfg,cp);
  if target is null or (target->>'propertyId')::integer<>(case when step<3 then 101 else 202 end) then raise exception 'Wrong next property';end if;
  b:=jsonb_build_object('tenantId',t,'jobId',j.id,'accountId',a,'connectorId',tc,'connectionId',c,'connectionRevision',revision,'secretId',secret_id,'approval',cfg,'checkpoint',cp,
   'pages',coalesce(cp->'pages','0'::jsonb),'complete',false,'contactTarget',target,'request',jsonb_build_object('region','uk','resource','propertyContacts','contactType','customer','propertyId',target->'propertyId','after',cp->'after','limit',1));
  execute 'set local role service_role';
  if public.learn_commusoft_acquire_page(t,j.id,j.claimed_by,j.attempt_count,b) is not null then raise exception 'Absent Vault key acquired';end if;
  execute 'reset role';
  pid:=gen_random_uuid();
  insert into public.learn_business_input_request_permits(id,tenant_id,job_id,claimed_by,attempt_count,binding,credential_fingerprint)
   values(pid,t,j.id,j.claimed_by,j.attempt_count,b-'tenantId'-'jobId'-'pages'-'complete'-'contactTarget',fingerprint);
  execute 'set local role service_role';
  begin
   perform public.learn_commusoft_commit_page(t,j.id,j.claimed_by,j.attempt_count,pid,'{"data":[{"id":999,"propertyID":999}],"pagination":{"hasMore":false,"nextCursor":null}}');
   raise exception 'Foreign parent published';exception when invalid_parameter_value then
    if sqlerrm<>'commusoft_contact_parent_mismatch' then raise;end if;
  end;
  envelope:=case when step=1 then '{"data":[{"id":11,"propertyID":101,"firstName":"Synthetic"}],"pagination":{"hasMore":true,"nextCursor":11}}'::jsonb
   else '{"data":[],"pagination":{"hasMore":false,"nextCursor":null}}'::jsonb end;
  result:=public.learn_commusoft_commit_page(t,j.id,j.claimed_by,j.attempt_count,pid,envelope);
  again:=public.learn_commusoft_committed_page(t,j.id,j.claimed_by,j.attempt_count);
  if again is distinct from result||'{"already":true}'::jsonb then raise exception 'Source-free recovery differs';end if;
  again:=public.learn_commusoft_commit_page(t,j.id,j.claimed_by,j.attempt_count,pid,envelope);
  if again is distinct from result||'{"already":true}'::jsonb then raise exception 'Publication replay differs';end if;
  again:=public.learn_commusoft_finish_job(t,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
  execute 'reset role';
  if (again->'successor_id'='null'::jsonb) is distinct from (step=3) then raise exception 'Wrong successor/completion';end if;
  if step=2 and result->'checkpoint' is distinct from jsonb_build_object('approvalId',approval,'after',null,'pages',2,'complete',false,'propertyId',202,'propertiesCompleted',1) then raise exception 'Property boundary lost';end if;
 end loop;
 if result->'checkpoint' is distinct from jsonb_build_object('approvalId',approval,'after',null,'pages',3,'complete',true,'propertyId',null,'propertiesCompleted',2) then raise exception 'Plan completion differs';end if;
 if (select count(*) from public.learn_business_input_pages where tenant_id=t)<>3
  or (select count(*) from public.learn_business_input_versions where tenant_id=t and collection='propertyContacts')<>1 then raise exception 'Fixture source count differs';end if;
 begin update public.learn_commusoft_contact_targets set next_property_id=999 where tenant_id=t;raise exception 'Target plan changed';exception when insufficient_privilege then null;end;
 if public.learn_commusoft_contact_target(gen_random_uuid(),c,cfg,'{}') is not null then raise exception 'Foreign tenant plan resolved';end if;
 perform set_config('request.jwt.claim.role','',true);
end $probe$;
