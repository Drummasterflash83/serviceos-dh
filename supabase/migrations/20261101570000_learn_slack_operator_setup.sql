-- Operator-governed Slack setup. Reuses the existing tenant Vault broker.
-- Configuration is not verification and never starts an import or changes flags.
begin;
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
commit;
