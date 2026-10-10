-- Server-only credential release and shared pacing. No credentials, flags,
-- approvals, jobs or provider requests are created by installing this migration.
begin;

create table public.learn_business_input_request_gates (
  credential_fingerprint text primary key,
  next_allowed_at timestamptz not null
);
create table public.learn_business_input_request_permits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  job_id uuid not null,
  claimed_by text not null,
  attempt_count integer not null,
  binding jsonb not null,
  credential_fingerprint text not null references public.learn_business_input_request_gates(credential_fingerprint),
  requested_at timestamptz not null default clock_timestamp(),
  unique(job_id,attempt_count)
);
alter table public.learn_business_input_request_gates enable row level security;
alter table public.learn_business_input_request_permits enable row level security;
revoke all on public.learn_business_input_request_gates,public.learn_business_input_request_permits
  from public,anon,authenticated,service_role;

create function public.learn_commusoft_acquire_page(
  p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,p_expected jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  j public.platform_jobs%rowtype;
  a public.connector_accounts%rowtype;
  c public.provider_connections%rowtype;
  cfg jsonb; cp jsonb; req jsonb; pages integer; after_id bigint; flag_name text;
  secret text; fingerprint text; next_at timestamptz; permit_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'commusoft_permit_forbidden' using errcode='42501';
  end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'commusoft_permit_snapshot' using errcode='22023';
  end if;
  if p_tenant_id is null or p_job_id is null or nullif(btrim(p_claimed_by),'') is null
     or p_attempt_count is null or p_attempt_count<1 or jsonb_typeof(p_expected) is distinct from 'object'
     or p_expected->>'tenantId' is distinct from p_tenant_id::text
     or p_expected->>'jobId' is distinct from p_job_id::text then return null; end if;

  select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
  if not found or j.job_type is distinct from 'commusoft.source_sync' or j.status is distinct from 'running'
     or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_attempt_count
     or coalesce(j.lease_expires_at,'-infinity')<=clock_timestamp() then return null; end if;
  perform 1 from public.tenants where id=p_tenant_id and status='active' for share;
  if not found then return null; end if;
  foreach flag_name in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
    perform 1 from public.feature_flags where tenant_id=p_tenant_id and flag=flag_name and value='true'::jsonb for share;
    if not found then return null; end if;
  end loop;
  select * into a from public.connector_accounts where id::text=j.payload->>'connector_account_id'
    and tenant_id=p_tenant_id for share;
  if not found or a.status is distinct from 'active' or a.id::text is distinct from p_expected->>'accountId'
     or nullif(btrim(a.account_key),'') is null or length(a.account_key)>2000
     or a.tenant_connector_id::text is distinct from p_expected->>'connectorId'
     or a.sync_cursor is distinct from p_expected->'checkpoint' then return null; end if;
  perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id
    and connector_id='commusoft' and provider='commusoft' and enabled and status='active' for share;
  if not found then return null; end if;
  cfg:=a.settings->'commusoft_import';
  if jsonb_typeof(cfg) is distinct from 'object' or cfg is distinct from p_expected->'approval'
     or cfg->'approved' is distinct from 'true'::jsonb
     or (cfg->>'approvalId')::uuid is null or (cfg->>'connectionId')::uuid is null
     or nullif(btrim(cfg->>'consentReference'),'') is null or length(cfg->>'consentReference')>2000
     or coalesce((cfg->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
     or jsonb_typeof(cfg->'maxPages') is distinct from 'number' or (cfg->>'maxPages')::integer not between 1 and 10000
     or jsonb_typeof(cfg->'pageSize') is distinct from 'number' or (cfg->>'pageSize')::integer not between 1 and 100
     or coalesce(cfg->>'resource','') not in ('properties','propertyContacts','jobs') then return null; end if;
  if cfg->>'resource'='propertyContacts' then
    if coalesce(cfg->>'contactType','') not in ('customer','workaddress') then return null; end if;
  elsif cfg ? 'contactType' then return null; end if;

  select * into c from public.provider_connections where id=(cfg->>'connectionId')::uuid and tenant_id=p_tenant_id for share;
  if not found or c.id::text is distinct from p_expected->>'connectionId' or c.provider is distinct from 'commusoft'
     or c.status is distinct from 'configured' or c.auth_mode is distinct from 'private_api_key'
     or c.revoked_at is not null or c.verified_at is null or c.verified_at>clock_timestamp()
     or c.updated_at is null or c.updated_at is distinct from (p_expected->>'connectionRevision')::timestamptz
     or coalesce(c.non_secret_config->>'region','') not in ('uk','us')
     or c.non_secret_config->>'account_key' is distinct from a.account_key
     or not coalesce('api_key'=any(c.configured_fields),false)
     or c.secret_refs->>'api_key' is distinct from p_expected->>'secretId' then return null; end if;

  cp:=a.sync_cursor;
  if cp='{}'::jsonb then cp:=jsonb_build_object('approvalId',cfg->>'approvalId','after',null,'pages',0,'complete',false); end if;
  if jsonb_typeof(cp) is distinct from 'object' or cp->>'approvalId' is distinct from cfg->>'approvalId'
     or jsonb_typeof(cp->'pages') is distinct from 'number' or cp->'complete' is distinct from 'false'::jsonb then return null; end if;
  pages:=(cp->>'pages')::integer;
  if pages<0 or pages>=(cfg->>'maxPages')::integer then return null; end if;
  if cp->'after'='null'::jsonb then after_id:=null;
  elsif jsonb_typeof(cp->'after')='number' then after_id:=(cp->>'after')::bigint;
  else return null; end if;
  if pages=0 and after_id is not null or pages>0 and (after_id is null or after_id<1 or after_id>9007199254740991) then return null; end if;
  req:=jsonb_build_object('region',c.non_secret_config->>'region','resource',cfg->>'resource','after',after_id,'limit',(cfg->>'pageSize')::integer);
  if cfg->>'resource'='propertyContacts' then req:=req||jsonb_build_object('contactType',cfg->>'contactType'); end if;
  if req is distinct from p_expected->'request' or p_expected->'pages' is distinct from to_jsonb(pages)
     or p_expected->'complete' is distinct from 'false'::jsonb then return null; end if;

  -- A repeated acquisition cannot release a second credential for this attempt.
  -- An uncertain response is not retried inline; recovery uses a new queue attempt.
  if exists(select 1 from public.learn_business_input_request_permits where job_id=j.id and attempt_count=p_attempt_count) then return null; end if;
  select decrypted_secret into secret from vault.decrypted_secrets
    where id=(c.secret_refs->>'api_key')::uuid and name='provider_secret:'||p_tenant_id::text||':commusoft:api_key';
  if secret is null or length(secret) not between 1 and 4096 or secret !~ '^[!-~]+$' then return null; end if;
  -- The same key stored in different tenant Vault entries still shares quota.
  -- Fingerprints are infrastructure-private, never returned to a worker/client.
  fingerprint:=encode(sha256(convert_to('commusoft:'||secret,'UTF8')),'hex');
  insert into public.learn_business_input_request_gates values(fingerprint,clock_timestamp()) on conflict do nothing;
  select next_allowed_at into next_at from public.learn_business_input_request_gates
    where credential_fingerprint=fingerprint for update;
  if j.lease_expires_at<=clock_timestamp() or (cfg->>'expiresAt')::timestamptz<=clock_timestamp() then return null; end if;
  if next_at>clock_timestamp() then
    return jsonb_build_object('state','wait','retryAt',ceil(extract(epoch from next_at)*1000)::bigint);
  end if;
  -- 48 reservations/minute leaves room below the documented 60/minute ceiling.
  update public.learn_business_input_request_gates set next_allowed_at=clock_timestamp()+interval '1250 milliseconds'
    where credential_fingerprint=fingerprint;
  insert into public.learn_business_input_request_permits(tenant_id,job_id,claimed_by,attempt_count,binding,credential_fingerprint)
    values(p_tenant_id,p_job_id,p_claimed_by,p_attempt_count,
      jsonb_build_object('accountId',a.id,'connectorId',a.tenant_connector_id,'connectionId',c.id,
        'connectionRevision',c.updated_at,'secretId',c.secret_refs->>'api_key',
        'approval',cfg,'checkpoint',a.sync_cursor,'request',req),fingerprint) returning id into permit_id;
  -- Short send window prevents delayed workers banking reservations for a burst.
  return jsonb_build_object('state','ready','apiKey',secret,'permitId',permit_id,
    'sendBefore',floor(extract(epoch from clock_timestamp()+interval '5 seconds')*1000)::bigint);
end $$;

create function public.learn_commusoft_defer_page(
  p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,p_permit_id uuid,p_retry_at timestamptz
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare permit public.learn_business_input_request_permits%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'commusoft_permit_forbidden' using errcode='42501'; end if;
  if p_retry_at is null or not isfinite(p_retry_at) then return false; end if;
  select * into permit from public.learn_business_input_request_permits where id=p_permit_id
    and tenant_id=p_tenant_id and job_id=p_job_id and claimed_by=p_claimed_by and attempt_count=p_attempt_count;
  if not found then return false; end if;
  -- A delayed 429 still protects other workers after the original job/connection
  -- changes. The acquired permit, not current approval, authorizes only extending
  -- this existing shared gate. Never move the gate backwards or release a key.
  update public.learn_business_input_request_gates set next_allowed_at=greatest(next_allowed_at,p_retry_at)
    where credential_fingerprint=permit.credential_fingerprint;
  return found;
end $$;

revoke all on function public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb),
  public.learn_commusoft_defer_page(uuid,uuid,text,integer,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb),
  public.learn_commusoft_defer_page(uuid,uuid,text,integer,uuid,timestamptz) to service_role;
commit;
