set request.jwt.claim.role='service_role';
do $$declare result jsonb; expected jsonb:=fixture_expected(); original jsonb; k text;begin
  -- No browser/public access to secrets, permits or fingerprints.
  if has_function_privilege('authenticated','public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)','execute')
    or has_function_privilege('anon','public.learn_commusoft_defer_page(uuid,uuid,text,integer,uuid,timestamptz)','execute')
    or has_table_privilege('authenticated','public.learn_business_input_request_permits','select')
    or has_table_privilege('service_role','public.learn_business_input_request_gates','update') then raise exception 'unsafe grants';end if;
  perform set_config('request.jwt.claim.role','authenticated',true);
  begin perform fixture_acquire();raise exception 'expected role denial';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claim.role','service_role',true);
  foreach k in array array['accountId','connectorId','connectionId','secretId','tenantId','jobId'] loop
    if fixture_acquire(jsonb_set(expected,array[k],to_jsonb(fixture_id(99)::text))) is not null then raise exception 'scope substitution accepted: %',k;end if;
  end loop;
  if fixture_acquire(jsonb_set(expected,'{request,region}','"us"')) is not null then raise exception 'region substitution accepted';end if;
  if fixture_acquire(jsonb_set(expected,'{checkpoint}','{"after":99}')) is not null then raise exception 'cursor substitution accepted';end if;
  if fixture_acquire(jsonb_set(expected,'{connectionRevision}','"2000-01-01T00:00:00Z"')) is not null then raise exception 'stale revision accepted';end if;
  update tenants set status='suspended';
  if fixture_acquire(expected) is not null then raise exception 'suspension bypass';end if;
  update tenants set status='active';
  foreach k in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
    update feature_flags set value='false' where flag=k;
    if fixture_acquire(expected) is not null then raise exception 'flag bypass';end if;
    update feature_flags set value='true' where flag=k;
  end loop;
  update tenant_connectors set enabled=false;
  if fixture_acquire(expected) is not null then raise exception 'connector bypass';end if;
  update tenant_connectors set enabled=true;
  update platform_jobs set claimed_by='other-worker';
  if fixture_acquire(expected) is not null then raise exception 'claim bypass';end if;
  update platform_jobs set claimed_by='fixture-worker',lease_expires_at=clock_timestamp()-interval '1 second';
  if fixture_acquire(expected) is not null then raise exception 'expired lease bypass';end if;
  update platform_jobs set lease_expires_at=clock_timestamp()+interval '1 hour';
  update provider_connections set revoked_at=clock_timestamp();
  if fixture_acquire(expected) is not null then raise exception 'revocation bypass';end if;
  update provider_connections set revoked_at=null;
  update vault.decrypted_secrets set name='foreign-name';
  if fixture_acquire(expected) is not null then raise exception 'foreign Vault name bypass';end if;
  update vault.decrypted_secrets set name='provider_secret:'||fixture_id(1)||':commusoft:api_key';
  if exists(select 1 from learn_business_input_request_permits) then raise exception 'denial allocated permit';end if;
end $$;
-- Exercise actual SQL service role privileges, not merely auth.role metadata.
set role service_role;
do $$declare result jsonb;begin
  result:=fixture_acquire();
  if result->>'state' is distinct from 'ready' or result->>'apiKey' is distinct from 'synthetic-commusoft-test-only'
    or (result->>'permitId')::uuid is null
    or (result->>'sendBefore')::bigint<=extract(epoch from clock_timestamp())*1000
    or (result->>'sendBefore')::bigint>extract(epoch from clock_timestamp()+interval '5 seconds')*1000 then raise exception 'valid permit failed';end if;
  if fixture_acquire() is not null then raise exception 'duplicate acquisition accepted';end if;
  if public.learn_commusoft_defer_page(fixture_id(99),fixture_id(2),'fixture-worker',1,(result->>'permitId')::uuid,clock_timestamp()+interval '1 hour') then raise exception 'foreign deferral accepted';end if;
  if not public.learn_commusoft_defer_page(fixture_id(1),fixture_id(2),'fixture-worker',1,(result->>'permitId')::uuid,clock_timestamp()+interval '1 hour') then raise exception 'deferral failed';end if;
end $$;
reset role;
do $$declare result jsonb; prior timestamptz; permit uuid;begin
  if exists(select 1 from learn_business_input_request_permits where binding->'approval' is distinct from fixture_expected()->'approval'
    or binding->'checkpoint' is distinct from '{}'::jsonb or binding->'request' is distinct from fixture_expected()->'request'
    or binding ? 'apiKey') then raise exception 'permit binding not retained correctly';end if;
  insert into platform_jobs select fixture_id(12),tenant_id,job_type,status,payload,claimed_by,attempt_count,lease_expires_at from platform_jobs where id=fixture_id(2);
  result:=fixture_acquire(fixture_expected(fixture_id(12)),fixture_id(12));
  if result->>'state' is distinct from 'wait' or result ? 'apiKey' or result ? 'permitId'
    or (result->>'retryAt')::bigint<=extract(epoch from clock_timestamp())*1000 then raise exception 'shared gate failed';end if;
  select next_allowed_at into prior from learn_business_input_request_gates;
  select id into permit from learn_business_input_request_permits;
  update provider_connections set revoked_at=clock_timestamp();
  if not learn_commusoft_defer_page(fixture_id(1),fixture_id(2),'fixture-worker',1,permit,clock_timestamp()) then raise exception 'late deferral failed';end if;
  if (select next_allowed_at from learn_business_input_request_gates) is distinct from prior then raise exception 'gate moved backwards';end if;
  update provider_connections set revoked_at=null;
  -- A second tenant storing the same provider key receives the same quota gate.
  insert into tenants values(fixture_id(21),'active');
  insert into feature_flags select fixture_id(case when flag='learn.enabled' then 30 else 31 end),fixture_id(21),flag,value from feature_flags;
  insert into tenant_connectors values(fixture_id(24),fixture_id(21),'commusoft','commusoft',true,'active');
  insert into connector_accounts select fixture_id(23),fixture_id(21),fixture_id(24),account_key,status,
    jsonb_set(settings,'{commusoft_import,connectionId}',to_jsonb(fixture_id(25)::text)),sync_cursor from connector_accounts;
  insert into provider_connections select fixture_id(25),fixture_id(21),provider,status,auth_mode,revoked_at,verified_at,updated_at,non_secret_config,configured_fields,
    jsonb_build_object('api_key',fixture_id(27)) from provider_connections;
  insert into vault.decrypted_secrets values(fixture_id(27),'provider_secret:'||fixture_id(21)||':commusoft:api_key','synthetic-commusoft-test-only');
  insert into platform_jobs values(fixture_id(22),fixture_id(21),'commusoft.source_sync','running',jsonb_build_object('connector_account_id',fixture_id(23)),'fixture-worker',1,clock_timestamp()+interval '1 hour');
  select jsonb_build_object('tenantId',a.tenant_id,'jobId',fixture_id(22),'accountId',a.id,'connectorId',a.tenant_connector_id,'connectionId',c.id,
    'connectionRevision',c.updated_at,'secretId',c.secret_refs->>'api_key','approval',a.settings->'commusoft_import','checkpoint',a.sync_cursor,
    'pages',0,'complete',false,'request',jsonb_build_object('region','uk','resource','properties','after',null,'limit',100)) into result
    from connector_accounts a join provider_connections c on c.tenant_id=a.tenant_id where a.tenant_id=fixture_id(21);
  result:=learn_commusoft_acquire_page(fixture_id(21),fixture_id(22),'fixture-worker',1,result);
  if result->>'state' is distinct from 'wait' or (select count(*) from learn_business_input_request_gates)<>1 then raise exception 'cross-tenant shared key quota failed';end if;
end $$;
-- Remove only the extra synthetic fixture to prepare a deterministic two-job race.
delete from platform_jobs where tenant_id=fixture_id(21);
delete from connector_accounts where tenant_id=fixture_id(21);
delete from provider_connections where tenant_id=fixture_id(21);
delete from learn_business_input_request_permits;
update learn_business_input_request_gates set next_allowed_at=clock_timestamp()-interval '1 second';
select 'permit authority, grants, quota and deferral assertions passed' as result;
