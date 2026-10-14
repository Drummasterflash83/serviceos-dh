-- Prepared production artifact; NOT INSTALLED. No credentials, grants, data or capture seeded.
-- The target setting is an operator guard, not cryptographic proof of the database identity.
begin;
set local lock_timeout='5s';
set local statement_timeout='40s';
do $guard$ begin
if current_setting('serviceos.quickbooks_target',true) is distinct from 'tgbnakbxwcqjeimygroz' then raise exception 'QuickBooks production target required';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.learn_operator_input_immutable()') and md5(prosrc)='5226d715d49ccaa8a0c61b39a08c294b' and pg_get_userbyid(proowner)='postgres' and prosecdef=false and to_jsonb(proconfig) is not distinct from '["search_path=pg_catalog"]'::jsonb and has_function_privilege('authenticated',oid,'execute')=false and has_function_privilege('service_role',oid,'execute')=false) then raise exception 'QuickBooks production helper changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.learn_operator_input_access(uuid,uuid,boolean)') and md5(prosrc)='6b26e22470bfb077e0c61d312c55f713' and pg_get_userbyid(proowner)='postgres' and prosecdef=true and to_jsonb(proconfig) is not distinct from '["search_path=pg_catalog"]'::jsonb and has_function_privilege('authenticated',oid,'execute')=false and has_function_privilege('service_role',oid,'execute')=false) then raise exception 'QuickBooks production helper changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.current_user_is_openfolk_operator(text)') and md5(prosrc)='d36508a666fb4488977dfc202a66b410' and pg_get_userbyid(proowner)='postgres' and prosecdef=true and to_jsonb(proconfig) is not distinct from '["search_path=public"]'::jsonb and has_function_privilege('authenticated',oid,'execute')=true and has_function_privilege('service_role',oid,'execute')=true) then raise exception 'QuickBooks production helper changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.provider_secret_name(uuid,text,text)') and md5(prosrc)='2e19bd2a1c02fecc48090bf9b066ad40' and pg_get_userbyid(proowner)='postgres' and prosecdef=false and to_jsonb(proconfig) is not distinct from '["search_path=\"\""]'::jsonb and has_function_privilege('authenticated',oid,'execute')=false and has_function_privilege('service_role',oid,'execute')=true) then raise exception 'QuickBooks production helper changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.provider_secret_store(uuid,text,text,text)') and md5(prosrc)='9fc619c82fd169f5bfe293d18b994340' and pg_get_userbyid(proowner)='postgres' and prosecdef=true and to_jsonb(proconfig) is not distinct from '["search_path=\"\""]'::jsonb and has_function_privilege('authenticated',oid,'execute')=false and has_function_privilege('service_role',oid,'execute')=true) then raise exception 'QuickBooks production helper changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('vault.create_secret(text,text,text,uuid)') and md5(prosrc)='db64516e2717e986a5f997783b5b9c20' and pg_get_userbyid(proowner)='supabase_admin' and prosecdef=true and to_jsonb(proconfig) is not distinct from '["search_path=\"\""]'::jsonb and has_function_privilege('authenticated',oid,'execute')=false and has_function_privilege('service_role',oid,'execute')=true) then raise exception 'QuickBooks production helper changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') and md5(prosrc)='650d4c4b9939ea49ed73bdb3bfde1d39' and pg_get_userbyid(proowner)='supabase_admin' and prosecdef=true and to_jsonb(proconfig) is not distinct from '["search_path=\"\""]'::jsonb and has_function_privilege('authenticated',oid,'execute')=false and has_function_privilege('service_role',oid,'execute')=true) then raise exception 'QuickBooks production helper changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('auth.uid()') and md5(prosrc)='cdef18c69c4f4cbbced2eaf81e628b49' and pg_get_userbyid(proowner)='supabase_auth_admin' and prosecdef=false and to_jsonb(proconfig) is not distinct from null::jsonb and has_function_privilege('authenticated',oid,'execute')=true and has_function_privilege('service_role',oid,'execute')=true) then raise exception 'QuickBooks production helper changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('auth.role()') and md5(prosrc)='f31486fed08a7402e89d4aa71b0ad273' and pg_get_userbyid(proowner)='supabase_auth_admin' and prosecdef=false and to_jsonb(proconfig) is not distinct from null::jsonb and has_function_privilege('authenticated',oid,'execute')=true and has_function_privilege('service_role',oid,'execute')=true) then raise exception 'QuickBooks production helper changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.learn_import_batch_authority(uuid,uuid)') and md5(prosrc)='8010faf9b8dd341b7eda54d891d7b9b6' and pg_get_userbyid(proowner)='postgres' and prosecdef=false and to_jsonb(proconfig) is not distinct from '["search_path=public, pg_temp"]'::jsonb and has_function_privilege('authenticated',oid,'execute')=false and has_function_privilege('service_role',oid,'execute')=true) then raise exception 'QuickBooks production helper changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.tenants') and attname='id' and not attisdropped and format_type(atttypid,atttypmod)='uuid') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.tenants') and attname='status' and not attisdropped and format_type(atttypid,atttypmod)='text') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.profiles') and attname='id' and not attisdropped and format_type(atttypid,atttypmod)='uuid') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.profiles') and attname='tenant_id' and not attisdropped and format_type(atttypid,atttypmod)='uuid') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.profiles') and attname='role' and not attisdropped and format_type(atttypid,atttypmod)='text') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.customer_cards') and attname='id' and not attisdropped and format_type(atttypid,atttypmod)='uuid') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.customer_cards') and attname='tenant_id' and not attisdropped and format_type(atttypid,atttypmod)='uuid') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.platform_authority_grants') and attname='profile_id' and not attisdropped and format_type(atttypid,atttypmod)='uuid') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.platform_authority_grants') and attname='permission' and not attisdropped and format_type(atttypid,atttypmod)='text') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.platform_authority_grants') and attname='effective_from' and not attisdropped and format_type(atttypid,atttypmod)='timestamp with time zone') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.platform_authority_grants') and attname='effective_to' and not attisdropped and format_type(atttypid,atttypmod)='timestamp with time zone') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.view_as_context') and attname='actor_user_id' and not attisdropped and format_type(atttypid,atttypmod)='uuid') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.view_as_context') and attname='ended_at' and not attisdropped and format_type(atttypid,atttypmod)='timestamp with time zone') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.view_as_context') and attname='expires_at' and not attisdropped and format_type(atttypid,atttypmod)='timestamp with time zone') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.feature_flags') and attname='tenant_id' and not attisdropped and format_type(atttypid,atttypmod)='uuid') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.feature_flags') and attname='flag' and not attisdropped and format_type(atttypid,atttypmod)='text') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.feature_flags') and attname='value' and not attisdropped and format_type(atttypid,atttypmod)='jsonb') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('auth.users') and attname='id' and not attisdropped and format_type(atttypid,atttypmod)='uuid') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('auth.users') and attname='deleted_at' and not attisdropped and format_type(atttypid,atttypmod)='timestamp with time zone') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('auth.users') and attname='banned_until' and not attisdropped and format_type(atttypid,atttypmod)='timestamp with time zone') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('vault.decrypted_secrets') and attname='id' and not attisdropped and format_type(atttypid,atttypmod)='uuid') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('vault.decrypted_secrets') and attname='name' and not attisdropped and format_type(atttypid,atttypmod)='text') then raise exception 'QuickBooks production column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('vault.decrypted_secrets') and attname='decrypted_secret' and not attisdropped and format_type(atttypid,atttypmod)='text') then raise exception 'QuickBooks production column changed';end if;
if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'learn_quickbooks_%') or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'learn_quickbooks_%') then raise exception 'QuickBooks production objects already exist';end if;
end $guard$;
-- Additive QuickBooks connection foundation. No apps, grants, credentials, flags,
-- provider requests or schedules are created by installation.

create table public.learn_quickbooks_apps (
 id uuid primary key,
 environment text not null check(environment in ('sandbox','production')),
 client_id text not null check(length(client_id) between 1 and 256 and client_id ~ '^[A-Za-z0-9_-]+$'),
 redirect_uri text not null check(redirect_uri ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/[^?#[:space:]]+$'),
 client_secret_id uuid not null,
 active boolean not null default true,
 revision bigint not null default 1,
 created_at timestamptz not null default clock_timestamp(),
 unique(environment,client_id)
);
create table public.learn_quickbooks_connections (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 environment text not null check(environment in ('sandbox','production')),
 app_id uuid not null references public.learn_quickbooks_apps(id),
 realm_id text check(realm_id ~ '^[1-9][0-9]{0,29}$'),
 company_name text,
 status text not null check(status in ('authorizing','awaiting_confirmation','paused','active','authentication_required','disconnected')),
 revision bigint not null default 1,
 token_generation bigint not null default 0,
 token_secret_id uuid,
 access_expires_at timestamptz,
 refresh_expires_at timestamptz,
 refresh_hard_expires_at timestamptz,
 verified_at timestamptz,
 confirmed_at timestamptz,
 confirmed_by uuid references public.profiles(id),
 refresh_lease uuid,
 refresh_lease_until timestamptz,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(id,tenant_id),
 unique(tenant_id,environment,realm_id)
);
create table public.learn_quickbooks_authorizations (
 id uuid primary key,
 tenant_id uuid not null,
 connection_id uuid not null,
 actor_id uuid not null references public.profiles(id),
 app_id uuid not null references public.learn_quickbooks_apps(id),
 app_revision bigint not null,
 connection_revision bigint not null,
 state_hash text not null unique check(state_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','exchanging','complete','failed')),
 claim_id uuid,
 claim_until timestamptz,
 finished_at timestamptz,
 failure_code text,
 token_digest text,
 reason text not null check(length(btrim(reason)) between 1 and 1000),
 foreign key(connection_id,tenant_id) references public.learn_quickbooks_connections(id,tenant_id)
);
create table public.learn_quickbooks_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 connection_id uuid not null,
 actor_id uuid references public.profiles(id),
 event text not null,
 detail jsonb not null default '{}',
 created_at timestamptz not null default clock_timestamp(),
 foreign key(connection_id,tenant_id) references public.learn_quickbooks_connections(id,tenant_id)
);
create trigger learn_quickbooks_event_immutable before update or delete on public.learn_quickbooks_events
 for each row execute function public.learn_operator_input_immutable();
do $$declare t text;begin
 foreach t in array array['learn_quickbooks_apps','learn_quickbooks_connections','learn_quickbooks_authorizations','learn_quickbooks_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

-- Callback has no user JWT. Revalidate the recorded actor's actual authority;
-- never fabricate auth.uid(), change profiles or impersonate the operator.
create function public.learn_quickbooks_actor_access(p_tenant uuid,p_actor uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$begin
 if current_setting('transaction_isolation')<>'read committed' or p_tenant is null or p_actor is null then
  raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 perform 1 from public.profiles where id=p_actor for share;
 if not found then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 perform 1 from auth.users where id=p_actor and deleted_at is null
  and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 perform 1 from public.platform_authority_grants where profile_id=p_actor
  and permission='platform.controlplane.admin'
  and coalesce(effective_from,'-infinity')<=clock_timestamp()
  and coalesce(effective_to,'infinity')>clock_timestamp() for share;
 if not found then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 if exists(select 1 from public.view_as_context where actor_user_id=p_actor and ended_at is null
  and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'quickbooks_preview_forbidden' using errcode='42501';end if;
end $$;

-- Operations-only app provisioning; app identity is independent of a tenant.
-- Rotation keeps environment/client/redirect immutable; a changed registration
-- gets a new ID and requires reauthorisation. Increment revision fences old flows.
create function public.learn_quickbooks_register_app(p_id uuid,p_environment text,p_client_id text,p_redirect_uri text,p_secret text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare a public.learn_quickbooks_apps%rowtype;s uuid;begin
 if auth.role() is distinct from 'service_role' then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 if p_id is null or p_environment is null or p_environment not in ('sandbox','production')
  or p_client_id is null or length(p_client_id) not between 1 and 256 or p_client_id!~'^[A-Za-z0-9_-]+$'
  or p_redirect_uri is null or p_redirect_uri!~'^https://[A-Za-z0-9.-]+(:[0-9]+)?/[^?#[:space:]]+$'
  or p_secret is null or length(p_secret) not between 1 and 16384 or p_secret!~'^[!-~]+$' then raise exception 'quickbooks_config_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-app:'||p_id::text,0));
 select * into a from public.learn_quickbooks_apps where id=p_id for update;
 if found then
  if (a.environment,a.client_id,a.redirect_uri) is distinct from (p_environment,p_client_id,p_redirect_uri) then
   raise exception 'quickbooks_app_identity_changed' using errcode='PT409';end if;
  perform vault.update_secret(a.client_secret_id,p_secret,'quickbooks_app:'||p_id::text);
  update public.learn_quickbooks_apps set revision=revision+1,active=true where id=p_id;
 else
  s:=vault.create_secret(p_secret,'quickbooks_app:'||p_id::text,'QuickBooks app secret');
  insert into public.learn_quickbooks_apps(id,environment,client_id,redirect_uri,client_secret_id)
   values(p_id,p_environment,p_client_id,p_redirect_uri,s);
 end if;
end $$;

-- User RPC persists the hashed state before the server returns an Intuit URL.
-- Same request and state are replayable without making another authorisation.
create function public.learn_quickbooks_begin(p_tenant uuid,p_connection uuid,p_app uuid,p_request uuid,p_state_hash text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a public.learn_quickbooks_apps%rowtype;c public.learn_quickbooks_connections%rowtype;r public.learn_quickbooks_authorizations%rowtype;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 if p_connection is null or p_app is null or p_request is null or p_state_hash is null or p_state_hash!~'^[0-9a-f]{64}$'
  or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'quickbooks_request_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-request:'||p_request::text,0));
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-connection:'||p_connection::text,0));
 select * into a from public.learn_quickbooks_apps where id=p_app and active for share;
 if not found then raise exception 'quickbooks_app_unavailable' using errcode='55000';end if;
 select * into r from public.learn_quickbooks_authorizations where id=p_request;
 if found then
  if (r.tenant_id,r.connection_id,r.app_id,r.actor_id,r.state_hash,r.reason)
   is distinct from (p_tenant,p_connection,p_app,auth.uid(),p_state_hash,p_reason)
   or r.status<>'pending' or r.expires_at<=clock_timestamp() or r.app_revision<>a.revision then
   raise exception 'quickbooks_request_conflict' using errcode='PT409';end if;
  perform 1 from public.learn_quickbooks_connections where id=p_connection and revision=r.connection_revision and status='authorizing';
  if not found then raise exception 'quickbooks_request_conflict' using errcode='PT409';end if;
 else
  select * into c from public.learn_quickbooks_connections where id=p_connection for update;
  if found then
   if c.tenant_id<>p_tenant or c.environment<>a.environment then raise exception 'quickbooks_connection_mismatch' using errcode='PT409';end if;
   -- Keep the original realm even on app migration. New authorisation fences
   -- old workers, pending callbacks and token-refresh leases immediately.
   update public.learn_quickbooks_connections set status='authorizing',revision=revision+1,
    refresh_lease=null,refresh_lease_until=null,confirmed_at=null,confirmed_by=null,updated_at=clock_timestamp()
    where id=p_connection returning * into c;
  else
   insert into public.learn_quickbooks_connections(id,tenant_id,environment,app_id,status,created_by)
    values(p_connection,p_tenant,a.environment,p_app,'authorizing',auth.uid()) returning * into c;
  end if;
  insert into public.learn_quickbooks_authorizations(id,tenant_id,connection_id,actor_id,app_id,app_revision,connection_revision,state_hash,expires_at,reason)
   values(p_request,p_tenant,p_connection,auth.uid(),p_app,a.revision,c.revision,p_state_hash,clock_timestamp()+interval '10 minutes',p_reason) returning * into r;
  insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event,detail)
   values(p_tenant,p_connection,auth.uid(),'authorization_started',jsonb_build_object('request_id',p_request,'reason',p_reason));
 end if;
 return jsonb_build_object('tenantId',p_tenant,'connectionId',p_connection,'actorId',auth.uid(),'createdAt',r.created_at,'expiresAt',r.expires_at,
  'app',jsonb_build_object('registrationId',a.id,'clientId',a.client_id,'environment',a.environment,'redirectUri',a.redirect_uri));
end $$;

-- Single consumer. Raw OAuth state and authorization codes are never stored.
create function public.learn_quickbooks_claim(p_state_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_authorizations%rowtype;a public.learn_quickbooks_apps%rowtype;c public.learn_quickbooks_connections%rowtype;secret text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 select * into r from public.learn_quickbooks_authorizations where state_hash=p_state_hash for update;
 if not found or r.status<>'pending' or r.expires_at<=clock_timestamp() then raise exception 'quickbooks_authorization_invalid' using errcode='22023';end if;
 perform public.learn_quickbooks_actor_access(r.tenant_id,r.actor_id);
 select * into a from public.learn_quickbooks_apps where id=r.app_id and active and revision=r.app_revision for share;
 if not found then raise exception 'quickbooks_app_changed' using errcode='PT409';end if;
 select * into c from public.learn_quickbooks_connections where id=r.connection_id and tenant_id=r.tenant_id for update;
 if not found or c.revision<>r.connection_revision or c.status<>'authorizing' then raise exception 'quickbooks_connection_changed' using errcode='PT409';end if;
 select decrypted_secret into secret from vault.decrypted_secrets where id=a.client_secret_id and name='quickbooks_app:'||a.id::text;
 if secret is null then raise exception 'quickbooks_credential_unavailable' using errcode='55000';end if;
 update public.learn_quickbooks_authorizations set status='exchanging',claim_id=gen_random_uuid(),claim_until=clock_timestamp()+interval '2 minutes'
  where id=r.id returning * into r;
 return jsonb_build_object('requestId',r.id,'claimId',r.claim_id,'claimUntil',r.claim_until,
  'tenantId',r.tenant_id,'connectionId',r.connection_id,'actorId',r.actor_id,'expectedRealmId',c.realm_id,
  'createdAt',r.created_at,'expiresAt',r.expires_at,'clientSecret',secret,
  'app',jsonb_build_object('registrationId',a.id,'clientId',a.client_id,'environment',a.environment,'redirectUri',a.redirect_uri));
end $$;

create function public.learn_quickbooks_claim_current(p_request uuid,p_claim uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_authorizations%rowtype;begin
 if auth.role() is distinct from 'service_role' then return false;end if;
 select * into r from public.learn_quickbooks_authorizations where id=p_request and claim_id=p_claim and status='exchanging' and claim_until>clock_timestamp();
 if not found then return false;end if;
 perform public.learn_quickbooks_actor_access(r.tenant_id,r.actor_id);
 return exists(select 1 from public.learn_quickbooks_connections c join public.learn_quickbooks_apps a on a.id=r.app_id
  where c.id=r.connection_id and c.tenant_id=r.tenant_id and c.status='authorizing' and c.revision=r.connection_revision and a.active and a.revision=r.app_revision);
 exception when sqlstate '42501' then return false;
end $$;

create function public.learn_quickbooks_validate_pair(p_pair jsonb) returns void
language plpgsql set search_path=pg_catalog as $$
declare ax timestamptz;rx timestamptz;hx timestamptz;begin
 if jsonb_typeof(p_pair) is distinct from 'object' or not p_pair ?& array['accessToken','refreshToken','accessExpiresAt','refreshExpiresAt','refreshHardExpiresAt']
  or (p_pair-array['accessToken','refreshToken','accessExpiresAt','refreshExpiresAt','refreshHardExpiresAt'])<>'{}'
  or jsonb_typeof(p_pair->'accessToken') is distinct from 'string' or length(p_pair->>'accessToken') not between 1 and 16384 or p_pair->>'accessToken'!~'^[!-~]+$'
  or jsonb_typeof(p_pair->'refreshToken') is distinct from 'string' or length(p_pair->>'refreshToken') not between 1 and 16384 or p_pair->>'refreshToken'!~'^[!-~]+$'
  or jsonb_typeof(p_pair->'accessExpiresAt') is distinct from 'string' or jsonb_typeof(p_pair->'refreshExpiresAt') is distinct from 'string'
  or jsonb_typeof(p_pair->'refreshHardExpiresAt') not in ('string','null') then raise exception 'quickbooks_token_invalid' using errcode='22023';end if;
 ax:=(p_pair->>'accessExpiresAt')::timestamptz;rx:=(p_pair->>'refreshExpiresAt')::timestamptz;hx:=(p_pair->>'refreshHardExpiresAt')::timestamptz;
 if not isfinite(ax) or not isfinite(rx) or ax<=clock_timestamp() or rx<=clock_timestamp()
  or ax>clock_timestamp()+interval '10 years' or rx>clock_timestamp()+interval '10 years'
  or (hx is not null and (not isfinite(hx) or hx<=clock_timestamp() or hx>clock_timestamp()+interval '10 years')) then
  raise exception 'quickbooks_token_invalid' using errcode='22023';end if;
 exception when invalid_datetime_format or datetime_field_overflow then raise exception 'quickbooks_token_invalid' using errcode='22023';
end $$;

-- Verified request path supplies realm; CompanyInfo.Id is an entity ID, not
-- assumed to equal the OAuth realm. Human confirmation precedes any import.
create function public.learn_quickbooks_finish(p_request uuid,p_claim uuid,p_realm text,p_company_name text,p_pair jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_authorizations%rowtype;c public.learn_quickbooks_connections%rowtype;s uuid;d text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 select * into r from public.learn_quickbooks_authorizations where id=p_request and claim_id=p_claim for update;
 if not found then raise exception 'quickbooks_authorization_invalid' using errcode='22023';end if;
 d:=encode(sha256(convert_to(p_pair::text,'UTF8')),'hex');
 if r.status='complete' and r.token_digest=d then return jsonb_build_object('state','saved','connectionId',r.connection_id);end if;
 if not public.learn_quickbooks_claim_current(p_request,p_claim) then raise exception 'quickbooks_authorization_changed' using errcode='PT409';end if;
 select * into c from public.learn_quickbooks_connections where id=r.connection_id for update;
 -- Recheck after locking in case a concurrent pause/reconnect won the lock.
 if c.revision<>r.connection_revision or c.status<>'authorizing' then raise exception 'quickbooks_connection_changed' using errcode='PT409';end if;
 perform 1 from public.learn_quickbooks_apps where id=r.app_id and active and revision=r.app_revision for share;
 if not found then raise exception 'quickbooks_app_changed' using errcode='PT409';end if;
 if p_realm is null or p_realm!~'^[1-9][0-9]{0,29}$' or (c.realm_id is not null and c.realm_id<>p_realm)
  or p_company_name is null or length(btrim(p_company_name)) not between 1 and 1024 then
  raise exception 'quickbooks_company_mismatch' using errcode='22023';end if;
 perform public.learn_quickbooks_validate_pair(p_pair);
 if not public.learn_quickbooks_claim_current(p_request,p_claim) then raise exception 'quickbooks_authorization_changed' using errcode='PT409';end if;
 s:=public.provider_secret_store(c.tenant_id,'quickbooks',c.id::text||':tokens',p_pair::text);
 update public.learn_quickbooks_connections set app_id=r.app_id,realm_id=p_realm,company_name=p_company_name,status='awaiting_confirmation',
  token_secret_id=s,token_generation=token_generation+1,access_expires_at=(p_pair->>'accessExpiresAt')::timestamptz,
  refresh_expires_at=(p_pair->>'refreshExpiresAt')::timestamptz,refresh_hard_expires_at=(p_pair->>'refreshHardExpiresAt')::timestamptz,
  verified_at=clock_timestamp(),updated_at=clock_timestamp() where id=c.id;
 update public.learn_quickbooks_authorizations set status='complete',finished_at=clock_timestamp(),token_digest=d where id=r.id;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event,detail)
  values(c.tenant_id,c.id,r.actor_id,'company_verified',jsonb_build_object('request_id',p_request,'app_id',r.app_id));
 return jsonb_build_object('state','saved','connectionId',c.id);
end $$;

create function public.learn_quickbooks_fail(p_request uuid,p_claim uuid,p_code text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_authorizations%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 if p_code is null or p_code not in ('authorization_invalid','company_mismatch','authentication_required','rate_limited','provider_unavailable','outcome_unknown') then
  raise exception 'quickbooks_failure_invalid' using errcode='22023';end if;
 select * into r from public.learn_quickbooks_authorizations where id=p_request and claim_id=p_claim for update;
 if not found or r.status<>'exchanging' then return;end if;
 update public.learn_quickbooks_authorizations set status='failed',failure_code=p_code,finished_at=clock_timestamp() where id=r.id;
 update public.learn_quickbooks_connections set status='authentication_required',updated_at=clock_timestamp()
  where id=r.connection_id and revision=r.connection_revision and status='authorizing';
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event,detail)
  values(r.tenant_id,r.connection_id,r.actor_id,'authorization_failed',jsonb_build_object('request_id',r.id,'code',p_code));
end $$;

-- Authenticated operator read; never returns secrets, state hashes or claim IDs.
create function public.learn_quickbooks_status(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'appId',c.app_id,'environment',c.environment,'realmId',c.realm_id,
  'companyName',c.company_name,'status',case when c.status='authorizing' and not exists(select 1 from public.learn_quickbooks_authorizations r where r.connection_id=c.id
   and r.connection_revision=c.revision and ((r.status='pending' and r.expires_at>clock_timestamp()) or (r.status='exchanging' and r.claim_until>clock_timestamp()))) then 'authentication_required' else c.status end,
  'revision',c.revision,'verifiedAt',c.verified_at,'confirmedAt',c.confirmed_at,'accessExpiresAt',c.access_expires_at,
  'refreshExpiresAt',c.refresh_expires_at,'refreshInProgress',c.refresh_lease is not null and c.refresh_lease_until>clock_timestamp()) order by c.created_at),'[]') into result
 from public.learn_quickbooks_connections c where c.tenant_id=p_tenant;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event)
  select p_tenant,id,auth.uid(),'status_read' from public.learn_quickbooks_connections where tenant_id=p_tenant;
 return jsonb_build_object('tenantId',p_tenant,'checkedAt',clock_timestamp(),'connections',result,
  'apps',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'environment',environment)),'[]') from public.learn_quickbooks_apps where active));
end $$;

-- Confirm a provider-verified company. Remains paused until a separately scoped
-- capture request is supplied. Pause fences every pending callback/refresh.
create function public.learn_quickbooks_control(p_tenant uuid,p_connection uuid,p_revision bigint,p_action text,p_realm text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.learn_quickbooks_connections%rowtype;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 if p_action is null or p_action not in ('confirm','pause') or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
  raise exception 'quickbooks_request_invalid' using errcode='22023';end if;
 select * into c from public.learn_quickbooks_connections where id=p_connection and tenant_id=p_tenant for update;
 if not found or c.revision is distinct from p_revision then raise exception 'quickbooks_connection_changed' using errcode='PT409';end if;
 if p_action='confirm' and (c.status<>'awaiting_confirmation' or c.realm_id is distinct from p_realm or c.verified_at is null or c.token_secret_id is null) then
  raise exception 'quickbooks_company_unverified' using errcode='22023';end if;
 -- Retain any refresh lease as an uncertainty fence. Clearing it here could
 -- resend an old refresh token after the in-flight exchange already rotated it.
 update public.learn_quickbooks_connections set status='paused',revision=revision+1,
  confirmed_at=case when p_action='confirm' then clock_timestamp() else confirmed_at end,
  confirmed_by=case when p_action='confirm' then auth.uid() else confirmed_by end,updated_at=clock_timestamp() where id=c.id returning * into c;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event,detail)
  values(p_tenant,c.id,auth.uid(),p_action,jsonb_build_object('reason',p_reason,'revision',c.revision));
 return jsonb_build_object('id',c.id,'status',c.status,'revision',c.revision);
end $$;

-- Service refresh lease: an expired/uncertain exchange is NOT automatically
-- retried. It requires reconnect rather than sending a possibly rotated token.
create function public.learn_quickbooks_refresh_acquire(p_tenant uuid,p_connection uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare c public.learn_quickbooks_connections%rowtype;a public.learn_quickbooks_apps%rowtype;pair jsonb;secret text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 select * into c from public.learn_quickbooks_connections where id=p_connection and tenant_id=p_tenant for update;
 if not found or c.status not in ('paused','active') or c.confirmed_at is null then raise exception 'quickbooks_connection_unavailable' using errcode='55000';end if;
 if c.refresh_lease is not null then
  if c.refresh_lease_until>clock_timestamp() then return jsonb_build_object('state','busy');end if;
  update public.learn_quickbooks_connections set status='authentication_required',revision=revision+1,updated_at=clock_timestamp() where id=c.id;
  return jsonb_build_object('state','authentication_required');
 end if;
 if c.refresh_expires_at is null or c.refresh_expires_at<=clock_timestamp() or c.refresh_hard_expires_at<=clock_timestamp() then
  update public.learn_quickbooks_connections set status='authentication_required',revision=revision+1,updated_at=clock_timestamp() where id=c.id;
  return jsonb_build_object('state','authentication_required');
 end if;
 if c.access_expires_at>clock_timestamp()+interval '5 minutes' then return jsonb_build_object('state','current');end if;
 select * into a from public.learn_quickbooks_apps where id=c.app_id and active for share;
 if not found then raise exception 'quickbooks_app_unavailable' using errcode='55000';end if;
 select decrypted_secret into secret from vault.decrypted_secrets where id=a.client_secret_id and name='quickbooks_app:'||a.id::text;
 select decrypted_secret::jsonb into pair from vault.decrypted_secrets where id=c.token_secret_id
  and name=public.provider_secret_name(c.tenant_id,'quickbooks',c.id::text||':tokens');
 if secret is null or pair->>'refreshToken' is null then raise exception 'quickbooks_credential_unavailable' using errcode='55000';end if;
 update public.learn_quickbooks_connections set refresh_lease=gen_random_uuid(),refresh_lease_until=clock_timestamp()+interval '2 minutes' where id=c.id returning * into c;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,event,detail)
  values(p_tenant,c.id,'refresh_started',jsonb_build_object('generation',c.token_generation));
 return jsonb_build_object('state','ready','leaseId',c.refresh_lease,'leaseUntil',c.refresh_lease_until,'revision',c.revision,'generation',c.token_generation,
  'clientId',a.client_id,'clientSecret',secret,'refreshToken',pair->>'refreshToken');
end $$;
create function public.learn_quickbooks_refresh_finish(p_tenant uuid,p_connection uuid,p_lease uuid,p_generation bigint,p_revision bigint,p_pair jsonb)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare c public.learn_quickbooks_connections%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 select * into c from public.learn_quickbooks_connections where id=p_connection and tenant_id=p_tenant for update;
 if not found or p_lease is null or c.refresh_lease is distinct from p_lease or c.refresh_lease_until<=clock_timestamp()
  or c.token_generation is distinct from p_generation or c.revision is distinct from p_revision or c.status not in ('paused','active') then
  raise exception 'quickbooks_refresh_changed' using errcode='PT409';end if;
 perform 1 from public.learn_quickbooks_apps where id=c.app_id and active for share;
 if not found then raise exception 'quickbooks_app_unavailable' using errcode='55000';end if;
 perform public.learn_quickbooks_validate_pair(p_pair);
 -- One Vault document and metadata transaction: never save half a token pair.
 perform public.provider_secret_store(c.tenant_id,'quickbooks',c.id::text||':tokens',p_pair::text);
 update public.learn_quickbooks_connections set token_generation=token_generation+1,refresh_lease=null,refresh_lease_until=null,
  access_expires_at=(p_pair->>'accessExpiresAt')::timestamptz,refresh_expires_at=(p_pair->>'refreshExpiresAt')::timestamptz,
  refresh_hard_expires_at=coalesce((p_pair->>'refreshHardExpiresAt')::timestamptz,c.refresh_hard_expires_at),updated_at=clock_timestamp() where id=c.id;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,event,detail)
  values(p_tenant,c.id,'refresh_saved',jsonb_build_object('generation',c.token_generation+1));
end $$;

do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'learn_quickbooks_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
grant execute on function public.learn_quickbooks_begin(uuid,uuid,uuid,uuid,text,text),public.learn_quickbooks_status(uuid),
 public.learn_quickbooks_control(uuid,uuid,bigint,text,text,text) to authenticated;
grant execute on function public.learn_quickbooks_register_app(uuid,text,text,text,text),public.learn_quickbooks_claim(text),
 public.learn_quickbooks_claim_current(uuid,uuid),public.learn_quickbooks_finish(uuid,uuid,text,text,jsonb),public.learn_quickbooks_fail(uuid,uuid,text),
 public.learn_quickbooks_refresh_acquire(uuid,uuid),public.learn_quickbooks_refresh_finish(uuid,uuid,uuid,bigint,bigint,jsonb) to service_role;


-- Durable, bounded QuickBooks query traversal. No schedules, flags or imports
-- are enabled by installing this migration. Retained pages preserve exact JSON
-- numbers; source identity excludes the replaceable app/connection registration.

create table public.learn_quickbooks_imports (
 id uuid primary key,
 tenant_id uuid not null,
 connection_id uuid not null,
 connection_revision bigint not null,
 actor_id uuid not null references public.profiles(id),
 definition jsonb not null,
 environment text not null,
 realm_id text not null,
 entities text[] not null,
 entity_index integer not null default 1,
 start_position integer not null default 1,
 page_size integer not null check(page_size between 1 and 1000),
 minor_version integer not null check(minor_version between 1 and 1000),
 max_requests integer not null check(max_requests between 1 and 10000),
 requests_used integer not null default 0,
 pages_saved integer not null default 0,
 records_observed bigint not null default 0,
 attempts_at_position integer not null default 0,
 state text not null default 'queued' check(state in ('queued','running','traversed','paused','failed','limit_reached')),
 last_error text,
 lease_id uuid,
 lease_until timestamptz,
 next_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 foreign key(connection_id,tenant_id) references public.learn_quickbooks_connections(id,tenant_id),
 unique(id,tenant_id)
);
create unique index learn_quickbooks_one_running_import on public.learn_quickbooks_imports(connection_id) where state in ('queued','running');
create table public.learn_quickbooks_request_gates (
 environment text not null,realm_id text not null,next_at timestamptz not null,
 primary key(environment,realm_id)
);
create table public.learn_quickbooks_permits (
 id uuid primary key,
 run_id uuid not null,
 tenant_id uuid not null,
 request_number integer not null,
 connection_revision bigint not null,
 entity text not null,
 start_position integer not null,
 page_size integer not null,
 minor_version integer not null,
 issued_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 foreign key(run_id,tenant_id) references public.learn_quickbooks_imports(id,tenant_id),
 unique(run_id,request_number)
);
create table public.learn_quickbooks_pages (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null,
 tenant_id uuid not null,
 permit_id uuid not null unique references public.learn_quickbooks_permits(id),
 raw_envelope text not null,
 envelope_hash text not null,
 records integer not null,
 checkpoint_after jsonb not null,
 saved_at timestamptz not null default clock_timestamp(),
 foreign key(run_id,tenant_id) references public.learn_quickbooks_imports(id,tenant_id)
);
create table public.learn_quickbooks_source_versions (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 environment text not null,
 realm_id text not null,
 entity text not null,
 external_id text not null,
 content_hash text not null,
 payload jsonb not null,
 sync_token numeric not null,
 source_updated_at timestamptz,
 first_seen_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,environment,realm_id,entity,external_id,content_hash)
);
create table public.learn_quickbooks_observations (
 page_id uuid not null references public.learn_quickbooks_pages(id),
 version_id uuid not null references public.learn_quickbooks_source_versions(id),
 ordinal integer not null,
 primary key(page_id,ordinal),unique(page_id,version_id)
);
-- This pointer can advance while versions and observations remain immutable.
create table public.learn_quickbooks_latest (
 tenant_id uuid not null,
 environment text not null,
 realm_id text not null,
 entity text not null,
 external_id text not null,
 version_id uuid not null references public.learn_quickbooks_source_versions(id),
 sync_token numeric not null,
 source_updated_at timestamptz,
 conflicted boolean not null default false,
 last_observed_at timestamptz not null,
 primary key(tenant_id,environment,realm_id,entity,external_id)
);
do $$declare t text;begin
 foreach t in array array['imports','request_gates','permits','pages','source_versions','observations','latest'] loop
  execute format('alter table public.learn_quickbooks_%I enable row level security',t);
  execute format('revoke all on public.learn_quickbooks_%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['permits','pages','source_versions','observations'] loop
  execute format('create trigger retain_rows before update or delete on public.learn_quickbooks_%I for each row execute function public.learn_operator_input_immutable()',t);
  execute format('create trigger retain_all before truncate on public.learn_quickbooks_%I for each statement execute function public.learn_operator_input_immutable()',t);
 end loop;
end $$;

create function public.learn_quickbooks_enabled(p_tenant uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare f text;begin
 foreach f in array array['learn.enabled','learn.inputs.quickbooks.enabled'] loop
  perform 1 from public.feature_flags where tenant_id=p_tenant and flag=f and value='true'::jsonb for share;
  if not found then raise exception 'quickbooks_module_disabled' using errcode='42501';end if;
 end loop;
end $$;
create function public.learn_quickbooks_set_enabled(p_tenant uuid,p_connection uuid,p_enabled boolean,p_reason text) returns void
language plpgsql security definer set search_path=pg_catalog as $$begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 if p_enabled is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'quickbooks_request_invalid' using errcode='22023';end if;
 perform 1 from public.learn_quickbooks_connections where id=p_connection and tenant_id=p_tenant for share;
 if not found then raise exception 'quickbooks_connection_unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-module:'||p_tenant::text,0));
 update public.feature_flags set value=to_jsonb(p_enabled) where tenant_id=p_tenant and flag='learn.inputs.quickbooks.enabled';
 if not found then insert into public.feature_flags(tenant_id,flag,value) values(p_tenant,'learn.inputs.quickbooks.enabled',to_jsonb(p_enabled));end if;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event,detail)
  values(p_tenant,p_connection,auth.uid(),'module_changed',jsonb_build_object('enabled',p_enabled,'reason',p_reason));
end $$;

-- Explicit operator request. Resume copies a retained checkpoint into a fresh
-- bounded approval, never rewrites the prior run or resets captured source data.
create function public.learn_quickbooks_import_start(p_tenant uuid,p_connection uuid,p_request uuid,p_definition jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare c public.learn_quickbooks_connections%rowtype;r public.learn_quickbooks_imports%rowtype;prior public.learn_quickbooks_imports%rowtype;
 entities text[];e text;expires timestamptz;page_size integer;minor integer;budget integer;parent uuid;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 perform public.learn_quickbooks_enabled(p_tenant);
 if p_request is null or jsonb_typeof(p_definition) is distinct from 'object'
  or not p_definition ?& array['entities','pageSize','minorVersion','maxRequests','expiresAt','reason','resumeFrom']
  or (p_definition-array['entities','pageSize','minorVersion','maxRequests','expiresAt','reason','resumeFrom'])<>'{}'
  or jsonb_typeof(p_definition->'entities') is distinct from 'array' or jsonb_array_length(p_definition->'entities') not between 1 and 13
  or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
  or jsonb_typeof(p_definition->'pageSize') is distinct from 'number' or p_definition->>'pageSize'!~'^[0-9]{1,4}$'
  or jsonb_typeof(p_definition->'minorVersion') is distinct from 'number' or p_definition->>'minorVersion'!~'^[0-9]{1,4}$'
  or jsonb_typeof(p_definition->'maxRequests') is distinct from 'number' or p_definition->>'maxRequests'!~'^[0-9]{1,5}$'
  or jsonb_typeof(p_definition->'expiresAt') is distinct from 'string'
  or jsonb_typeof(p_definition->'resumeFrom') not in ('null','string') then raise exception 'quickbooks_import_invalid' using errcode='22023';end if;
 select array_agg(value order by ord) into entities from jsonb_array_elements_text(p_definition->'entities') with ordinality x(value,ord);
 if cardinality(entities)<>(select count(distinct x) from unnest(entities) x) then raise exception 'quickbooks_import_invalid' using errcode='22023';end if;
 foreach e in array entities loop
  if e is null or e not in ('Customer','Invoice','Payment','CreditMemo','SalesReceipt','Estimate','Vendor','Bill','BillPayment','Purchase','VendorCredit','Account','Item') then
   raise exception 'quickbooks_import_entity_invalid' using errcode='22023';end if;
 end loop;
 page_size:=(p_definition->>'pageSize')::integer;minor:=(p_definition->>'minorVersion')::integer;budget:=(p_definition->>'maxRequests')::integer;
 expires:=(p_definition->>'expiresAt')::timestamptz;parent:=(p_definition->>'resumeFrom')::uuid;
 if page_size not between 1 and 1000 or minor not between 1 and 1000 or budget not between 1 and 10000 or not isfinite(expires)
  or expires<=clock_timestamp() or expires>clock_timestamp()+interval '24 hours' then raise exception 'quickbooks_import_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-import:'||p_request::text,0));
 select * into r from public.learn_quickbooks_imports where id=p_request;
 if found then
  if (r.tenant_id,r.connection_id,r.actor_id,r.definition) is distinct from (p_tenant,p_connection,auth.uid(),p_definition) then
   raise exception 'quickbooks_import_conflict' using errcode='PT409';end if;
  return jsonb_build_object('runId',r.id,'state',r.state);
 end if;
 select * into c from public.learn_quickbooks_connections where id=p_connection and tenant_id=p_tenant for update;
 if not found or c.status<>'paused' or c.confirmed_at is null or c.realm_id is null or c.token_secret_id is null then
  raise exception 'quickbooks_company_unconfirmed' using errcode='42501';end if;
 -- Old scope is never silently extended. Superseded/expired work can be resumed
 -- under this new approval after explicit connection confirmation/pausing.
 update public.learn_quickbooks_imports set state='paused',updated_at=clock_timestamp(),last_error='scope_replaced'
  where connection_id=c.id and state in ('queued','running') and (expires_at<=clock_timestamp() or connection_revision<>c.revision);
 if exists(select 1 from public.learn_quickbooks_imports where connection_id=c.id and state in ('queued','running')) then
  raise exception 'quickbooks_import_running' using errcode='PT409';end if;
 if parent is not null then
  select * into prior from public.learn_quickbooks_imports where id=parent and tenant_id=p_tenant and connection_id=c.id for share;
  if not found or prior.environment<>c.environment or prior.realm_id<>c.realm_id or prior.entities<>entities
   or prior.page_size<>page_size or prior.minor_version<>minor or prior.state not in ('paused','failed','limit_reached') then
   raise exception 'quickbooks_resume_invalid' using errcode='PT409';end if;
 end if;
 update public.learn_quickbooks_connections set status='active',revision=revision+1,updated_at=clock_timestamp() where id=c.id returning * into c;
 insert into public.learn_quickbooks_imports(id,tenant_id,connection_id,connection_revision,actor_id,definition,environment,realm_id,entities,
  entity_index,start_position,page_size,minor_version,max_requests,expires_at)
 values(p_request,p_tenant,c.id,c.revision,auth.uid(),p_definition,c.environment,c.realm_id,entities,
  coalesce(prior.entity_index,1),coalesce(prior.start_position,1),page_size,minor,budget,expires) returning * into r;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event,detail)
  values(p_tenant,c.id,auth.uid(),'import_started',jsonb_build_object('runId',r.id,'scope',p_definition));
 return jsonb_build_object('runId',r.id,'state',r.state);
end $$;

create function public.learn_quickbooks_import_access(p_run uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_imports%rowtype;c public.learn_quickbooks_connections%rowtype;begin
 select * into r from public.learn_quickbooks_imports where id=p_run;
 if not found or r.state not in ('queued','running') or r.expires_at<=clock_timestamp() then raise exception 'quickbooks_scope_unavailable' using errcode='42501';end if;
 perform public.learn_quickbooks_actor_access(r.tenant_id,r.actor_id);
 perform public.learn_quickbooks_enabled(r.tenant_id);
 select * into c from public.learn_quickbooks_connections where id=r.connection_id and tenant_id=r.tenant_id for share;
 if not found or c.status<>'active' or c.revision<>r.connection_revision or c.realm_id<>r.realm_id or c.environment<>r.environment or c.confirmed_at is null then
  raise exception 'quickbooks_scope_unavailable' using errcode='42501';end if;
 perform 1 from public.learn_quickbooks_apps where id=c.app_id and active for share;
 if not found then raise exception 'quickbooks_scope_unavailable' using errcode='42501';end if;
end $$;

-- Claim one next page from already approved work. Budget is spent before issuing
-- the credential, including failed/uncertain reads. One lease per run.
create function public.learn_quickbooks_import_acquire(p_run uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_imports%rowtype;c public.learn_quickbooks_connections%rowtype;pair jsonb;gate timestamptz;permit uuid:=gen_random_uuid();begin
 if auth.role() is distinct from 'service_role' or current_setting('transaction_isolation')<>'read committed' then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 select * into r from public.learn_quickbooks_imports where (p_run is null or id=p_run) and state in ('queued','running')
  and next_at<=clock_timestamp() and coalesce(lease_until,'-infinity')<=clock_timestamp()
  order by next_at,created_at,id for update skip locked limit 1;
 if not found then return jsonb_build_object('state','idle');end if;
 begin perform public.learn_quickbooks_import_access(r.id);exception when sqlstate '42501' then
  update public.learn_quickbooks_imports set state='paused',last_error='scope_unavailable',updated_at=clock_timestamp() where id=r.id;
  return jsonb_build_object('state','held');end;
 if r.requests_used>=r.max_requests or r.attempts_at_position>=5 then
  update public.learn_quickbooks_imports set state=case when r.requests_used>=r.max_requests then 'limit_reached' else 'failed' end,
   last_error=case when r.requests_used>=r.max_requests then 'request_budget_reached' else 'attempts_exhausted' end,updated_at=clock_timestamp() where id=r.id;
  update public.learn_quickbooks_connections set status='paused',updated_at=clock_timestamp() where id=r.connection_id and revision=r.connection_revision;
  return jsonb_build_object('state','held');
 end if;
 select * into c from public.learn_quickbooks_connections where id=r.connection_id for share;
 if c.refresh_lease is not null or c.access_expires_at is null or c.access_expires_at<=clock_timestamp()+interval '2 minutes' then
  update public.learn_quickbooks_imports set next_at=clock_timestamp()+interval '2 seconds' where id=r.id;
  return jsonb_build_object('state','refresh_required','runId',r.id,'tenantId',r.tenant_id,'connectionId',c.id);
 end if;
 insert into public.learn_quickbooks_request_gates(environment,realm_id,next_at) values(r.environment,r.realm_id,clock_timestamp()) on conflict do nothing;
 select next_at into gate from public.learn_quickbooks_request_gates where environment=r.environment and realm_id=r.realm_id for update;
 if gate>clock_timestamp() then update public.learn_quickbooks_imports set next_at=gate where id=r.id;return jsonb_build_object('state','waiting');end if;
 select decrypted_secret::jsonb into pair from vault.decrypted_secrets where id=c.token_secret_id
  and name=public.provider_secret_name(r.tenant_id,'quickbooks',c.id::text||':tokens');
 if pair->>'accessToken' is null then raise exception 'quickbooks_credential_unavailable' using errcode='55000';end if;
 update public.learn_quickbooks_request_gates set next_at=clock_timestamp()+interval '1250 milliseconds' where environment=r.environment and realm_id=r.realm_id;
 update public.learn_quickbooks_imports set state='running',lease_id=permit,lease_until=clock_timestamp()+interval '90 seconds',
  requests_used=requests_used+1,attempts_at_position=attempts_at_position+1,updated_at=clock_timestamp() where id=r.id returning * into r;
 insert into public.learn_quickbooks_permits(id,run_id,tenant_id,request_number,connection_revision,entity,start_position,page_size,minor_version,expires_at)
 values(permit,r.id,r.tenant_id,r.requests_used,r.connection_revision,r.entities[r.entity_index],r.start_position,r.page_size,r.minor_version,r.lease_until);
 return jsonb_build_object('state','ready','runId',r.id,'permitId',permit,'expiresAt',r.lease_until,
  'request',jsonb_build_object('tenantId',r.tenant_id,'connectionId',c.id,'environment',r.environment,'realmId',r.realm_id,
   'entity',r.entities[r.entity_index],'startPosition',r.start_position,'pageSize',r.page_size,'minorVersion',r.minor_version),
  'credential',jsonb_build_object('tenantId',r.tenant_id,'connectionId',c.id,'environment',r.environment,'realmId',r.realm_id,'accessToken',pair->>'accessToken','expiresAt',c.access_expires_at));
end $$;
create function public.learn_quickbooks_import_current(p_run uuid,p_permit uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$begin
 if auth.role() is distinct from 'service_role' then return false;end if;
 perform 1 from public.learn_quickbooks_imports where id=p_run and state='running' and lease_id=p_permit and lease_until>clock_timestamp();
 if not found then return false;end if;
 perform public.learn_quickbooks_import_access(p_run);
 return true;
 exception when sqlstate '42501' then return false;
end $$;

create function public.learn_quickbooks_import_commit(p_run uuid,p_permit uuid,p_raw text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_imports%rowtype;p public.learn_quickbooks_permits%rowtype;old public.learn_quickbooks_pages%rowtype;
 body jsonb;q jsonb;items jsonb;item jsonb;n integer;i integer:=0;page uuid:=gen_random_uuid();version uuid;h text;stamp timestamptz;token numeric;next_index integer;next_position integer;next_state text;receipt jsonb;begin
 if auth.role() is distinct from 'service_role' or current_setting('transaction_isolation')<>'read committed' then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 select * into r from public.learn_quickbooks_imports where id=p_run for update;
 if not found then raise exception 'quickbooks_scope_unavailable' using errcode='42501';end if;
 select * into p from public.learn_quickbooks_permits where id=p_permit and run_id=r.id and tenant_id=r.tenant_id;
 if not found then raise exception 'quickbooks_permit_invalid' using errcode='42501';end if;
 if p_raw is null or octet_length(p_raw)>8388608 then raise exception 'quickbooks_page_invalid' using errcode='22023';end if;
 select * into old from public.learn_quickbooks_pages where permit_id=p_permit;
 if found then
  if old.raw_envelope<>p_raw then raise exception 'quickbooks_page_conflict' using errcode='PT409';end if;
  return old.checkpoint_after;
 end if;
 if not public.learn_quickbooks_import_current(r.id,p.id) then raise exception 'quickbooks_scope_unavailable' using errcode='42501';end if;
 body:=p_raw::jsonb;q:=body->'QueryResponse';items:=coalesce(q->p.entity,'[]'::jsonb);
 if jsonb_typeof(body) is distinct from 'object' or body ? 'Fault' or jsonb_typeof(q) is distinct from 'object'
  or (q-array[p.entity,'startPosition','maxResults','totalCount'])<>'{}'
  or jsonb_typeof(body->'time') is distinct from 'string' or not isfinite((body->>'time')::timestamptz)
  or jsonb_typeof(items) is distinct from 'array' then raise exception 'quickbooks_page_invalid' using errcode='22023';end if;
 n:=jsonb_array_length(items);
 if n>p.page_size or (n>0 and (q->>'startPosition' is distinct from p.start_position::text or q->>'maxResults' is distinct from n::text))
  or (q ? 'startPosition' and q->>'startPosition' is distinct from p.start_position::text)
  or (q ? 'maxResults' and q->>'maxResults' is distinct from n::text)
  or n<>(select count(distinct v->>'Id') from jsonb_array_elements(items) v) then raise exception 'quickbooks_page_invalid' using errcode='22023';end if;
 next_index:=r.entity_index+case when n<p.page_size then 1 else 0 end;
 next_position:=case when n<p.page_size then 1 else r.start_position+n end;
 next_state:=case when next_index>cardinality(r.entities) then 'traversed' when r.requests_used>=r.max_requests then 'limit_reached' else 'queued' end;
 receipt:=jsonb_build_object('runId',r.id,'pageId',page,'records',n,'entityIndex',next_index,'startPosition',next_position,'state',next_state,'coverage','non_atomic_query_traversal');
 insert into public.learn_quickbooks_pages(id,run_id,tenant_id,permit_id,raw_envelope,envelope_hash,records,checkpoint_after)
  values(page,r.id,r.tenant_id,p.id,p_raw,encode(sha256(convert_to(p_raw,'UTF8')),'hex'),n,receipt);
 for item in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'Id') is distinct from 'string' or item->>'Id'!~'^[A-Za-z0-9-]{1,128}$'
   or jsonb_typeof(item->'SyncToken') is distinct from 'string' or item->>'SyncToken'!~'^[0-9]{1,64}$' or octet_length(item::text)>1048576 then
   raise exception 'quickbooks_record_invalid' using errcode='22023';end if;
  stamp:=null;
  if item->'MetaData' ? 'LastUpdatedTime' then
   if jsonb_typeof(item->'MetaData'->'LastUpdatedTime') is distinct from 'string' then raise exception 'quickbooks_record_invalid' using errcode='22023';end if;
   stamp:=(item->'MetaData'->>'LastUpdatedTime')::timestamptz;
   if not isfinite(stamp) then raise exception 'quickbooks_record_invalid' using errcode='22023';end if;
  end if;
  h:=encode(sha256(convert_to(item::text,'UTF8')),'hex');token:=(item->>'SyncToken')::numeric;
  insert into public.learn_quickbooks_source_versions(tenant_id,environment,realm_id,entity,external_id,content_hash,payload,sync_token,source_updated_at)
   values(r.tenant_id,r.environment,r.realm_id,p.entity,item->>'Id',h,item,token,stamp) on conflict do nothing returning id into version;
  if version is null then select id into version from public.learn_quickbooks_source_versions where tenant_id=r.tenant_id and environment=r.environment and realm_id=r.realm_id and entity=p.entity and external_id=item->>'Id' and content_hash=h;end if;
  i:=i+1;insert into public.learn_quickbooks_observations(page_id,version_id,ordinal) values(page,version,i);
  insert into public.learn_quickbooks_latest(tenant_id,environment,realm_id,entity,external_id,version_id,sync_token,source_updated_at,last_observed_at)
   values(r.tenant_id,r.environment,r.realm_id,p.entity,item->>'Id',version,token,stamp,clock_timestamp())
   on conflict(tenant_id,environment,realm_id,entity,external_id) do update set
    version_id=case when excluded.sync_token>learn_quickbooks_latest.sync_token then excluded.version_id else learn_quickbooks_latest.version_id end,
    source_updated_at=case when excluded.sync_token>learn_quickbooks_latest.sync_token then excluded.source_updated_at else learn_quickbooks_latest.source_updated_at end,
    conflicted=case when excluded.sync_token>learn_quickbooks_latest.sync_token then false
      else learn_quickbooks_latest.conflicted or excluded.version_id<>learn_quickbooks_latest.version_id end,
    sync_token=excluded.sync_token,last_observed_at=excluded.last_observed_at
   where excluded.sync_token>=learn_quickbooks_latest.sync_token;
 end loop;
 -- Refresh current authority after payload validation; all pointer/checkpoint
 -- updates roll back if a switch, permission or lease has changed.
 if not public.learn_quickbooks_import_current(r.id,p.id) then raise exception 'quickbooks_scope_unavailable' using errcode='42501';end if;
 update public.learn_quickbooks_imports set entity_index=next_index,start_position=next_position,state=next_state,lease_id=null,lease_until=null,
  pages_saved=pages_saved+1,records_observed=records_observed+n,attempts_at_position=0,last_error=null,
  next_at=clock_timestamp()+interval '1250 milliseconds',updated_at=clock_timestamp() where id=r.id;
 if next_state in ('traversed','limit_reached') then
  update public.learn_quickbooks_connections set status='paused',updated_at=clock_timestamp() where id=r.connection_id and revision=r.connection_revision;
 end if;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event,detail)
  values(r.tenant_id,r.connection_id,r.actor_id,'page_saved',receipt);
 return receipt;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  raise exception 'quickbooks_page_invalid' using errcode='22023';
end $$;

create function public.learn_quickbooks_import_fail(p_run uuid,p_permit uuid,p_code text,p_retry_seconds integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_imports%rowtype;prior jsonb;retry boolean;next_state text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 select * into r from public.learn_quickbooks_imports where id=p_run for update;
 select checkpoint_after into prior from public.learn_quickbooks_pages where run_id=p_run and permit_id=p_permit;
 if found then return prior;end if;
 if r.id is null or r.lease_id is distinct from p_permit or p_permit is null or r.state<>'running' then return jsonb_build_object('state','unconfirmed');end if;
 if p_code is null or p_code not in ('authentication_required','access_denied','rate_limited','provider_unavailable','provider_rejected','invalid_response','response_too_large','transport_unavailable','authority_unavailable','reservation_unavailable','persistence_unconfirmed')
  or p_retry_seconds is null or p_retry_seconds not between 0 and 31536000 then raise exception 'quickbooks_failure_invalid' using errcode='22023';end if;
 retry:=p_code in ('rate_limited','provider_unavailable','transport_unavailable','persistence_unconfirmed') and r.attempts_at_position<5 and r.requests_used<r.max_requests and r.expires_at>clock_timestamp();
 next_state:=case when retry then 'queued' when r.requests_used>=r.max_requests then 'limit_reached' else 'failed' end;
 update public.learn_quickbooks_imports set state=next_state,lease_id=null,lease_until=null,last_error=p_code,
  next_at=clock_timestamp()+make_interval(secs=>greatest(p_retry_seconds,60)),updated_at=clock_timestamp() where id=r.id;
 if p_code='rate_limited' then
  update public.learn_quickbooks_request_gates set next_at=greatest(next_at,clock_timestamp()+make_interval(secs=>greatest(p_retry_seconds,60))) where environment=r.environment and realm_id=r.realm_id;
 end if;
 if not retry then update public.learn_quickbooks_connections set status=case when p_code='authentication_required' then 'authentication_required' else 'paused' end,updated_at=clock_timestamp()
  where id=r.connection_id and revision=r.connection_revision;end if;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event,detail)
  values(r.tenant_id,r.connection_id,r.actor_id,'import_attention',jsonb_build_object('runId',r.id,'code',p_code,'state',next_state));
 return jsonb_build_object('runId',r.id,'state',next_state);
end $$;

create function public.learn_quickbooks_import_status(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare runs jsonb;counts jsonb;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 select coalesce(jsonb_agg(x.row order by x.created_at desc),'[]') into runs from (
  select created_at,jsonb_build_object('id',id,'connectionId',connection_id,'definition',definition,'state',state,'entity',entities[entity_index],
   'entityIndex',entity_index,'startPosition',start_position,'requestsUsed',requests_used,'maxRequests',max_requests,'pagesSaved',pages_saved,
   'recordsObserved',records_observed,'lastError',last_error,'expiresAt',expires_at,'updatedAt',updated_at,'coverage','non_atomic_query_traversal') row
  from public.learn_quickbooks_imports where tenant_id=p_tenant order by created_at desc limit 30
 ) x;
 select coalesce(jsonb_agg(x.row),'[]') into counts from (
  select jsonb_build_object('environment',environment,'realmId',realm_id,'entity',entity,'records',count(*),'conflictedRecords',count(*) filter(where conflicted),'lastObservedAt',max(last_observed_at)) row
  from public.learn_quickbooks_latest where tenant_id=p_tenant group by environment,realm_id,entity
 ) x;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event)
  select p_tenant,id,auth.uid(),'import_status_read' from public.learn_quickbooks_connections where tenant_id=p_tenant;
 return jsonb_build_object('tenantId',p_tenant,'checkedAt',clock_timestamp(),
  'enabled',(select value from public.feature_flags where tenant_id=p_tenant and flag='learn.inputs.quickbooks.enabled'),
  'learnEnabled',(select value from public.feature_flags where tenant_id=p_tenant and flag='learn.enabled'),'runs',runs,'counts',counts);
end $$;
revoke all on function public.learn_quickbooks_enabled(uuid),public.learn_quickbooks_import_access(uuid),
 public.learn_quickbooks_set_enabled(uuid,uuid,boolean,text),public.learn_quickbooks_import_start(uuid,uuid,uuid,jsonb),
 public.learn_quickbooks_import_acquire(uuid),public.learn_quickbooks_import_current(uuid,uuid),public.learn_quickbooks_import_commit(uuid,uuid,text),
 public.learn_quickbooks_import_fail(uuid,uuid,text,integer),public.learn_quickbooks_import_status(uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_set_enabled(uuid,uuid,boolean,text),public.learn_quickbooks_import_start(uuid,uuid,uuid,jsonb),public.learn_quickbooks_import_status(uuid) to authenticated;
grant execute on function public.learn_quickbooks_import_acquire(uuid),public.learn_quickbooks_import_current(uuid,uuid),public.learn_quickbooks_import_commit(uuid,uuid,text),public.learn_quickbooks_import_fail(uuid,uuid,text,integer) to service_role;


-- Explicit customer identity review and retained financial evidence. No imports,
-- automatic matching, credentials, access grants or provider writes are seeded.

create table public.learn_quickbooks_customer_links (
 tenant_id uuid not null references public.tenants(id),
 environment text not null check(environment in ('sandbox','production')),
 realm_id text not null,
 external_id text not null,
 card_id uuid references public.customer_cards(id),
 reviewed_version uuid not null references public.learn_quickbooks_source_versions(id),
 identity jsonb not null,
 revision bigint not null check(revision>0),
 reviewed_by uuid not null references public.profiles(id),
 reviewed_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,environment,realm_id,external_id)
);
create index learn_quickbooks_customer_card on public.learn_quickbooks_customer_links(tenant_id,card_id,environment);
create table public.learn_quickbooks_finance_events (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),event text not null,
 detail jsonb not null,reason text,created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_quickbooks_customer_links enable row level security;
alter table public.learn_quickbooks_finance_events enable row level security;
revoke all on public.learn_quickbooks_customer_links,public.learn_quickbooks_finance_events from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.learn_quickbooks_finance_events for each row execute function public.learn_operator_input_immutable();
create trigger retain_all before truncate on public.learn_quickbooks_finance_events for each statement execute function public.learn_operator_input_immutable();

-- Compare identity, not mutable accounting balances. Missing fields remain
-- distinct from supplied values; no fuzzy/name-only identity matching.
create function public.learn_quickbooks_customer_identity(p jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(p)
 where key in ('Id','DisplayName','FullyQualifiedName','CompanyName','GivenName','FamilyName',
  'PrimaryEmailAddr','PrimaryPhone','Mobile','BillAddr','ShipAddr','ParentRef','Job','Active')
$$;
create function public.learn_quickbooks_money(p jsonb) returns numeric
language sql immutable set search_path=pg_catalog as $$
 select case when jsonb_typeof(p)='number' and length(p#>>'{}')<=80
  and p#>>'{}' ~ '^-?[0-9]+(\.[0-9]+)?$' then (p#>>'{}')::numeric end
$$;
create function public.learn_quickbooks_finance_access(p_tenant uuid,p_reason text) returns void
language plpgsql security definer set search_path=pg_catalog as $$begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then
  raise exception 'quickbooks_finance_forbidden' using errcode='42501';end if;
 if p_reason is not null then
  if length(btrim(p_reason)) not between 3 and 500 then raise exception 'quickbooks_reason_invalid' using errcode='22023';end if;
  perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 else perform public.learn_import_batch_authority(p_tenant,auth.uid());end if;
 perform 1 from auth.users where id=auth.uid() and deleted_at is null
  and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception 'quickbooks_finance_forbidden' using errcode='42501';end if;
 perform public.learn_quickbooks_enabled(p_tenant);
end $$;

-- Operator-only candidate listing. Exact version IDs are returned for review;
-- the client cannot substitute an older identity when saving a link.
create function public.learn_quickbooks_customer_candidates(p_tenant uuid,p_environment text,p_reason text,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare entries jsonb;next_id uuid;audit uuid;begin
 if p_reason is null or p_environment is null or p_environment not in ('sandbox','production') then
  raise exception 'quickbooks_request_invalid' using errcode='22023';end if;
 perform public.learn_quickbooks_finance_access(p_tenant,p_reason);
 with page as materialized(
  select v.id,l.realm_id,l.external_id,l.conflicted,l.last_observed_at,v.payload,k.card_id,coalesce(k.revision,0) revision
  from public.learn_quickbooks_latest l join public.learn_quickbooks_source_versions v on v.id=l.version_id
  left join public.learn_quickbooks_customer_links k on (k.tenant_id,k.environment,k.realm_id,k.external_id)=(l.tenant_id,l.environment,l.realm_id,l.external_id)
  where l.tenant_id=p_tenant and l.environment=p_environment and l.entity='Customer'
   and (p_after is null or v.id>p_after) order by v.id limit 26
 ),shown as(select * from page order by id limit 25)
 select coalesce((select jsonb_agg(jsonb_build_object('version_id',id,'realm_id',realm_id,'external_id',external_id,
  'name',left(coalesce(payload->>'FullyQualifiedName',payload->>'DisplayName','Unnamed customer'),500),
  'email',left(payload#>>'{PrimaryEmailAddr,Address}',500),'phone',left(payload#>>'{PrimaryPhone,FreeFormNumber}',200),
  'address',left((payload->'BillAddr')::text,2000),'parent_id',left(payload#>>'{ParentRef,value}',200),
  'conflicted',conflicted,'last_observed_at',last_observed_at,'card_id',card_id,'revision',revision::text) order by id) from shown),'[]'::jsonb),
  case when (select count(*) from page)>25 then (select id from shown order by id desc limit 1) end into entries,next_id;
 perform public.learn_quickbooks_finance_access(p_tenant,p_reason);
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'customers.read',jsonb_build_object('environment',p_environment,'after',p_after,'versions',
  (select coalesce(jsonb_agg(x->'version_id'),'[]'::jsonb) from jsonb_array_elements(entries)x)),btrim(p_reason)) returning id into audit;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','quickbooks-customers/1','tenant_id',p_tenant,'actor_id',auth.uid(),
  'environment',p_environment,'after',p_after,'rows',entries,'next_after',next_id,'observed_at',clock_timestamp(),'audit_id',audit);
end $$;

-- Revision check supports reviewed correction/unlinking without overwriting a
-- concurrent decision. A null card unlinks; retained audit/history stay intact.
create function public.learn_quickbooks_customer_link(p_tenant uuid,p_version uuid,p_card uuid,p_revision bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.learn_quickbooks_source_versions%rowtype;k public.learn_quickbooks_customer_links%rowtype;rev bigint;audit uuid;begin
 if p_reason is null or p_revision is null or p_revision<0 then raise exception 'quickbooks_request_invalid' using errcode='22023';end if;
 perform public.learn_quickbooks_finance_access(p_tenant,p_reason);
 select s.* into v from public.learn_quickbooks_source_versions s join public.learn_quickbooks_latest l
  on l.version_id=s.id and l.tenant_id=s.tenant_id and l.entity=s.entity and l.environment=s.environment and l.realm_id=s.realm_id and l.external_id=s.external_id
  where s.id=p_version and s.tenant_id=p_tenant and s.entity='Customer' and not l.conflicted for share of l;
 if not found then raise exception 'quickbooks_customer_review_required' using errcode='40001';end if;
 if p_card is not null then
  perform 1 from public.customer_cards where id=p_card and tenant_id=p_tenant for share;
  if not found then raise exception 'quickbooks_card_unavailable' using errcode='42501';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-customer:'||p_tenant::text||':'||v.environment||':'||v.realm_id||':'||v.external_id,0));
 select * into k from public.learn_quickbooks_customer_links where (tenant_id,environment,realm_id,external_id)=(p_tenant,v.environment,v.realm_id,v.external_id) for update;
 if coalesce(k.revision,0)<>p_revision then raise exception 'quickbooks_link_changed' using errcode='40001';end if;
 rev:=p_revision+1;
 insert into public.learn_quickbooks_customer_links(tenant_id,environment,realm_id,external_id,card_id,reviewed_version,identity,revision,reviewed_by)
 values(p_tenant,v.environment,v.realm_id,v.external_id,p_card,v.id,public.learn_quickbooks_customer_identity(v.payload),rev,auth.uid())
 on conflict(tenant_id,environment,realm_id,external_id) do update set card_id=excluded.card_id,reviewed_version=excluded.reviewed_version,
  identity=excluded.identity,revision=excluded.revision,reviewed_by=excluded.reviewed_by,reviewed_at=clock_timestamp();
 perform public.learn_quickbooks_finance_access(p_tenant,p_reason);
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'customer.link',jsonb_build_object('environment',v.environment,'realm_id',v.realm_id,'external_id',v.external_id,
  'version_id',v.id,'previous_card',k.card_id,'card_id',p_card,'revision',rev::text),btrim(p_reason)) returning id into audit;
 return jsonb_build_object('revision',rev::text,'audit_id',audit);
end $$;

create function public.learn_quickbooks_customer_finance(p_tenant uuid,p_card uuid,p_environment text default 'production',p_after uuid default null,p_operator_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare entries jsonb;totals jsonb;next_id uuid;record_count bigint;link_count bigint;review_count bigint;conflicts bigint;audit uuid;begin
 if p_environment is null or p_environment not in ('sandbox','production') then raise exception 'quickbooks_request_invalid' using errcode='22023';end if;
 perform public.learn_quickbooks_finance_access(p_tenant,p_operator_reason);
 perform 1 from public.customer_cards where id=p_card and tenant_id=p_tenant for share;
 if not found then raise exception 'quickbooks_card_unavailable' using errcode='42501';end if;
 with links as materialized(
  select k.*,l.conflicted is false and public.learn_quickbooks_customer_identity(v.payload)=k.identity as current_identity
  from public.learn_quickbooks_customer_links k left join public.learn_quickbooks_latest l
   on (l.tenant_id,l.environment,l.realm_id,l.external_id)=(k.tenant_id,k.environment,k.realm_id,k.external_id) and l.entity='Customer'
  left join public.learn_quickbooks_source_versions v on v.id=l.version_id
  where k.tenant_id=p_tenant and k.card_id=p_card and k.environment=p_environment
 ),matched as materialized(
  select l.version_id,l.realm_id,l.entity,l.external_id,l.conflicted,l.last_observed_at,v.source_updated_at,v.payload,
   case when v.payload#>>'{CurrencyRef,value}' ~ '^[A-Z]{3}$' then v.payload#>>'{CurrencyRef,value}' end currency,
   public.learn_quickbooks_money(v.payload->'TotalAmt') amount,public.learn_quickbooks_money(v.payload->'Balance') balance
  from links k join public.learn_quickbooks_latest l on l.tenant_id=k.tenant_id and l.environment=k.environment and l.realm_id=k.realm_id
  join public.learn_quickbooks_source_versions v on v.id=l.version_id
  where k.current_identity and l.entity in ('Invoice','Payment','CreditMemo','SalesReceipt','Estimate') and v.payload#>>'{CustomerRef,value}'=k.external_id
 ),usable as materialized(select * from matched where not conflicted),
 page as(select * from usable where p_after is null or version_id>p_after order by version_id limit 26),
 shown as(select * from page order by version_id limit 25),
 grouped as(
  select realm_id,currency,entity,count(*) records,count(*) filter(where amount is null) missing_amounts,
   count(*) filter(where entity='Invoice' and balance is null) missing_balances,
   case when currency is not null and count(*) filter(where amount is null)=0 then sum(amount)::text end total,
   case when entity='Invoice' and currency is not null and count(*) filter(where balance is null)=0 then sum(balance)::text end outstanding,
   min(last_observed_at) oldest_observation,max(last_observed_at) newest_observation
  from usable group by realm_id,currency,entity
 )
 select coalesce((select jsonb_agg(jsonb_build_object('version_id',version_id,'realm_id',realm_id,'entity',entity,'external_id',external_id,
  'document_number',left(payload->>'DocNumber',200),'transaction_date',left(payload->>'TxnDate',32),'due_date',left(payload->>'DueDate',32),
  'currency',currency,'amount',amount::text,'balance',case when entity='Invoice' then balance::text end,
  'source_updated_at',source_updated_at,'last_observed_at',last_observed_at) order by version_id) from shown),'[]'::jsonb),
  coalesce((select jsonb_agg(to_jsonb(g) order by realm_id,currency nulls last,entity) from grouped g),'[]'::jsonb),
  case when (select count(*) from page)>25 then (select version_id from shown order by version_id desc limit 1) end,
  (select count(*) from usable),(select count(*) from links),(select count(*) from links where current_identity is not true),
  (select count(*) from matched where conflicted)
 into entries,totals,next_id,record_count,link_count,review_count,conflicts;
 perform public.learn_quickbooks_finance_access(p_tenant,p_operator_reason);
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'customer.finance.read',jsonb_build_object('card_id',p_card,'environment',p_environment,'after',p_after,
  'versions',(select coalesce(jsonb_agg(x->'version_id'),'[]'::jsonb) from jsonb_array_elements(entries)x),'records',record_count),p_operator_reason) returning id into audit;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','quickbooks-customer-finance/1','tenant_id',p_tenant,'actor_id',auth.uid(),'card_id',p_card,
  'environment',p_environment,'operator_mode',p_operator_reason is not null,'after',p_after,'rows',entries,'groups',totals,'next_after',next_id,
  'records',record_count,'linked_customers',link_count,'links_needing_review',review_count,'conflicted_records',conflicts,
  'coverage','retained_unreconciled_records','observed_at',clock_timestamp(),'audit_id',audit);
end $$;

revoke all on function public.learn_quickbooks_customer_identity(jsonb),public.learn_quickbooks_money(jsonb),
 public.learn_quickbooks_finance_access(uuid,text),public.learn_quickbooks_customer_candidates(uuid,text,text,uuid),
 public.learn_quickbooks_customer_link(uuid,uuid,uuid,bigint,text),public.learn_quickbooks_customer_finance(uuid,uuid,text,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_customer_candidates(uuid,text,text,uuid),
 public.learn_quickbooks_customer_link(uuid,uuid,uuid,bigint,text),public.learn_quickbooks_customer_finance(uuid,uuid,text,uuid,text) to authenticated;


-- Stop local capture before revoking the app's QuickBooks grant. Uncertain
-- provider outcomes remain visible and never silently permit reconnection.

create table public.learn_quickbooks_disconnections (
 id uuid primary key,tenant_id uuid not null,connection_id uuid not null,
 actor_id uuid not null references public.profiles(id),reason text not null,
 connection_revision bigint not null,app_revision bigint not null,token_generation bigint not null,
 state text not null check(state in ('queued','revoking','revoked','manual_review','reviewed')),
 code text,lease_id uuid,lease_until timestamptz,
 created_at timestamptz not null default clock_timestamp(),finished_at timestamptz,
 foreign key(connection_id,tenant_id) references public.learn_quickbooks_connections(id,tenant_id)
);
create unique index learn_quickbooks_one_disconnect on public.learn_quickbooks_disconnections(connection_id) where state not in ('revoked','reviewed');
alter table public.learn_quickbooks_disconnections enable row level security;
revoke all on public.learn_quickbooks_disconnections from public,anon,authenticated,service_role;

-- The existing OAuth and operator controls cannot revive a connection while a
-- revoke request could still be in flight or requires provider-side review.
create function public.learn_quickbooks_disconnect_fence() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-app-grant:'||new.app_id::text,0));
 if new.status<>'disconnected' and exists(select 1 from public.learn_quickbooks_disconnections d
  join public.learn_quickbooks_connections c on c.id=d.connection_id
  where d.state not in ('revoked','reviewed') and (d.connection_id=new.id or
   (c.app_id=new.app_id and (new.status='authorizing' or (c.realm_id=new.realm_id and c.environment=new.environment))))) then
  raise exception 'quickbooks_disconnect_unresolved' using errcode='55000';end if;
 return new;
end $$;
create trigger learn_quickbooks_disconnect_fence before insert or update on public.learn_quickbooks_connections for each row execute function public.learn_quickbooks_disconnect_fence();

-- New OAuth exchanges do not know the provider realm yet. Briefly fence new
-- exchanges for this app while a revoke remains unsettled. Other realms' existing
-- captures continue. Pending states cannot slip into an exchange after the fence.
create function public.learn_quickbooks_disconnect_authorization_fence() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
 if new.status in ('pending','exchanging') then
  perform pg_advisory_xact_lock(hashtextextended('quickbooks-app-grant:'||new.app_id::text,0));
  if exists(select 1 from public.learn_quickbooks_disconnections d join public.learn_quickbooks_connections c on c.id=d.connection_id
   where c.app_id=new.app_id and d.state not in ('revoked','reviewed')) then
   raise exception 'quickbooks_disconnect_unresolved' using errcode='55000';end if;
 end if;
 return new;
end $$;
create trigger learn_quickbooks_disconnect_authorization_fence before insert or update on public.learn_quickbooks_authorizations for each row execute function public.learn_quickbooks_disconnect_authorization_fence();

create function public.learn_quickbooks_disconnect_request(p_tenant uuid,p_connection uuid,p_request uuid,p_revision bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.learn_quickbooks_connections%rowtype;d public.learn_quickbooks_disconnections%rowtype;a public.learn_quickbooks_apps%rowtype;review text;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 if p_request is null or p_revision is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
  raise exception 'quickbooks_request_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-disconnect:'||p_request::text,0));
 -- Lock app before connection, consistent with authorisation starts.
 select a0.* into a from public.learn_quickbooks_apps a0 join public.learn_quickbooks_connections c0 on c0.app_id=a0.id
  where c0.id=p_connection and c0.tenant_id=p_tenant for share of a0;
 perform 1 from public.learn_quickbooks_imports where connection_id=p_connection and tenant_id=p_tenant and state in ('queued','running') order by id for update;
 select * into c from public.learn_quickbooks_connections where id=p_connection and tenant_id=p_tenant for update;
 if not found then raise exception 'quickbooks_connection_unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-app-grant:'||c.app_id::text,0));
 select * into d from public.learn_quickbooks_disconnections where id=p_request;
 if found then
  if (d.tenant_id,d.connection_id,d.actor_id,d.reason,d.connection_revision) is distinct from
   (p_tenant,p_connection,auth.uid(),p_reason,p_revision+1) then raise exception 'quickbooks_disconnect_conflict' using errcode='PT409';end if;
  return jsonb_build_object('id',d.id,'connectionId',d.connection_id,'state',d.state,'localCaptureStopped',true);
 end if;
 if c.revision<>p_revision or exists(select 1 from public.learn_quickbooks_disconnections where connection_id=c.id and state not in ('revoked','reviewed')) then
  raise exception 'quickbooks_connection_changed' using errcode='PT409';end if;
 -- In-flight exchanges may have issued credentials we did not save. Do not
 -- falsely claim that revoking the older saved token settles those exchanges.
 if c.refresh_lease is not null or exists(select 1 from public.learn_quickbooks_authorizations where (app_id=c.app_id or connection_id=c.id) and status='exchanging') then review:='exchange_uncertain';
 elsif c.token_secret_id is null or c.realm_id is null then review:='no_saved_token';
 elsif exists(select 1 from public.learn_quickbooks_connections where id<>c.id and app_id=c.app_id and environment=c.environment and realm_id=c.realm_id
  and (status<>'disconnected' or refresh_lease is not null)) then review:='shared_provider_grant';
 end if;
 update public.learn_quickbooks_connections set status='disconnected',revision=revision+1,confirmed_at=null,confirmed_by=null,updated_at=clock_timestamp()
  where id=c.id returning * into c;
 insert into public.learn_quickbooks_disconnections(id,tenant_id,connection_id,actor_id,reason,connection_revision,app_revision,token_generation,state,code)
 values(p_request,p_tenant,c.id,auth.uid(),p_reason,c.revision,a.revision,c.token_generation,case when review is null then 'queued' else 'manual_review' end,review) returning * into d;
 -- Keep retained pages/checkpoints, but do not leave a queued run looking active.
 update public.learn_quickbooks_imports set state='paused',updated_at=clock_timestamp() where connection_id=c.id and state in ('queued','running');
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event,detail)
 values(p_tenant,c.id,auth.uid(),'disconnect_requested',jsonb_build_object('request_id',d.id,'reason',p_reason,'state',d.state,'code',review));
 return jsonb_build_object('id',d.id,'connectionId',c.id,'state',d.state,'localCaptureStopped',true);
end $$;

-- Service-only credential release is single-use. A caller retry inspects the
-- durable state; it never sends a second provider request automatically.
create function public.learn_quickbooks_disconnect_acquire(p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.learn_quickbooks_disconnections%rowtype;c public.learn_quickbooks_connections%rowtype;a public.learn_quickbooks_apps%rowtype;pair jsonb;secret text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 select * into d from public.learn_quickbooks_disconnections where id=p_request for update;
 if not found then raise exception 'quickbooks_disconnect_unavailable' using errcode='42501';end if;
 perform public.learn_quickbooks_actor_access(d.tenant_id,d.actor_id);
 if d.state='revoking' and d.lease_until<=clock_timestamp() then
  update public.learn_quickbooks_disconnections set state='manual_review',code='outcome_unknown' where id=d.id returning * into d;
 end if;
 if d.state<>'queued' then return jsonb_build_object('state',d.state);end if;
 select * into c from public.learn_quickbooks_connections where id=d.connection_id and tenant_id=d.tenant_id for update;
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-app-grant:'||c.app_id::text,0));
 select * into a from public.learn_quickbooks_apps where id=c.app_id for share;
 if c.status<>'disconnected' or c.revision<>d.connection_revision or c.token_generation<>d.token_generation or a.revision<>d.app_revision
  or exists(select 1 from public.learn_quickbooks_connections where id<>c.id and app_id=c.app_id and environment=c.environment and realm_id=c.realm_id and status<>'disconnected') then
  update public.learn_quickbooks_disconnections set state='manual_review',code='connection_changed' where id=d.id;
  return jsonb_build_object('state','manual_review');end if;
 select decrypted_secret into secret from vault.decrypted_secrets where id=a.client_secret_id and name='quickbooks_app:'||a.id::text;
 select decrypted_secret::jsonb into pair from vault.decrypted_secrets where id=c.token_secret_id and name=public.provider_secret_name(c.tenant_id,'quickbooks',c.id::text||':tokens');
 if secret is null or pair->>'refreshToken' is null then
  update public.learn_quickbooks_disconnections set state='manual_review',code='credential_unavailable' where id=d.id;
  return jsonb_build_object('state','manual_review');end if;
 update public.learn_quickbooks_disconnections set state='revoking',lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes' where id=d.id returning * into d;
 return jsonb_build_object('state','ready','requestId',d.id,'leaseId',d.lease_id,'leaseUntil',d.lease_until,
  'clientId',a.client_id,'clientSecret',secret,'refreshToken',pair->>'refreshToken');
end $$;

create function public.learn_quickbooks_disconnect_current(p_request uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$declare d public.learn_quickbooks_disconnections%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 select * into d from public.learn_quickbooks_disconnections where id=p_request and lease_id=p_lease and state='revoking' and lease_until>clock_timestamp();
 if not found then return false;end if;
 perform public.learn_quickbooks_actor_access(d.tenant_id,d.actor_id);
 return exists(select 1 from public.learn_quickbooks_connections c join public.learn_quickbooks_apps a on a.id=c.app_id
  where c.id=d.connection_id and c.tenant_id=d.tenant_id and c.status='disconnected'
  and c.revision=d.connection_revision and c.token_generation=d.token_generation and a.revision=d.app_revision);
end $$;

create function public.learn_quickbooks_disconnect_finish(p_request uuid,p_lease uuid,p_revoked boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare d public.learn_quickbooks_disconnections%rowtype;c public.learn_quickbooks_connections%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 select * into d from public.learn_quickbooks_disconnections where id=p_request for update;
 if not found or p_lease is null or d.lease_id is distinct from p_lease or p_revoked is null then raise exception 'quickbooks_disconnect_unavailable' using errcode='42501';end if;
 if d.state='revoked' and p_revoked then return jsonb_build_object('state','revoked');end if;
 if d.state<>'revoking' or d.lease_until<=clock_timestamp() then raise exception 'quickbooks_disconnect_expired' using errcode='55000';end if;
 select * into c from public.learn_quickbooks_connections where id=d.connection_id and tenant_id=d.tenant_id for update;
 if c.status<>'disconnected' or c.revision<>d.connection_revision or c.token_generation<>d.token_generation then raise exception 'quickbooks_connection_changed' using errcode='PT409';end if;
 -- Even if the initiating user's grant has since ended, a service receipt must
 -- record a revoke that was already sent, without restoring capture or access.
 if p_revoked then
  perform vault.update_secret(c.token_secret_id,'{}',public.provider_secret_name(c.tenant_id,'quickbooks',c.id::text||':tokens'));
  update public.learn_quickbooks_connections set token_secret_id=null,access_expires_at=null,refresh_expires_at=null,refresh_hard_expires_at=null,
   refresh_lease=null,refresh_lease_until=null,updated_at=clock_timestamp() where id=c.id;
 end if;
 update public.learn_quickbooks_disconnections set state=case when p_revoked then 'revoked' else 'manual_review' end,
  code=case when p_revoked then null else 'outcome_unknown' end,finished_at=clock_timestamp() where id=d.id returning * into d;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,event,detail)
 values(d.tenant_id,c.id,'disconnect_finished',jsonb_build_object('request_id',d.id,'state',d.state));
 return jsonb_build_object('state',d.state);
end $$;

-- An explicit operator attestation after checking the provider's connected-apps
-- page resolves an uncertain revoke. This is distinguished from an API receipt.
-- No automatic retries and no claim that ServiceOS independently verified it.
create function public.learn_quickbooks_disconnect_review(p_tenant uuid,p_request uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare d public.learn_quickbooks_disconnections%rowtype;c public.learn_quickbooks_connections%rowtype;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 if p_reason is null or length(btrim(p_reason)) not between 20 and 1000 then raise exception 'quickbooks_review_required' using errcode='22023';end if;
 select * into d from public.learn_quickbooks_disconnections where id=p_request and tenant_id=p_tenant for update;
 if not found then raise exception 'quickbooks_disconnect_unavailable' using errcode='42501';end if;
 if d.state not in ('manual_review','queued') and not(d.state='revoking' and d.lease_until<=clock_timestamp()) then
  raise exception 'quickbooks_review_unavailable' using errcode='55000';end if;
 select * into c from public.learn_quickbooks_connections where id=d.connection_id and tenant_id=p_tenant for update;
 if c.status<>'disconnected' or c.revision<>d.connection_revision then raise exception 'quickbooks_connection_changed' using errcode='PT409';end if;
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-app-grant:'||c.app_id::text,0));
 if exists(select 1 from public.learn_quickbooks_authorizations where (app_id=c.app_id or connection_id=c.id) and status='exchanging' and claim_until>clock_timestamp())
  or c.refresh_lease_until>clock_timestamp() then raise exception 'quickbooks_exchange_in_progress' using errcode='55000';end if;
 if exists(select 1 from public.learn_quickbooks_connections where id<>c.id and app_id=c.app_id and environment=c.environment and realm_id=c.realm_id and status<>'disconnected') then
  raise exception 'quickbooks_shared_grant_unresolved' using errcode='55000';end if;
 if c.token_secret_id is not null then
  perform vault.update_secret(c.token_secret_id,'{}',public.provider_secret_name(c.tenant_id,'quickbooks',c.id::text||':tokens'));end if;
 update public.learn_quickbooks_connections set token_secret_id=null,access_expires_at=null,refresh_expires_at=null,refresh_hard_expires_at=null,
  refresh_lease=null,refresh_lease_until=null,updated_at=clock_timestamp() where id=c.id;
 update public.learn_quickbooks_disconnections set state='reviewed',code='operator_verified_provider_disconnect',finished_at=clock_timestamp() where id=d.id;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event,detail)
 values(p_tenant,c.id,auth.uid(),'disconnect_reviewed',jsonb_build_object('request_id',d.id,'reason',p_reason));
 return jsonb_build_object('state','reviewed');
end $$;

create function public.learn_quickbooks_disconnect_status(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$declare entries jsonb;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'connectionId',connection_id,
  'requestRevision',connection_revision-1,'reason',reason,'actorId',actor_id,
  'state',case when state='revoking' and lease_until<=clock_timestamp() then 'manual_review' else state end,
  'code',case when state='revoking' and lease_until<=clock_timestamp() then 'outcome_unknown' else code end,
  'createdAt',created_at,'finishedAt',finished_at) order by created_at desc),'[]') into entries
 from (select distinct on(connection_id) * from public.learn_quickbooks_disconnections where tenant_id=p_tenant order by connection_id,created_at desc,id desc)d;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event)
 select p_tenant,id,auth.uid(),'disconnect_status_read' from public.learn_quickbooks_connections where tenant_id=p_tenant;
 return jsonb_build_object('tenantId',p_tenant,'requests',entries);
end $$;
revoke all on function public.learn_quickbooks_disconnect_fence(),public.learn_quickbooks_disconnect_authorization_fence(),public.learn_quickbooks_disconnect_request(uuid,uuid,uuid,bigint,text),
 public.learn_quickbooks_disconnect_current(uuid,uuid),public.learn_quickbooks_disconnect_review(uuid,uuid,text),
 public.learn_quickbooks_disconnect_acquire(uuid),public.learn_quickbooks_disconnect_finish(uuid,uuid,boolean),public.learn_quickbooks_disconnect_status(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_disconnect_request(uuid,uuid,uuid,bigint,text),public.learn_quickbooks_disconnect_status(uuid),public.learn_quickbooks_disconnect_review(uuid,uuid,text) to authenticated;
grant execute on function public.learn_quickbooks_disconnect_acquire(uuid),public.learn_quickbooks_disconnect_finish(uuid,uuid,boolean),public.learn_quickbooks_disconnect_current(uuid,uuid) to service_role;


create table public.learn_quickbooks_release_receipts(release_id text primary key,source_hashes jsonb not null,installed_at timestamptz not null default clock_timestamp());
alter table public.learn_quickbooks_release_receipts enable row level security;
revoke all on public.learn_quickbooks_release_receipts from public,anon,authenticated,service_role;
insert into public.learn_quickbooks_release_receipts(release_id,source_hashes) values('quickbooks_production_v1','[{"name":"20261102000000_learn_quickbooks_oauth.sql","sha256":"344c2530955bb86a90fe7943060026661c9a8b68be467aa9f7c213afba50d046"},{"name":"20261102010000_learn_quickbooks_import.sql","sha256":"d801ba6a45af0570dd47312e8fb35552e3dfd085c130e7f5e7b3b5f9835e342c"},{"name":"20261102020000_learn_quickbooks_customer_finance.sql","sha256":"d6b7c742b7520533ebdd0f1b5ce956fd91a7c37f75065a2a0abf692c84666a0f"},{"name":"20261102030000_learn_quickbooks_disconnect.sql","sha256":"5a75324ea900a06d4bfb31edae26d85e0d9bc00eab80a4d1c2fb4d7014fb2e18"}]'::jsonb);
notify pgrst,'reload schema';
commit;
