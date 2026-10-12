-- DRAFT: Slack user credentials and logged operator setup; no credential provisioning or activation.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then
  raise exception 'Reviewed production Slack setup target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_commusoft_update_windows_v1'
  and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='ab4cef1752c520a13047fb287d63931068f7e7468d0014ba955df75a49a9dd56') then
  raise exception 'Pinned production Slack setup prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_slack_user_operator_v1')
 or to_regprocedure('public.learn_slack_credential_field(jsonb)') is not null
 or to_regclass('public.learn_slack_connection_requests') is not null then
  raise exception 'Production Slack setup candidate already exists; inspect before retry';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into observed from (-- Read-only release planning metadata. No source rows, credentials or SQL bodies.
select jsonb_build_object(
 'tables',(select coalesce(jsonb_agg(x order by x->>'name'),'[]') from (
  select jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),
   'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
   'columns',(select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,
    'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
    'identity',a.attidentity,'generated',a.attgenerated,
    'defaultHash',md5(pg_get_expr(d.adbin,d.adrelid))) order by a.attnum),'[]')
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',k.conname,
    'kind',k.contype,'validated',k.convalidated,'hash',md5(pg_get_constraintdef(k.oid))) order by k.conname),'[]')
    from pg_constraint k where k.conrelid=c.oid),
   'indexes',(select coalesce(jsonb_agg(jsonb_build_object('name',i.relname,
    'valid',z.indisvalid,'hash',md5(pg_get_indexdef(i.oid))) order by i.relname),'[]')
    from pg_index z join pg_class i on i.oid=z.indexrelid where z.indrelid=c.oid),
   'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,
    'enabled',t.tgenabled,'hash',md5(pg_get_triggerdef(t.oid))) order by t.tgname),'[]')
    from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
   'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.policyname,
    'roles',p.roles,'command',p.cmd,'permissive',p.permissive,
    'usingHash',md5(p.qual),'checkHash',md5(p.with_check)) order by p.policyname),'[]')
    from pg_policies p where p.schemaname='public' and p.tablename=c.relname),
   'acl',(select coalesce(jsonb_agg(jsonb_build_object('role',case when g.grantee=0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,
    'privilege',g.privilege_type,'grantable',g.is_grantable) order by g.grantee=0,pg_get_userbyid(g.grantee),g.privilege_type),'[]')
    from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) g)
  ) x from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p')
 ) q),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,
  'arguments',pg_get_function_identity_arguments(p.oid),'hash',md5(pg_get_functiondef(p.oid)),
  'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,
  'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE')) order by p.proname,pg_get_function_identity_arguments(p.oid)),'[]')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,
  'hash',md5(pg_get_viewdef(c.oid)),'owner',pg_get_userbyid(c.relowner),'options',c.reloptions) order by c.relname),'[]')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m'))
) as inventory) q,
  lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array['learn_slack_accounts_read','learn_slack_history_read','learn_slack_history_state','learn_slack_queue_recurring_threads','learn_slack_read_credential','learn_slack_read_thread_credential','learn_slack_recurring_control','learn_slack_resume_history','learn_slack_resume_thread','learn_slack_schedule_recurring','learn_slack_start_import','learn_slack_start_thread_import','learn_slack_thread_recovery_read','learn_slack_thread_recovery_state','learn_slack_threads_read']);
 if observed is distinct from '[{"hash":"45bc2b5a2648b1f7bba6017c4c923428","name":"learn_slack_accounts_read","owner":"postgres","arguments":"p_tenant_id uuid, p_after_id uuid","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true},{"hash":"53b360be5f46d3ac6576ba842deb6441","name":"learn_slack_history_read","owner":"postgres","arguments":"p_tenant_id uuid, p_account_id uuid","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true},{"hash":"b1062357334926dbe7a39bd351303423","name":"learn_slack_history_state","owner":"postgres","arguments":"p_tenant_id uuid, p_account_id uuid","anonExecute":false,"serviceExecute":false,"securityDefiner":false,"authenticatedExecute":false},{"hash":"6f781b58c070982658e24bffae20fe2c","name":"learn_slack_queue_recurring_threads","owner":"postgres","arguments":"p_account uuid","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"33baf10ed6a97e135a511514a61e80c6","name":"learn_slack_read_credential","owner":"postgres","arguments":"p_tenant_id uuid, p_job_id uuid, p_claimed_by text, p_attempt_count integer, p_connection_id uuid, p_revision timestamp with time zone, p_secret_id uuid","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"e8c58c29090714fa476c58b90b039a85","name":"learn_slack_read_thread_credential","owner":"postgres","arguments":"p_tenant_id uuid, p_job_id uuid, p_claimed_by text, p_attempt_count integer, p_connection_id uuid, p_revision timestamp with time zone, p_secret_id uuid","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"b9c69b1826809435b95268aee7e16e24","name":"learn_slack_recurring_control","owner":"postgres","arguments":"p_tenant uuid, p_request uuid, p_account uuid, p_revision bigint, p_enabled boolean, p_reason text, p_mode text, p_actor uuid","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true},{"hash":"4fa7b6b1e24c727efa480f59ad65b401","name":"learn_slack_resume_history","owner":"postgres","arguments":"p_tenant_id uuid, p_request_id uuid, p_account_id uuid, p_expected_state_version text, p_mode text, p_max_pages integer, p_reason text","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true},{"hash":"0f8fb4f8148f3792b372fd254ac32641","name":"learn_slack_resume_thread","owner":"postgres","arguments":"p_tenant_id uuid, p_request_id uuid, p_import_id uuid, p_expected_state_version text, p_mode text, p_max_pages integer, p_reason text","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true},{"hash":"bf67fc32c9f4d6e923549b543a1c9ed9","name":"learn_slack_schedule_recurring","owner":"postgres","arguments":"p_batch integer","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":false},{"hash":"760fa3f2d0e1d224211d10c3bd758302","name":"learn_slack_start_import","owner":"postgres","arguments":"p_tenant_id uuid, p_request_id uuid, p_connection_id uuid, p_expected_revision text, p_channel_id text, p_start timestamp with time zone, p_end timestamp with time zone, p_max_pages integer, p_reason text","anonExecute":false,"serviceExecute":true,"securityDefiner":true,"authenticatedExecute":true},{"hash":"a2b4d2c8643c2965cd008ed258e0c427","name":"learn_slack_start_thread_import","owner":"postgres","arguments":"p_tenant_id uuid, p_request_id uuid, p_account_id uuid, p_source_message_id uuid, p_source_version text, p_connection_revision timestamp with time zone, p_start timestamp with time zone, p_end timestamp with time zone, p_max_pages integer, p_reason text","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true},{"hash":"9d5ba11683625f13046dc722faf408a5","name":"learn_slack_thread_recovery_read","owner":"postgres","arguments":"p_tenant_id uuid, p_import_id uuid","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true},{"hash":"0d0d09c0bf20a677ca71cf461c7c3f95","name":"learn_slack_thread_recovery_state","owner":"postgres","arguments":"p_tenant_id uuid, p_import_id uuid","anonExecute":false,"serviceExecute":false,"securityDefiner":false,"authenticatedExecute":false},{"hash":"0fce7b4f2de3bb127fde403518628dd1","name":"learn_slack_threads_read","owner":"postgres","arguments":"p_tenant_id uuid, p_account_id uuid, p_before_parent text","anonExecute":false,"serviceExecute":false,"securityDefiner":true,"authenticatedExecute":true}]'::jsonb then
  raise exception 'Production Slack setup function baseline differs';end if;
end$$;
-- Explicit Slack user identity for channel capture. No credential is installed,
-- no account is enabled, and no retained source record is changed.
create function public.learn_slack_credential_field(p_config jsonb) returns text
language sql immutable security invoker set search_path=pg_catalog as $$
 select case
  when jsonb_typeof(p_config) is distinct from 'object' then null
  when (not (p_config ? 'credential_kind') or p_config->'credential_kind'='"bot"'::jsonb)
    and not (p_config ? 'authorized_user_id') then 'bot_token'
  when p_config->'credential_kind'='"user"'::jsonb
    and jsonb_typeof(p_config->'authorized_user_id')='string'
    and p_config->>'authorized_user_id' ~ '^[UW][A-Z0-9]+$'
    then 'user_token'
  else null end;
$$;
revoke all on function public.learn_slack_credential_field(jsonb) from public,anon;
grant execute on function public.learn_slack_credential_field(jsonb) to authenticated,service_role;

-- Preserve all existing consent, claim, tenant, revision, capture and recurring
-- gates. Reject unexpected catalog shapes instead of silently applying a partial
-- upgrade. CREATE OR REPLACE preserves the existing function identities/grants.
do $$
declare target text; oid_value oid; original text; rewritten text; secret_reader boolean;
begin
 foreach target in array array[
  'learn_slack_start_import','learn_slack_read_credential',
  'learn_slack_start_thread_import','learn_slack_read_thread_credential',
  'learn_slack_threads_read','learn_slack_history_state',
  'learn_slack_thread_recovery_state','learn_slack_recurring_control',
  'learn_slack_schedule_recurring','learn_slack_queue_recurring_threads'
 ] loop
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=target)<>1 then
   raise exception 'slack_user_credential_catalog_count: %',target;
  end if;
  select p.oid into oid_value from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname=target;
  original:=pg_get_functiondef(oid_value);
  if position('''bot_token''' in original)=0 then raise exception 'slack_user_credential_catalog_shape: %',target;end if;
  rewritten:=replace(original,'''bot_token''=any(c.configured_fields)',
    'public.learn_slack_credential_field(c.non_secret_config)=any(c.configured_fields)');
  rewritten:=replace(rewritten,'c.secret_refs->>''bot_token''',
    'c.secret_refs->>public.learn_slack_credential_field(c.non_secret_config)');
  rewritten:=replace(rewritten,'''bot_token''=any(configured_fields)',
    'public.learn_slack_credential_field(non_secret_config)=any(configured_fields)');
  rewritten:=replace(rewritten,'secret_refs->>''bot_token''',
    'secret_refs->>public.learn_slack_credential_field(non_secret_config)');
  secret_reader:=target in ('learn_slack_read_credential','learn_slack_read_thread_credential');
  if secret_reader then
   if position('declare j public.platform_jobs%rowtype;' in rewritten)=0
    or position('perform 1 from public.provider_connections where id=p_connection_id' in rewritten)=0
    or position(''':slack:bot_token''' in rewritten)=0 then
    raise exception 'slack_user_credential_reader_shape: %',target;
   end if;
   rewritten:=replace(rewritten,'declare j public.platform_jobs%rowtype;',
    'declare credential_field text;j public.platform_jobs%rowtype;');
   rewritten:=replace(rewritten,'perform 1 from public.provider_connections where id=p_connection_id',
    'select public.learn_slack_credential_field(non_secret_config) into credential_field from public.provider_connections where id=p_connection_id');
   rewritten:=replace(rewritten,''':slack:bot_token''',''':slack:''||credential_field');
  end if;
  if rewritten=original or position('bot_token' in rewritten)>0 then
   raise exception 'slack_user_credential_patch_incomplete: %',target;
  end if;
  execute rewritten;
 end loop;
end $$;

-- Operator-governed Slack setup. Reuses the existing tenant Vault broker.
-- Configuration is not verification and never starts an import or changes flags.
create table public.learn_slack_connection_requests (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),
 definition jsonb not null,
 credential_fingerprint text,
 previous_state jsonb,
 receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_slack_connection_requests enable row level security;
revoke all on public.learn_slack_connection_requests from public,anon,authenticated,service_role;
create trigger learn_slack_connection_immutable before update or delete on public.learn_slack_connection_requests
 for each row execute function public.learn_operator_input_immutable();

create function public.learn_slack_configure(
 p_tenant uuid,p_request uuid,p_actor uuid,p_definition jsonb,p_mode text default 'apply',p_user_token text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.learn_slack_connection_requests%rowtype;c public.provider_connections%rowtype;
 wanted_revision timestamptz;team_id text;user_id text;credential_mode text;secret_id uuid;
 key_fingerprint text;previous jsonb;receipt jsonb;has_connection boolean;
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_mode is null or p_mode not in ('apply','check','cancel')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>10000
  or (p_mode<>'apply' and p_user_token is not null) then
  raise exception 'learn_connection_request_invalid' using errcode='22023';end if;
 if p_user_token is not null then
  if octet_length(p_user_token) not between 1 and 4096 or p_user_token!~'^xoxp-[A-Za-z0-9-]+$' then
   raise exception 'learn_connection_credential_invalid' using errcode='22023';end if;
  key_fingerprint:=encode(sha256(convert_to('slack:'||p_user_token,'UTF8')),'hex');
 end if;
 if not p_definition ?& array['kind','reason','team_id','authorized_user_id','expected_revision','credential_mode','same_account_confirmed']
  or (p_definition-array['kind','reason','team_id','authorized_user_id','expected_revision','credential_mode','same_account_confirmed'])<>'{}'::jsonb
  or p_definition->>'kind' is distinct from 'configure_slack'
  or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
  or jsonb_typeof(p_definition->'team_id') is distinct from 'string' or p_definition->>'team_id' !~ '^T[A-Z0-9]{1,99}$'
  or jsonb_typeof(p_definition->'authorized_user_id') is distinct from 'string' or p_definition->>'authorized_user_id' !~ '^[UW][A-Z0-9]{1,99}$'
  or jsonb_typeof(p_definition->'expected_revision') not in ('string','null')
  or jsonb_typeof(p_definition->'credential_mode') is distinct from 'string' or p_definition->>'credential_mode' not in ('reuse','replace')
  or p_definition->'same_account_confirmed' is distinct from 'true'::jsonb then
  raise exception 'learn_connection_definition_invalid' using errcode='22023';end if;
 team_id:=p_definition->>'team_id';user_id:=p_definition->>'authorized_user_id';credential_mode:=p_definition->>'credential_mode';
 if p_definition->>'expected_revision' is not null then
  wanted_revision:=(p_definition->>'expected_revision')::timestamptz;
  if not isfinite(wanted_revision) then raise exception 'learn_connection_revision_invalid' using errcode='22023';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-connection-request:'||p_request::text,0));
 select * into prior from public.learn_slack_connection_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.definition<>p_definition
   or (p_user_token is not null and prior.receipt->>'state'<>'cancelled' and prior.credential_fingerprint is distinct from key_fingerprint) then
   raise exception 'learn_connection_request_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if p_mode='check' then return jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','pending');end if;
 if p_mode='cancel' then
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','cancelled');
  insert into public.learn_slack_connection_requests(id,tenant_id,actor_id,definition,receipt) values(p_request,p_tenant,p_actor,p_definition,receipt);
  return receipt;
 end if;
 if (credential_mode='replace' and p_user_token is null) or (credential_mode='reuse' and p_user_token is not null) then
  raise exception 'learn_connection_credential_mode_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||p_tenant::text,0));
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'learn_connection_tenant_inactive' using errcode='55000';end if;
 select * into c from public.provider_connections where tenant_id=p_tenant and provider='slack' for update;
 has_connection:=found;
 -- Check after locking the connection: thread setup takes a shared connection
 -- lock, so a concurrently committed approval cannot slip past this check.
 if exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type in ('slack.history_sync','slack.thread_sync') and status in ('queued','running','retrying')) then
  raise exception 'learn_connection_import_active' using errcode='55000';end if;

 if (has_connection and c.updated_at is distinct from wanted_revision) or (not has_connection and wanted_revision is not null) then
  raise exception 'learn_connection_revision_changed' using errcode='PT409';end if;
 -- Credential rotation may not switch workspace or consenting user behind
 -- retained source history. A different identity needs a separate reviewed flow.
 if has_connection and (c.non_secret_config->>'team_id' is distinct from team_id
  or c.non_secret_config->>'credential_kind' is distinct from 'user'
  or c.non_secret_config->>'authorized_user_id' is distinct from user_id) then
  raise exception 'learn_connection_source_identity_changed' using errcode='PT409';end if;
 if exists(select 1 from public.slack_recurring_channels where tenant_id=p_tenant and enabled) then
  raise exception 'learn_connection_recurring_active' using errcode='55000';end if;
 if has_connection then
  previous:=jsonb_build_object('connection_id',c.id,'revision',c.updated_at,'status',c.status,'verified_at',c.verified_at,
    'team_id',c.non_secret_config->>'team_id','authorized_user_id',c.non_secret_config->>'authorized_user_id','configured_fields',c.configured_fields);
 end if;
 if credential_mode='reuse' then
  -- Reuse requires the existing identity-bound connection and exact Vault reference.
  select id into secret_id from vault.secrets where name='provider_secret:'||p_tenant::text||':slack:user_token';
  if secret_id is null then raise exception 'learn_connection_credential_missing' using errcode='55000';end if;
  if not has_connection or c.secret_refs->>'user_token' is distinct from secret_id::text then
   raise exception 'learn_connection_binding_changed' using errcode='PT409';end if;
 else
  secret_id:=public.provider_secret_store(p_tenant,'slack','user_token',p_user_token);
 end if;
 if has_connection then
  update public.provider_connections set status='configured',auth_mode='user_token',
   non_secret_config=non_secret_config||jsonb_build_object('team_id',team_id,'authorized_user_id',user_id,'credential_kind','user'),
   configured_fields=array['user_token'],secret_refs=jsonb_build_object('user_token',secret_id),
   verified_at=null,last_test=jsonb_build_object('state','not_verified','code','configuration_changed'),
   updated_by=p_actor,revoked_at=null,revoked_by=null where id=c.id returning * into c;
 else
  insert into public.provider_connections(tenant_id,provider,status,auth_mode,non_secret_config,configured_fields,secret_refs,created_by,updated_by,last_test)
   values(p_tenant,'slack','configured','user_token',jsonb_build_object('team_id',team_id,'authorized_user_id',user_id,'credential_kind','user'),
    array['user_token'],jsonb_build_object('user_token',secret_id),p_actor,p_actor,jsonb_build_object('state','not_verified','code','configuration_changed')) returning * into c;
 end if;
 insert into public.provider_connection_events(tenant_id,provider,event,actor_id,detail)
  values(p_tenant,'slack','learn_connection_configured',p_actor,jsonb_build_object('request_id',p_request,'connection_id',c.id,'credential_mode',credential_mode,'verified',false));
 receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','recorded','connection_id',c.id,'revision',c.updated_at,'credential_bound',true,'verification','required');
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 insert into public.learn_slack_connection_requests(id,tenant_id,actor_id,definition,credential_fingerprint,previous_state,receipt)
  values(p_request,p_tenant,p_actor,p_definition,key_fingerprint,previous,receipt);
 return receipt;
end $$;
revoke all on function public.learn_slack_configure(uuid,uuid,uuid,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_configure(uuid,uuid,uuid,jsonb,text,text) to authenticated;

-- Tenant owners retain existing rights. Cross-client operators use their own
-- logged authority; no profile switching or synthetic user identity is accepted.
create function public.learn_slack_control_access(p_tenant uuid,p_write boolean,p_action text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null
  or p_tenant is null or p_write is null or p_action is null
  or p_action not in ('connections','accounts','threads','history','thread_recovery',
    'start_history','start_thread','resume_history','resume_thread') then
  raise exception 'slack_control_forbidden' using errcode='42501';end if;
 if p_tenant=public.current_tenant_id() and (not p_write or public.current_user_role() in ('owner','admin')) then
  if p_write and exists(select 1 from public.view_as_context where actor_user_id=auth.uid()
   and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
   raise exception 'slack_control_preview_forbidden' using errcode='42501';end if;
  return;
 end if;
 perform public.learn_operator_input_access(p_tenant,auth.uid(),p_write);
 insert into public.provider_connection_events(tenant_id,provider,event,actor_id,detail)
  values(p_tenant,'slack','operator_slack_control',auth.uid(),jsonb_build_object('action',p_action,'write',p_write));
end $$;
revoke all on function public.learn_slack_control_access(uuid,boolean,text) from public,anon,authenticated,service_role;

create function public.learn_slack_connections_read(p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare rows jsonb;begin
 perform public.learn_slack_control_access(p_tenant_id,false,'connections');
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'tenant_id',tenant_id,'status',status,
  'revoked_at',revoked_at,'updated_at',updated_at,'team_id',non_secret_config->>'team_id',
  'team_name',non_secret_config->>'team_name') order by id),'[]'::jsonb) into rows
  from public.provider_connections where tenant_id=p_tenant_id and provider='slack'
   and status='configured' and revoked_at is null;
 return rows;
end $$;
revoke all on function public.learn_slack_connections_read(uuid) from public,anon,service_role;
grant execute on function public.learn_slack_connections_read(uuid) to authenticated;

-- Replace only each entry guard; preserve existing scope, revision, tenant,
-- checkpoint, consent and credential predicates in the reviewed body.
do $patch$
declare name text;definition text;guard text;action text;writing boolean;signature regprocedure;
begin
 foreach name in array array['learn_slack_start_import','learn_slack_start_thread_import',
  'learn_slack_resume_history','learn_slack_resume_thread','learn_slack_accounts_read',
  'learn_slack_threads_read','learn_slack_history_read','learn_slack_thread_recovery_read'] loop
  select p.oid::regprocedure into strict signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname=name;
  definition:=pg_get_functiondef(signature);
  guard:=substring(definition from '(if auth\.uid\(\) is null[^;]+;end if;)');
  if guard is null then
   guard:=substring(definition from '(if auth\.uid\(\) is null[^;]+;[[:space:]]+end if;)');
  end if;
  if guard is null or length(definition)-length(replace(definition,guard,''))<>length(guard) then
   raise exception 'Expected unique Slack entry guard: %',name;end if;
  writing:=name in ('learn_slack_start_import','learn_slack_start_thread_import','learn_slack_resume_history','learn_slack_resume_thread');
  action:=case name when 'learn_slack_start_import' then 'start_history' when 'learn_slack_start_thread_import' then 'start_thread'
   when 'learn_slack_resume_history' then 'resume_history' when 'learn_slack_resume_thread' then 'resume_thread'
   when 'learn_slack_accounts_read' then 'accounts' when 'learn_slack_threads_read' then 'threads'
   when 'learn_slack_history_read' then 'history' else 'thread_recovery' end;
  definition:=replace(definition,guard,format('perform public.learn_slack_control_access(p_tenant_id,%L,%L);',writing,action));
  -- Logged operator reads must be volatile, unlike their previous tenant-only reads.
  if not writing then definition:=replace(definition,' STABLE SECURITY DEFINER',' VOLATILE SECURITY DEFINER');end if;
  execute definition;
 end loop;
end $patch$;

-- Scoped approval attribution for logged cross-client Slack operators.
-- Source/account/job references remain tenant-bound; no row or grant changes.
create function public.learn_slack_reference_guard() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
declare j jsonb:=to_jsonb(new); tenant uuid; parent_tenant uuid; fk record; rows_found bigint;
begin
 if tg_table_schema<>'public' or tg_table_name not in ('slack_history_imports','slack_thread_imports') then raise exception 'Slack reference guard used outside its scope' using errcode='23514';end if;
 if tg_table_name='org_unit_members' then
  if tg_op='UPDATE' and (old.org_unit_id is distinct from new.org_unit_id or old.user_id is distinct from new.user_id) then
   raise exception 'Organisation membership identity is immutable' using errcode='23514';end if;
  select tenant_id into tenant from public.org_units where id=new.org_unit_id;
  if tenant is null then raise exception 'Organisation unit is missing' using errcode='23503';end if;
 else
  tenant:=(j->>'tenant_id')::uuid;
  if tg_op='UPDATE' and ((to_jsonb(old)->>'tenant_id') is distinct from (j->>'tenant_id')
    or (to_jsonb(old)->>'id') is distinct from (j->>'id')) then
   raise exception 'Foundation tenant and identity are immutable' using errcode='23514';end if;
  if tenant is not null and not exists(select 1 from public.tenants where id=tenant) then
   raise exception 'Tenant is missing' using errcode='23503';end if;
 end if;
 for fk in select sn.nspname as schema_name,pc.relname as table_name,sa.attname as child_column,pa.attname as parent_column
  from pg_constraint k join pg_class pc on pc.oid=k.confrelid join pg_namespace sn on sn.oid=pc.relnamespace
  join pg_attribute sa on sa.attrelid=k.conrelid and sa.attnum=k.conkey[1]
  join pg_attribute pa on pa.attrelid=k.confrelid and pa.attnum=k.confkey[1]
  where k.conrelid=tg_relid and k.contype='f' and cardinality(k.conkey)=1 and cardinality(k.confkey)=1
   and exists(select 1 from pg_attribute a where a.attrelid=k.confrelid and a.attname='tenant_id' and not a.attisdropped)
 loop
  if j->>fk.child_column is null then continue;end if;
  execute format('select tenant_id from %I.%I where %I=$1::uuid',fk.schema_name,fk.table_name,fk.parent_column)
   into parent_tenant using j->>fk.child_column;
  get diagnostics rows_found=row_count;
  if rows_found<>1 then raise exception 'Referenced foundation record is missing' using errcode='23503';end if;
  -- An approver records the acting person; it is not a client-owned source.
  -- Only an actual authenticated OpenFolk admin can insert foreign attribution.
  -- Workers may retain that exact attribution while updating a thread checkpoint.
  if fk.schema_name='public' and fk.table_name='profiles' and fk.child_column='approved_by'
    and parent_tenant is distinct from tenant then
   if tg_op='UPDATE' and (to_jsonb(old)->>'approved_by') is not distinct from (j->>'approved_by') then continue;end if;
   if auth.role() is distinct from 'authenticated' or auth.uid() is null
    or (j->>'approved_by')::uuid is distinct from auth.uid() then
    raise exception 'Slack operator approval attribution required' using errcode='42501';end if;
   perform public.learn_operator_input_access(tenant,auth.uid(),true);
   continue;
  end if;
  if not (fk.schema_name='public' and fk.table_name in ('config_versions','import_profiles') and parent_tenant is null)
    and parent_tenant is distinct from tenant then
   raise exception 'Referenced foundation record belongs to another tenant' using errcode='23514';end if;
 end loop;
 return new;
end $$;
revoke all on function public.learn_slack_reference_guard() from public,anon,authenticated;
grant execute on function public.learn_slack_reference_guard() to service_role;
do $$declare tab text;trig text;begin
 foreach tab in array array['slack_history_imports','slack_thread_imports'] loop
  select tgname into strict trig from pg_trigger where tgrelid=('public.'||tab)::regclass
   and tgfoid='public.learn_foundation_reference_guard()'::regprocedure and not tgisinternal;
  execute format('drop trigger %I on public.%I',trig,tab);
  execute format('create trigger %I before insert or update on public.%I for each row execute function public.learn_slack_reference_guard()',trig,tab);
 end loop;
end$$;

insert into of_learn_deploy.migrations values('learn_slack_user_operator_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
