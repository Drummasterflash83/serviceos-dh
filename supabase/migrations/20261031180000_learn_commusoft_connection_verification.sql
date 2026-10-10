-- Explicit, bounded access checks. No imports, switches, schedules or provider
-- calls on installation. Provider payloads are never retained by this protocol.
begin;
create table public.learn_commusoft_verification_requests (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),
 definition jsonb not null,
 binding jsonb,
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create table public.learn_commusoft_verification_permits (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique references public.learn_commusoft_verification_requests(id),
 credential_fingerprint text not null references public.learn_business_input_request_gates(credential_fingerprint),
 send_before timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create table public.learn_commusoft_verification_results (
 request_id uuid primary key references public.learn_commusoft_verification_requests(id),
 observation_code text,
 retry_at timestamptz,
 receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_commusoft_verification_requests enable row level security;
alter table public.learn_commusoft_verification_permits enable row level security;
alter table public.learn_commusoft_verification_results enable row level security;
revoke all on public.learn_commusoft_verification_requests,public.learn_commusoft_verification_permits,
 public.learn_commusoft_verification_results from public,anon,authenticated,service_role;
create trigger learn_commusoft_verification_request_immutable before update or delete on public.learn_commusoft_verification_requests
 for each row execute function public.learn_operator_input_immutable();
create trigger learn_commusoft_verification_permit_immutable before update or delete on public.learn_commusoft_verification_permits
 for each row execute function public.learn_operator_input_immutable();
create trigger learn_commusoft_verification_result_immutable before update or delete on public.learn_commusoft_verification_results
 for each row execute function public.learn_operator_input_immutable();

-- Internal helpers have no API grants. Service authority comes from the retained
-- authenticated request, never a caller-supplied actor or credential binding.
create function public.learn_commusoft_verification_binding(c public.provider_connections) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('connection_id',c.id,'revision',c.updated_at,'region',c.non_secret_config->>'region',
 'account_key',c.non_secret_config->>'account_key','secret_id',c.secret_refs->>'api_key');
$$;
create function public.learn_commusoft_verification_authority(r public.learn_commusoft_verification_requests)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare c public.provider_connections%rowtype;
begin
 if current_setting('transaction_isolation')<>'read committed' or r.binding is null or r.expires_at<=clock_timestamp() then return false;end if;
 perform 1 from public.profiles where id=r.actor_id for share;
 if not found then return false;end if;
 perform 1 from public.platform_authority_grants where profile_id=r.actor_id and permission='platform.controlplane.admin'
  and coalesce(effective_from,'-infinity')<=clock_timestamp() and coalesce(effective_to,'infinity')>clock_timestamp() for share;
 if not found then return false;end if;
 if exists(select 1 from public.view_as_context where actor_user_id=r.actor_id and ended_at is null
  and (expires_at is null or expires_at>clock_timestamp())) then return false;end if;
 perform 1 from public.tenants where id=r.tenant_id and status='active' for share;
 if not found then return false;end if;
 if exists(select 1 from public.platform_jobs where tenant_id=r.tenant_id and job_type='commusoft.source_sync' and status in ('queued','running','retrying')) then return false;end if;
 select * into c from public.provider_connections where id=(r.definition->>'connection_id')::uuid and tenant_id=r.tenant_id for share;
 if not found or c.provider is distinct from 'commusoft' or c.status is distinct from 'configured'
  or c.auth_mode is distinct from 'private_api_key' or c.revoked_at is not null
  or not coalesce('api_key'=any(c.configured_fields),false)
  or coalesce(c.non_secret_config->>'region','') not in ('uk','us')
  or nullif(btrim(c.non_secret_config->>'account_key'),'') is null
  or public.learn_commusoft_verification_binding(c) is distinct from r.binding then return false;end if;
 perform 1 from vault.secrets where id::text=c.secret_refs->>'api_key'
  and name='provider_secret:'||r.tenant_id::text||':commusoft:api_key' for share;
 if not found then return false;end if;
 return r.expires_at>clock_timestamp();
end $$;
create function public.learn_commusoft_verification_receipt(p_tenant uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_commusoft_verification_requests%rowtype; receipt jsonb;
begin
 select * into r from public.learn_commusoft_verification_requests where id=p_request and tenant_id=p_tenant;
 if not found then return jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','pending');end if;
 select x.receipt into receipt from public.learn_commusoft_verification_results x where request_id=r.id;
 if found then return receipt;end if;
 return jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state',
  case when r.expires_at<=clock_timestamp() then 'expired'
  when exists(select 1 from public.learn_commusoft_verification_permits where request_id=r.id) then 'running' else 'approved' end,
  'expires_at',r.expires_at);
end $$;

create function public.learn_commusoft_verify_request(p_tenant uuid,p_request uuid,p_actor uuid,p_definition jsonb,p_mode text default 'apply')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_commusoft_verification_requests%rowtype;c public.provider_connections%rowtype;receipt jsonb;revision timestamptz;connection uuid;
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_mode is null or p_mode not in ('apply','check','cancel')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>10000
  or not p_definition ?& array['kind','reason','connection_id','revision','one_read_confirmed']
  or (p_definition-array['kind','reason','connection_id','revision','one_read_confirmed'])<>'{}'::jsonb
  or p_definition->>'kind' is distinct from 'verify_commusoft'
  or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
  or jsonb_typeof(p_definition->'connection_id') is distinct from 'string'
  or jsonb_typeof(p_definition->'revision') is distinct from 'string'
  or p_definition->'one_read_confirmed' is distinct from 'true'::jsonb then
  raise exception 'learn_verification_definition_invalid' using errcode='22023';end if;
 connection:=(p_definition->>'connection_id')::uuid;revision:=(p_definition->>'revision')::timestamptz;
 if not isfinite(revision) then raise exception 'learn_verification_revision_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-verification-request:'||p_request::text,0));
 select * into r from public.learn_commusoft_verification_requests where id=p_request;
 if found and (r.tenant_id<>p_tenant or r.actor_id<>p_actor or r.definition<>p_definition) then
  raise exception 'learn_verification_request_conflict' using errcode='PT409';end if;
 if p_mode='check' then return public.learn_commusoft_verification_receipt(p_tenant,p_request);end if;
 if r.id is not null and (p_mode='apply' or exists(select 1 from public.learn_commusoft_verification_results where request_id=r.id)) then
  return public.learn_commusoft_verification_receipt(p_tenant,p_request);end if;
 if p_mode='cancel' then
  if r.id is null then
   insert into public.learn_commusoft_verification_requests(id,tenant_id,actor_id,definition,expires_at)
    values(p_request,p_tenant,p_actor,p_definition,clock_timestamp());
  end if;
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','cancelled');
  insert into public.learn_commusoft_verification_results(request_id,receipt) values(p_request,receipt);
  return receipt;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 if exists(select 1 from public.learn_commusoft_verification_requests q where q.tenant_id=p_tenant
  and q.expires_at>clock_timestamp() and not exists(select 1 from public.learn_commusoft_verification_results x where x.request_id=q.id)) then
  raise exception 'learn_verification_active' using errcode='55000';end if;
 if exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync' and status in ('queued','running','retrying')) then
  raise exception 'learn_verification_import_active' using errcode='55000';end if;
 select * into c from public.provider_connections where id=connection and tenant_id=p_tenant for share;
 if not found or c.updated_at is distinct from revision then raise exception 'learn_verification_revision_changed' using errcode='PT409';end if;
 r.id:=p_request;r.tenant_id:=p_tenant;r.actor_id:=p_actor;r.definition:=p_definition;
 r.binding:=public.learn_commusoft_verification_binding(c);r.expires_at:=clock_timestamp()+interval '2 minutes';
 if not public.learn_commusoft_verification_authority(r) then raise exception 'learn_verification_unavailable' using errcode='55000';end if;
 insert into public.learn_commusoft_verification_requests(id,tenant_id,actor_id,definition,binding,expires_at)
  values(r.id,r.tenant_id,r.actor_id,r.definition,r.binding,r.expires_at);
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 return public.learn_commusoft_verification_receipt(p_tenant,p_request);
end $$;

create function public.learn_commusoft_verify_acquire(p_tenant uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_commusoft_verification_requests%rowtype;secret text;fingerprint text;next_at timestamptz;permit public.learn_commusoft_verification_permits%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'learn_verification_forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-verification-request:'||p_request::text,0));
 select * into r from public.learn_commusoft_verification_requests where id=p_request and tenant_id=p_tenant;
 if not found or exists(select 1 from public.learn_commusoft_verification_results where request_id=r.id)
  or exists(select 1 from public.learn_commusoft_verification_permits where request_id=r.id) then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 if not public.learn_commusoft_verification_authority(r) then return null;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where id::text=r.binding->>'secret_id'
  and name='provider_secret:'||p_tenant::text||':commusoft:api_key';
 if secret is null or octet_length(secret) not between 1 and 4096 or secret!~'^[!-~]+$' then return null;end if;
 fingerprint:=encode(sha256(convert_to('commusoft:'||secret,'UTF8')),'hex');
 insert into public.learn_business_input_request_gates values(fingerprint,clock_timestamp()) on conflict do nothing;
 select next_allowed_at into next_at from public.learn_business_input_request_gates where credential_fingerprint=fingerprint for update;
 if not public.learn_commusoft_verification_authority(r) then return null;end if;
 if next_at>clock_timestamp() then return jsonb_build_object('state','wait','retryAt',ceil(extract(epoch from next_at)*1000)::bigint);end if;
 update public.learn_business_input_request_gates set next_allowed_at=clock_timestamp()+interval '1250 milliseconds' where credential_fingerprint=fingerprint;
 insert into public.learn_commusoft_verification_permits(request_id,credential_fingerprint,send_before)
  values(r.id,fingerprint,least(r.expires_at,clock_timestamp()+interval '5 seconds')) returning * into permit;
 return jsonb_build_object('state','ready','apiKey',secret,'permitId',permit.id,'region',r.binding->>'region',
  'sendBefore',floor(extract(epoch from permit.send_before)*1000)::bigint);
end $$;

create function public.learn_commusoft_verify_authorized(p_tenant uuid,p_request uuid,p_permit uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_commusoft_verification_requests%rowtype;permit public.learn_commusoft_verification_permits%rowtype;fingerprint text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'learn_verification_forbidden' using errcode='42501';end if;
 select * into r from public.learn_commusoft_verification_requests where id=p_request and tenant_id=p_tenant;
 if not found or exists(select 1 from public.learn_commusoft_verification_results where request_id=r.id) then return false;end if;
 select * into permit from public.learn_commusoft_verification_permits where id=p_permit and request_id=r.id;
 if not found or not public.learn_commusoft_verification_authority(r) then return false;end if;
 select encode(sha256(convert_to('commusoft:'||decrypted_secret,'UTF8')),'hex') into fingerprint from vault.decrypted_secrets
  where id::text=r.binding->>'secret_id' and name='provider_secret:'||p_tenant::text||':commusoft:api_key';
 return fingerprint is not null and fingerprint=permit.credential_fingerprint;
end $$;

create function public.learn_commusoft_verify_finish(p_tenant uuid,p_request uuid,p_permit uuid,p_code text,p_retry_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_commusoft_verification_requests%rowtype;permit public.learn_commusoft_verification_permits%rowtype;
 prior public.learn_commusoft_verification_results%rowtype;receipt jsonb;code text;verified timestamptz;revision timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'learn_verification_forbidden' using errcode='42501';end if;
 if p_code is null or p_code not in ('access_verified','invalid_request','authority_unavailable','transport_unavailable','authentication_required',
  'access_denied','rate_limited','provider_unavailable','provider_rejected','response_too_large','invalid_response')
  or (p_retry_at is not null and not isfinite(p_retry_at)) then raise exception 'learn_verification_result_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-verification-request:'||p_request::text,0));
 select * into r from public.learn_commusoft_verification_requests where id=p_request and tenant_id=p_tenant;
 if not found then return null;end if;
 select * into permit from public.learn_commusoft_verification_permits where id=p_permit and request_id=r.id;
 if not found then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 -- Even a late response after cancellation/revocation must protect shared quota.
 if p_retry_at is not null then
  update public.learn_business_input_request_gates set next_allowed_at=greatest(next_allowed_at,p_retry_at) where credential_fingerprint=permit.credential_fingerprint;
 end if;
 select * into prior from public.learn_commusoft_verification_results where request_id=r.id;
 if found then
  if prior.receipt->>'state'<>'cancelled' and (prior.observation_code is distinct from p_code or prior.retry_at is distinct from p_retry_at) then
   raise exception 'learn_verification_result_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 -- Acquire the connection update lock before inspecting its revision/authority.
 perform 1 from public.provider_connections where id=(r.definition->>'connection_id')::uuid and tenant_id=p_tenant for update;
 code:=case when public.learn_commusoft_verify_authorized(p_tenant,p_request,p_permit) then p_code else 'authority_changed' end;
 if code<>'authority_changed' then
  if code='access_verified' then verified:=clock_timestamp();end if;
  update public.provider_connections set verified_at=verified,
   last_test=jsonb_build_object('state',case when verified is null then 'failed' else 'verified' end,'code',code,'request_id',r.id,'checked_at',clock_timestamp()),
   updated_by=r.actor_id where id=(r.definition->>'connection_id')::uuid and tenant_id=p_tenant returning updated_at into revision;
  insert into public.provider_connection_events(tenant_id,provider,event,actor_id,detail)
   values(p_tenant,'commusoft','learn_connection_checked',r.actor_id,jsonb_build_object('request_id',r.id,'code',code,'verified',verified is not null));
 end if;
 receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','recorded','connection_id',r.definition->>'connection_id',
  'code',code,'verified_at',verified,'revision',revision);
 insert into public.learn_commusoft_verification_results(request_id,observation_code,retry_at,receipt) values(r.id,p_code,p_retry_at,receipt);
 return receipt;
end $$;

revoke all on function public.learn_commusoft_verification_binding(public.provider_connections),
 public.learn_commusoft_verification_authority(public.learn_commusoft_verification_requests),public.learn_commusoft_verification_receipt(uuid,uuid),
 public.learn_commusoft_verify_request(uuid,uuid,uuid,jsonb,text),public.learn_commusoft_verify_acquire(uuid,uuid),
 public.learn_commusoft_verify_authorized(uuid,uuid,uuid),public.learn_commusoft_verify_finish(uuid,uuid,uuid,text,timestamptz)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_verify_request(uuid,uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.learn_commusoft_verify_acquire(uuid,uuid),public.learn_commusoft_verify_authorized(uuid,uuid,uuid),
 public.learn_commusoft_verify_finish(uuid,uuid,uuid,text,timestamptz) to service_role;
commit;
