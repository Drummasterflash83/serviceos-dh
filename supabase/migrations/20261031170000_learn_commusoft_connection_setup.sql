-- Operator-governed Commusoft setup. Reuses the existing tenant Vault broker.
-- Configuration is not verification and never starts an import or changes flags.
begin;
create table public.learn_commusoft_connection_requests (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),
 definition jsonb not null,
 credential_fingerprint text,
 previous_state jsonb,
 receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_commusoft_connection_requests enable row level security;
revoke all on public.learn_commusoft_connection_requests from public,anon,authenticated,service_role;
create trigger learn_commusoft_connection_immutable before update or delete on public.learn_commusoft_connection_requests
 for each row execute function public.learn_operator_input_immutable();

create function public.learn_commusoft_configure(
 p_tenant uuid,p_request uuid,p_actor uuid,p_definition jsonb,p_mode text default 'apply',p_api_key text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.learn_commusoft_connection_requests%rowtype;c public.provider_connections%rowtype;
 wanted_revision timestamptz;region text;account_key text;credential_mode text;secret_id uuid;
 key_fingerprint text;previous jsonb;receipt jsonb;has_connection boolean;
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_mode is null or p_mode not in ('apply','check','cancel')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>10000
  or (p_mode<>'apply' and p_api_key is not null) then
  raise exception 'learn_connection_request_invalid' using errcode='22023';end if;
 if p_api_key is not null then
  if octet_length(p_api_key) not between 1 and 4096 or p_api_key!~'^[!-~]+$' then
   raise exception 'learn_connection_credential_invalid' using errcode='22023';end if;
  key_fingerprint:=encode(sha256(convert_to('commusoft:'||p_api_key,'UTF8')),'hex');
 end if;
 if not p_definition ?& array['kind','reason','region','account_key','expected_revision','credential_mode','same_account_confirmed']
  or (p_definition-array['kind','reason','region','account_key','expected_revision','credential_mode','same_account_confirmed'])<>'{}'::jsonb
  or p_definition->>'kind' is distinct from 'configure_commusoft'
  or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
  or jsonb_typeof(p_definition->'region') is distinct from 'string' or p_definition->>'region' not in ('uk','us')
  or jsonb_typeof(p_definition->'account_key') is distinct from 'string' or length(btrim(p_definition->>'account_key')) not between 1 and 2000
  or jsonb_typeof(p_definition->'expected_revision') not in ('string','null')
  or jsonb_typeof(p_definition->'credential_mode') is distinct from 'string' or p_definition->>'credential_mode' not in ('reuse','replace')
  or p_definition->'same_account_confirmed' is distinct from 'true'::jsonb then
  raise exception 'learn_connection_definition_invalid' using errcode='22023';end if;
 region:=p_definition->>'region';account_key:=btrim(p_definition->>'account_key');credential_mode:=p_definition->>'credential_mode';
 if p_definition->>'expected_revision' is not null then
  wanted_revision:=(p_definition->>'expected_revision')::timestamptz;
  if not isfinite(wanted_revision) then raise exception 'learn_connection_revision_invalid' using errcode='22023';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-connection-request:'||p_request::text,0));
 select * into prior from public.learn_commusoft_connection_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.definition<>p_definition
   or (p_api_key is not null and prior.receipt->>'state'<>'cancelled' and prior.credential_fingerprint is distinct from key_fingerprint) then
   raise exception 'learn_connection_request_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if p_mode='check' then return jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','pending');end if;
 if p_mode='cancel' then
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','cancelled');
  insert into public.learn_commusoft_connection_requests(id,tenant_id,actor_id,definition,receipt) values(p_request,p_tenant,p_actor,p_definition,receipt);
  return receipt;
 end if;
 if (credential_mode='replace' and p_api_key is null) or (credential_mode='reuse' and p_api_key is not null) then
  raise exception 'learn_connection_credential_mode_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'learn_connection_tenant_inactive' using errcode='55000';end if;
 -- Approval creation uses the same tenant lock. Running/queued work must first
 -- be resolved; do not invalidate a source traversal behind its operator.
 if exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync' and status in ('queued','running','retrying')) then
  raise exception 'learn_connection_import_active' using errcode='55000';end if;
 select * into c from public.provider_connections where tenant_id=p_tenant and provider='commusoft' for update;
 has_connection:=found;
 if (has_connection and c.updated_at is distinct from wanted_revision) or (not has_connection and wanted_revision is not null) then
  raise exception 'learn_connection_revision_changed' using errcode='PT409';end if;
 -- This is credential maintenance for the same source identity. Moving to a
 -- different provider account/region requires an explicit retained-identity flow.
 if has_connection and ((c.non_secret_config ? 'account_key' and c.non_secret_config->>'account_key' is distinct from account_key)
  or (c.non_secret_config ? 'region' and c.non_secret_config->>'region' is distinct from region)) then
  raise exception 'learn_connection_source_identity_changed' using errcode='PT409';end if;
 if has_connection then
  previous:=jsonb_build_object('connection_id',c.id,'revision',c.updated_at,'status',c.status,'verified_at',c.verified_at,
    'account_key',c.non_secret_config->>'account_key','region',c.non_secret_config->>'region','configured_fields',c.configured_fields);
 end if;
 if credential_mode='reuse' then
  select id into secret_id from vault.secrets where name='provider_secret:'||p_tenant::text||':commusoft:api_key' for share;
  if secret_id is null then raise exception 'learn_connection_credential_missing' using errcode='55000';end if;
  if has_connection and c.secret_refs ? 'api_key' and c.secret_refs->>'api_key' is distinct from secret_id::text then
   raise exception 'learn_connection_binding_changed' using errcode='PT409';end if;
 else
  secret_id:=public.provider_secret_store(p_tenant,'commusoft','api_key',p_api_key);
 end if;
 if has_connection then
  update public.provider_connections set status='configured',auth_mode='private_api_key',
   non_secret_config=non_secret_config||jsonb_build_object('region',region,'account_key',account_key),
   configured_fields=array['api_key'],secret_refs=jsonb_build_object('api_key',secret_id),
   verified_at=null,last_test=jsonb_build_object('state','not_verified','code','configuration_changed'),
   updated_by=p_actor,revoked_at=null,revoked_by=null where id=c.id returning * into c;
 else
  insert into public.provider_connections(tenant_id,provider,status,auth_mode,non_secret_config,configured_fields,secret_refs,created_by,updated_by,last_test)
   values(p_tenant,'commusoft','configured','private_api_key',jsonb_build_object('region',region,'account_key',account_key),
    array['api_key'],jsonb_build_object('api_key',secret_id),p_actor,p_actor,jsonb_build_object('state','not_verified','code','configuration_changed')) returning * into c;
 end if;
 insert into public.provider_connection_events(tenant_id,provider,event,actor_id,detail)
  values(p_tenant,'commusoft','learn_connection_configured',p_actor,jsonb_build_object('request_id',p_request,'connection_id',c.id,'credential_mode',credential_mode,'verified',false));
 receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','recorded','connection_id',c.id,'revision',c.updated_at,'credential_bound',true,'verification','required');
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 insert into public.learn_commusoft_connection_requests(id,tenant_id,actor_id,definition,credential_fingerprint,previous_state,receipt)
  values(p_request,p_tenant,p_actor,p_definition,key_fingerprint,previous,receipt);
 return receipt;
end $$;
revoke all on function public.learn_commusoft_configure(uuid,uuid,uuid,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_configure(uuid,uuid,uuid,jsonb,text,text) to authenticated;
commit;
