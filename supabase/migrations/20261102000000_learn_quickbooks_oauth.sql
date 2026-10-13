-- Additive QuickBooks connection foundation. No apps, grants, credentials, flags,
-- provider requests or schedules are created by installation.
begin;
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
commit;
