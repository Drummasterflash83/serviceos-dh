-- Disposable synthetic database only. No provider request or real person.
insert into public.platform_authority_grants(profile_id,permission,granted_by)
 values(public.fixture_id(180),'platform.controlplane.admin','synthetic');
insert into vault.decrypted_secrets values(public.fixture_id(107),
 'provider_secret:'||public.fixture_id(100)||':commusoft:api_key','SYNTHETIC_USERS_NO_NETWORK');
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';
set role authenticated;
do $$declare r jsonb;begin
 r:=public.learn_operator_input_request(public.fixture_id(100),public.fixture_id(289),
  public.fixture_id(180),public.fixture_definition('enable'));
 assert r->>'state'='recorded','Module setup failed';
 begin
  perform public.learn_operator_input_request(public.fixture_id(100),public.fixture_id(288),
   public.fixture_id(180),public.fixture_definition('start')||
    '{"resource":"users","max_pages":2,"page_size":10}'::jsonb);
  raise exception 'Unbounded users pages approved';
 exception when invalid_parameter_value then
  assert sqlerrm='learn_operator_import_invalid','Wrong users budget refusal';
 end;
 begin
  perform public.learn_operator_input_request(public.fixture_id(100),public.fixture_id(287),
   public.fixture_id(180),public.fixture_definition('start')||
    '{"resource":"users","max_pages":1,"page_size":11}'::jsonb);
  raise exception 'Unbounded users page size approved';
 exception when invalid_parameter_value then
  assert sqlerrm='learn_operator_import_invalid','Wrong users size refusal';
 end;
 begin
  perform public.learn_operator_input_request(public.fixture_id(100),public.fixture_id(286),
   public.fixture_id(180),public.fixture_definition('start')||
    '{"resource":"users","max_pages":1,"page_size":2}'::jsonb);
  raise exception 'Source users approved with absent release flag';
 exception when object_not_in_prerequisite_state then
  assert sqlerrm='learn_operator_module_disabled','Wrong users flag refusal';
 end;
end$$;
reset role;
insert into public.feature_flags(tenant_id,flag,value)
 values(public.fixture_id(100),'learn.inputs.commusoft.users.enabled','true'::jsonb);
set role authenticated;
do $$declare r jsonb;begin
 r:=public.learn_operator_input_request(public.fixture_id(100),public.fixture_id(290),
  public.fixture_id(180),public.fixture_definition('start')||
   '{"resource":"users","max_pages":1,"page_size":2}'::jsonb);
 assert r->>'state'='recorded','Users approval failed';
end$$;
reset role;
begin;
-- Simulate the same account running a contact capture. A new users approval
-- must not switch the durable collection or release another provider request.
update public.connector_accounts set settings=jsonb_set(settings,
 '{commusoft_import,resource}','"propertyContacts"'::jsonb)
 where tenant_id=public.fixture_id(100);
update public.platform_jobs set status='running',claimed_by='synthetic-contact-worker',
 attempt_count=1,lease_expires_at=clock_timestamp()+interval '1 hour'
 where tenant_id=public.fixture_id(100) and job_type='commusoft.source_sync';
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';
set role authenticated;
do $$begin
 begin
  perform public.learn_operator_input_request(public.fixture_id(100),public.fixture_id(291),
   public.fixture_id(180),public.fixture_definition('start')||
    '{"resource":"users","max_pages":1,"page_size":2}'::jsonb);
  raise exception 'Users started during active contacts capture';
 exception when object_not_in_prerequisite_state then
  assert sqlerrm='learn_operator_import_active','Wrong active-capture refusal';
 end;
end$$;
reset role;
rollback;
do $$begin
 assert (select settings#>>'{commusoft_import,resource}' from public.connector_accounts
  where tenant_id=public.fixture_id(100))='users','Wrong approved resource';
 assert not exists(select 1 from public.learn_business_input_versions where collection='users'),
  'Install or approval read provider';
end$$;
set request.jwt.claim.role='service_role';
do $$declare j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;
 c public.provider_connections%rowtype;expected jsonb;permit jsonb;receipt jsonb;
 envelope jsonb:='{"data":[{"id":71,"firstName":"Fixture","lastName":"User","appearOnSchedule":true,"skills":[{"id":3,"skill":"Fixture skill"}]}],"pagination":{"hasMore":false,"nextCursor":71}}';
begin
 select * into j from public.learn_commusoft_claim_jobs(public.fixture_id(170));
 assert j.id is not null and j.tenant_id=public.fixture_id(100),'Users job not claimed';
 select * into a from public.connector_accounts where id=(j.payload->>'connector_account_id')::uuid;
 select * into c from public.provider_connections where id=(a.settings#>>'{commusoft_import,connectionId}')::uuid;
 expected:=jsonb_build_object('tenantId',a.tenant_id,'jobId',j.id,'accountId',a.id,
  'connectorId',a.tenant_connector_id,'connectionId',c.id,'connectionRevision',c.updated_at,
  'secretId',c.secret_refs->>'api_key','approval',a.settings->'commusoft_import',
  'checkpoint',a.sync_cursor,'pages',0,'complete',false,
  'request',jsonb_build_object('region','uk','resource','users','after',null,'limit',2));
 assert public.learn_commusoft_acquire_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,
  jsonb_set(expected,'{request,resource}','"jobs"'::jsonb)) is null,
  'Unapproved jobs resource got a credential';
 update public.feature_flags set value='false'::jsonb where tenant_id=a.tenant_id
  and flag='learn.inputs.commusoft.users.enabled';
 assert public.learn_commusoft_acquire_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,expected)
  is null,'Disabled users flag released a credential';
 update public.feature_flags set value='true'::jsonb where tenant_id=a.tenant_id
  and flag='learn.inputs.commusoft.users.enabled';
 permit:=public.learn_commusoft_acquire_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,expected);
 assert permit->>'state'='ready','Users permit unavailable';
 update public.feature_flags set value='false'::jsonb where tenant_id=a.tenant_id
  and flag='learn.inputs.commusoft.users.enabled';
 begin
  perform public.learn_commusoft_commit_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,
   (permit->>'permitId')::uuid,envelope);
  raise exception 'Disabled users flag retained a page';
 exception when insufficient_privilege then
  assert sqlerrm='commusoft_module_unavailable','Wrong users commit refusal';
 end;
 update public.feature_flags set value='true'::jsonb where tenant_id=a.tenant_id
  and flag='learn.inputs.commusoft.users.enabled';
 receipt:=public.learn_commusoft_commit_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,
  (permit->>'permitId')::uuid,envelope);
 assert receipt->>'records'='1' and receipt#>>'{checkpoint,complete}'='true',
  'Users page not committed';
 perform public.learn_commusoft_finish_job(a.tenant_id,j.id,j.claimed_by,j.attempt_count,
  '{"success":true}'::jsonb);
 assert (select count(*) from public.learn_business_input_versions where tenant_id=a.tenant_id
  and connection_id=c.id and provider='commusoft' and collection='users' and external_id='71')=1,
  'Users source version absent';
 assert (select count(*) from public.learn_business_input_pages where tenant_id=a.tenant_id
  and connection_id=c.id and collection='users')=1,'Users source page absent';
 assert to_regclass('public.people') is null and to_regclass('public.team_members') is null,
  'Synthetic users retention unexpectedly depends on staff tables';
 assert public.learn_commusoft_acquire_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,expected)
  is null,'Committed users page reacquired a credential';
end$$;
select 'PASS: users opt-in, exact permit, one retained page, no staff-table dependency or second credential' result;
