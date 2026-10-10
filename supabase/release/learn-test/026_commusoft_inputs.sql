-- Commusoft retained-input and reviewed-card release, TEST only.
-- Does not enable a module, create credentials, approve imports or schedule work.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if (select count(*) from of_test_deploy.migrations)<>26 or not exists(select 1 from of_test_deploy.migrations where migration_name='learn_import_batches_v1' and source_sha256='fc904ebd3a7fb4ec45e6c78994ed954289c317ab15aefbbae40f3dd687cad9cd' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Exact release 025 prerequisite required';end if;
 if to_regclass('public.feature_flags') is not null then raise exception 'TEST feature flag store already exists; inspect its contract';end if;
end $$;
set local search_path=public,pg_temp;
create table feature_flags (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid references tenants(id) on delete cascade,  -- null = global default
  flag       text not null,
  value      jsonb not null,
  version_id uuid references config_versions(id),
  created_at timestamptz not null default now()
);
-- Nullable tenant_id: coalesce so a global (null) flag is unique per name too.
create unique index feature_flags_natural_uk on feature_flags (
  coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), flag
);

alter table feature_flags enable row level security;
revoke all on feature_flags from public,anon,authenticated,service_role;
grant select on feature_flags to authenticated,service_role;
create policy ff_select on feature_flags for select to authenticated using (tenant_id is null or tenant_id=current_tenant_id() or is_openfolk());

-- Source: 20261031090000_learn_commusoft_page_permits.sql

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

-- Source: 20261031100000_learn_business_input_pages.sql
create table public.learn_business_input_pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  connection_id uuid not null,
  provider text not null,
  collection text not null,
  job_id uuid not null unique,
  permit_id uuid not null unique references public.learn_business_input_request_permits(id) on delete restrict,
  envelope jsonb not null,
  checkpoint_before jsonb not null,
  checkpoint_after jsonb not null,
  record_count integer not null,
  committed_at timestamptz not null default clock_timestamp()
);
create table public.learn_business_input_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  connection_id uuid not null,
  provider text not null,
  collection text not null,
  external_id text not null,
  content_hash text not null,
  payload jsonb not null,
  first_seen_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,connection_id,provider,collection,external_id,content_hash)
);
create table public.learn_business_input_observations (
  page_id uuid not null references public.learn_business_input_pages(id) on delete restrict,
  version_id uuid not null references public.learn_business_input_versions(id) on delete restrict,
  ordinal integer not null,
  primary key(page_id,ordinal),
  unique(page_id,version_id)
);
alter table public.learn_business_input_pages enable row level security;
alter table public.learn_business_input_versions enable row level security;
alter table public.learn_business_input_observations enable row level security;
revoke all on public.learn_business_input_pages,public.learn_business_input_versions,public.learn_business_input_observations
  from public,anon,authenticated,service_role;

create function public.learn_business_input_retain() returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'business_input_history_retained' using errcode='42501';end $$;
revoke all on function public.learn_business_input_retain() from public,anon,authenticated,service_role;
do $$declare t text;begin
  foreach t in array array['learn_business_input_pages','learn_business_input_versions','learn_business_input_observations'] loop
    execute format('create trigger retain_rows before update or delete on public.%I for each row execute function public.learn_business_input_retain()',t);
    execute format('create trigger retain_all before truncate on public.%I for each statement execute function public.learn_business_input_retain()',t);
  end loop;
end $$;

-- An already committed job must be settled, never fetch another page on retry.
do $$declare definition text; needle text:='  -- A repeated acquisition cannot release a second credential for this attempt.';begin
  definition:=pg_get_functiondef('public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)'::regprocedure);
  if position(needle in definition)=0 or position('commusoft_page_v1' in definition)>0 then
    raise exception 'commusoft_acquisition_contract_changed';
  end if;
  execute replace(definition,needle,'  if coalesce(j.metadata,''{}''::jsonb) ? ''commusoft_page_v1'' then return null; end if;'||chr(10)||needle);
end $$;

create function public.learn_commusoft_commit_page(
  p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,p_permit_id uuid,p_envelope jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  permit public.learn_business_input_request_permits%rowtype;
  prior public.learn_business_input_pages%rowtype;
  j public.platform_jobs%rowtype;
  a public.connector_accounts%rowtype;
  connection public.provider_connections%rowtype;
  b jsonb; cfg jsonb; cp jsonb; next_cp jsonb; receipt jsonb; flag_name text;
  page_id uuid; version_id uuid; item jsonb; item_id bigint; previous_id bigint; next_id bigint;
  n integer:=0; pages integer; has_more boolean; v_hash text; saved_payload jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'commusoft_publication_forbidden' using errcode='42501';end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'commusoft_publication_snapshot' using errcode='22023';end if;
  -- Serialize against acquisition and concurrent/repeated publication for this job.
  select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'commusoft_job_unavailable' using errcode='42501';end if;
  select * into permit from public.learn_business_input_request_permits where id=p_permit_id and tenant_id=p_tenant_id
    and job_id=p_job_id and claimed_by=p_claimed_by and attempt_count=p_attempt_count;
  if not found then raise exception 'commusoft_permit_unavailable' using errcode='42501';end if;
  select * into prior from public.learn_business_input_pages where permit_id=p_permit_id;
  if found then
    if prior.envelope is distinct from p_envelope then raise exception 'commusoft_page_conflict' using errcode='PT409';end if;
    -- Exact replay acknowledges retained data without changing it or acquiring authority.
    return jsonb_build_object('pageId',prior.id,'checkpoint',prior.checkpoint_after,'records',prior.record_count,'already',true);
  end if;
  if j.job_type is distinct from 'commusoft.source_sync' or j.status is distinct from 'running'
    or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_attempt_count
    or coalesce(j.lease_expires_at,'-infinity')<=clock_timestamp()
    or coalesce(j.metadata,'{}'::jsonb) ? 'commusoft_page_v1' then raise exception 'commusoft_job_unavailable' using errcode='42501';end if;
  perform 1 from public.tenants where id=p_tenant_id and status='active' for share;
  if not found then raise exception 'commusoft_tenant_unavailable' using errcode='42501';end if;
  foreach flag_name in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
    perform 1 from public.feature_flags where tenant_id=p_tenant_id and flag=flag_name and value='true'::jsonb for share;
    if not found then raise exception 'commusoft_module_unavailable' using errcode='42501';end if;
  end loop;
  b:=permit.binding; cfg:=b->'approval'; cp:=b->'checkpoint';
  select * into a from public.connector_accounts where id::text=b->>'accountId' and tenant_id=p_tenant_id for update;
  if not found or a.id::text is distinct from j.payload->>'connector_account_id' or a.status is distinct from 'active'
    or a.tenant_connector_id::text is distinct from b->>'connectorId'
    or a.settings->'commusoft_import' is distinct from cfg or a.sync_cursor is distinct from cp
    or coalesce((cfg->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp() then
    raise exception 'commusoft_scope_changed' using errcode='PT409';end if;
  perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id
    and connector_id='commusoft' and provider='commusoft' and enabled and status='active' for share;
  if not found then raise exception 'commusoft_connector_unavailable' using errcode='42501';end if;
  select * into connection from public.provider_connections where id::text=b->>'connectionId' and tenant_id=p_tenant_id for share;
  if not found or connection.provider is distinct from 'commusoft' or connection.status is distinct from 'configured'
    or connection.auth_mode is distinct from 'private_api_key' or connection.revoked_at is not null
    or connection.verified_at is null or connection.verified_at>clock_timestamp()
    or connection.updated_at is distinct from (b->>'connectionRevision')::timestamptz
    or connection.non_secret_config->>'account_key' is distinct from a.account_key
    or connection.non_secret_config->>'region' is distinct from b->'request'->>'region'
    or not coalesce('api_key'=any(connection.configured_fields),false)
    or connection.secret_refs->>'api_key' is distinct from b->>'secretId' then
    raise exception 'commusoft_connection_changed' using errcode='42501';end if;

  if jsonb_typeof(p_envelope) is distinct from 'object' or octet_length(p_envelope::text)>4194304
    or jsonb_typeof(p_envelope->'data') is distinct from 'array'
    or jsonb_array_length(p_envelope->'data')>(b->'request'->>'limit')::integer
    or jsonb_typeof(p_envelope->'pagination') is distinct from 'object'
    or jsonb_typeof(p_envelope->'pagination'->'hasMore') is distinct from 'boolean' then
    raise exception 'commusoft_page_invalid' using errcode='22023';end if;
  has_more:=(p_envelope->'pagination'->>'hasMore')::boolean;
  previous_id:=coalesce((b->'request'->>'after')::bigint,0);
  pages:=case when cp='{}'::jsonb then 0 else (cp->>'pages')::integer end;
  next_cp:=jsonb_build_object('approvalId',cfg->>'approvalId','after',null,'pages',pages+1,'complete',not has_more);
  page_id:=gen_random_uuid();
  -- Stage checkpoint in a local variable; immutable page is inserted after validation.
  for item in select value from jsonb_array_elements(p_envelope->'data') loop
    if jsonb_typeof(item) is distinct from 'object' or octet_length(item::text)>524288
      or jsonb_typeof(item->'id') is distinct from 'number' or (item->>'id') !~ '^[0-9]+$' then
      raise exception 'commusoft_record_invalid' using errcode='22023';end if;
    item_id:=(item->>'id')::bigint;
    if item_id<=previous_id or item_id>9007199254740991 then raise exception 'commusoft_record_order_invalid' using errcode='22023';end if;
    previous_id:=item_id; n:=n+1;
  end loop;
  if p_envelope->'pagination'->'nextCursor' is null or p_envelope->'pagination'->'nextCursor'='null'::jsonb then next_id:=null;
  elsif jsonb_typeof(p_envelope->'pagination'->'nextCursor')='number' and p_envelope->'pagination'->>'nextCursor' ~ '^[0-9]+$' then
    next_id:=(p_envelope->'pagination'->>'nextCursor')::bigint;
  else raise exception 'commusoft_cursor_invalid' using errcode='22023';end if;
  if has_more and (n=0 or next_id is null or next_id<>previous_id) or
     not has_more and next_id is not null and next_id<>0 and next_id<>previous_id then
    raise exception 'commusoft_cursor_invalid' using errcode='22023';end if;
  if has_more then next_cp:=jsonb_set(next_cp,'{after}',to_jsonb(next_id));end if;
  insert into public.learn_business_input_pages(id,tenant_id,connection_id,provider,collection,job_id,permit_id,envelope,checkpoint_before,checkpoint_after,record_count)
    values(page_id,p_tenant_id,connection.id,'commusoft',b->'request'->>'resource',p_job_id,p_permit_id,p_envelope,cp,next_cp,n);
  n:=0;
  for item in select value from jsonb_array_elements(p_envelope->'data') loop
    n:=n+1; v_hash:=encode(sha256(convert_to(item::text,'UTF8')),'hex');
    insert into public.learn_business_input_versions(tenant_id,connection_id,provider,collection,external_id,content_hash,payload)
      values(p_tenant_id,connection.id,'commusoft',b->'request'->>'resource',item->>'id',v_hash,item)
      on conflict(tenant_id,connection_id,provider,collection,external_id,content_hash) do nothing;
    select v.id,v.payload into version_id,saved_payload from public.learn_business_input_versions v where v.tenant_id=p_tenant_id
      and v.connection_id=connection.id and v.provider='commusoft' and v.collection=b->'request'->>'resource'
      and v.external_id=item->>'id' and v.content_hash=v_hash;
    if version_id is null or saved_payload is distinct from item then raise exception 'commusoft_version_conflict' using errcode='PT409';end if;
    insert into public.learn_business_input_observations values(page_id,version_id,n);
  end loop;
  if j.lease_expires_at<=clock_timestamp() or (cfg->>'expiresAt')::timestamptz<=clock_timestamp() then
    raise exception 'commusoft_authority_expired' using errcode='42501';end if;
  update public.connector_accounts set sync_cursor=next_cp where id=a.id and tenant_id=p_tenant_id;
  receipt:=jsonb_build_object('pageId',page_id,'checkpoint',next_cp,'records',n,'already',false);
  update public.platform_jobs set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('commusoft_page_v1',receipt) where id=j.id;
  return receipt;
end $$;
revoke all on function public.learn_commusoft_commit_page(uuid,uuid,text,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.learn_commusoft_commit_page(uuid,uuid,text,integer,uuid,jsonb) to service_role;

-- Recovery before any provider acquisition: a new queue attempt may acknowledge
-- an older committed page without obtaining its credential or reading its source.
create function public.learn_commusoft_committed_page(
  p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;p public.learn_business_input_pages%rowtype;begin
  if auth.role() is distinct from 'service_role' then raise exception 'commusoft_receipt_forbidden' using errcode='42501';end if;
  select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for share;
  if not found or j.job_type is distinct from 'commusoft.source_sync' or j.status is distinct from 'running'
    or p_claimed_by is null or j.claimed_by is distinct from p_claimed_by or p_attempt_count is null
    or j.attempt_count is distinct from p_attempt_count or coalesce(j.lease_expires_at,'-infinity')<=clock_timestamp() then
    raise exception 'commusoft_job_unavailable' using errcode='42501';end if;
  select * into p from public.learn_business_input_pages where job_id=p_job_id and tenant_id=p_tenant_id;
  if not found then
    if coalesce(j.metadata,'{}'::jsonb) ? 'commusoft_page_v1' then raise exception 'commusoft_receipt_missing' using errcode='PT409';end if;
    return null;
  end if;
  if j.metadata->'commusoft_page_v1' is distinct from jsonb_build_object('pageId',p.id,'checkpoint',p.checkpoint_after,'records',p.record_count,'already',false) then
    raise exception 'commusoft_receipt_mismatch' using errcode='PT409';end if;
  return jsonb_build_object('pageId',p.id,'checkpoint',p.checkpoint_after,'records',p.record_count,'already',true);
end $$;
revoke all on function public.learn_commusoft_committed_page(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.learn_commusoft_committed_page(uuid,uuid,text,integer) to service_role;

-- Source: 20261031110000_learn_commusoft_worker.sql
do $$declare d text;needle text:='where c.status in (''queued'', ''retrying'')';begin
 d:=pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'commusoft_generic_claim_changed';end if;
 execute replace(d,needle,needle||chr(10)||'      and c.job_type <> ''commusoft.source_sync''');
end $$;
-- Bind the durable job key to its approval before any credential release.
do $$declare d text;needle text:='  select * into c from public.provider_connections';begin
 d:=pg_get_functiondef('public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)'::regprocedure);
 if position(needle in d)=0 then raise exception 'commusoft_acquisition_contract_changed';end if;
 execute replace(d,needle,'  if j.job_key is distinct from ''commusoft.source:''||a.id::text||'':''||(cfg->>''approvalId'') then return null;end if;'||chr(10)||needle);
end $$;

-- The job's approval identity must also survive through publication.
do $$declare d text;needle text:='  b:=permit.binding; cfg:=b->''approval''; cp:=b->''checkpoint'';';begin
 d:=pg_get_functiondef('public.learn_commusoft_commit_page(uuid,uuid,text,integer,uuid,jsonb)'::regprocedure);
 if position(needle in d)=0 then raise exception 'commusoft_publication_contract_changed';end if;
 execute replace(d,needle,needle||chr(10)||'  if j.job_key is distinct from ''commusoft.source:''||(b->>''accountId'')||'':''||(cfg->>''approvalId'') then raise exception ''commusoft_queue_identity'' using errcode=''PT409'';end if;');
end $$;

create function public.learn_commusoft_claim_jobs(p_worker uuid)
returns setof public.platform_jobs language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'commusoft_queue_forbidden' using errcode='42501';end if;
 if p_worker is null or current_setting('transaction_isolation')<>'read committed' then raise exception 'commusoft_queue_invalid' using errcode='22023';end if;
 for j in select * from public.platform_jobs q where q.job_type='commusoft.source_sync'
   and q.status in ('queued','retrying','running') and coalesce(q.available_at,'-infinity')<=clock_timestamp()
   and coalesce(q.lease_expires_at,'-infinity')<=clock_timestamp()
   order by q.priority,q.created_at,q.id for update skip locked limit 1
 loop
   if j.attempt_count is null or j.attempt_count<0 or j.max_attempts is null or j.max_attempts<1 or
     (j.attempt_count>=j.max_attempts and not exists(select 1 from public.learn_business_input_pages p where p.job_id=j.id and p.tenant_id=j.tenant_id)) then
     update public.platform_jobs set status='dead_letter',dead_lettered_at=clock_timestamp(),failed_at=clock_timestamp(),
       lease_expires_at=null,error_code='commusoft_attempts_exhausted' where id=j.id;
   else
     update public.platform_jobs set status='running',claimed_by='learn-commusoft:'||p_worker::text,
       claimed_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '180 seconds',
       attempt_count=j.attempt_count+1,last_attempt_at=clock_timestamp(),started_at=coalesce(started_at,clock_timestamp())
       where id=j.id returning * into j;
     return next j;
   end if;
 end loop;
end $$;

create function public.learn_commusoft_finish_job(
 p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,p_outcome jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;p public.learn_business_input_pages%rowtype;
 permit public.learn_business_input_request_permits%rowtype;a public.connector_accounts%rowtype;
 b jsonb;cfg jsonb;finish jsonb;receipt jsonb;answer jsonb;successor uuid;
 next_status text;stop_reason text;delay_seconds integer;failure_code text;allowed boolean;next_at timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'commusoft_queue_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' or p_claimed_by is null or p_attempt_count is null or p_attempt_count<1
   or jsonb_typeof(p_outcome) is distinct from 'object' or jsonb_typeof(p_outcome->'success') is distinct from 'boolean' then
   raise exception 'commusoft_queue_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.job_type is distinct from 'commusoft.source_sync' or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_attempt_count then
   raise exception 'commusoft_queue_not_owned' using errcode='PT409';end if;
 finish:=j.metadata->'commusoft_finish_v1';
 if j.status in ('succeeded','retrying','dead_letter') and finish->>'claimed_by'=p_claimed_by and (finish->>'attempt_count')::integer=p_attempt_count then
   if finish->'outcome'=p_outcome then return finish->'answer';end if;
   raise exception 'commusoft_queue_replay_conflict' using errcode='PT409';
 end if;
 if j.status is distinct from 'running' or coalesce(j.lease_expires_at,'-infinity')<=clock_timestamp() then
   raise exception 'commusoft_queue_not_owned' using errcode='PT409';end if;
 select * into p from public.learn_business_input_pages where job_id=j.id and tenant_id=p_tenant_id;
 if found then
   -- Never overwrite a committed page as failed, including a lost publication reply.
   if p_outcome<>'{"success":true}'::jsonb then raise exception 'commusoft_queue_page_committed' using errcode='PT409';end if;
   receipt:=jsonb_build_object('pageId',p.id,'checkpoint',p.checkpoint_after,'records',p.record_count,'already',false);
   if j.metadata->'commusoft_page_v1' is distinct from receipt then raise exception 'commusoft_queue_receipt_mismatch' using errcode='PT409';end if;
   select * into permit from public.learn_business_input_request_permits where id=p.permit_id;
   if not found then raise exception 'commusoft_queue_receipt_mismatch' using errcode='PT409';end if;
   b:=permit.binding;cfg:=b->'approval';
   if j.job_key is distinct from 'commusoft.source:'||(b->>'accountId')||':'||(cfg->>'approvalId') then
     raise exception 'commusoft_queue_identity' using errcode='PT409';end if;
   stop_reason:=case when p.checkpoint_after->'complete'='true'::jsonb then 'collection_exhausted'
     when (p.checkpoint_after->>'pages')::integer>=(cfg->>'maxPages')::integer then 'page_budget_exhausted' else 'next_page' end;
   if stop_reason='next_page' then
     -- Current switches/approval decide only whether to continue. Prior committed
     -- work is still acknowledged if an operator has since disabled processing.
     perform 1 from public.tenants where id=p_tenant_id and status='active' for share;
     allowed:=found;
     perform 1 from public.feature_flags where tenant_id=p_tenant_id and flag='learn.enabled' and value='true'::jsonb for share;
     allowed:=allowed and found;
     perform 1 from public.feature_flags where tenant_id=p_tenant_id and flag='learn.inputs.commusoft.enabled' and value='true'::jsonb for share;
     allowed:=allowed and found;
     select * into a from public.connector_accounts where id::text=b->>'accountId' and tenant_id=p_tenant_id for share;
     allowed:=allowed and found and a.status='active' and a.settings->'commusoft_import'=cfg and a.sync_cursor=p.checkpoint_after
       and coalesce((cfg->>'expiresAt')::timestamptz,'-infinity')>clock_timestamp();
     perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id and connector_id='commusoft'
       and provider='commusoft' and enabled and status='active' for share;
     allowed:=allowed and found;
     perform 1 from public.provider_connections where id::text=b->>'connectionId' and tenant_id=p_tenant_id
       and provider='commusoft' and status='configured' and auth_mode='private_api_key' and revoked_at is null and verified_at is not null
       and verified_at<=clock_timestamp() and updated_at=(b->>'connectionRevision')::timestamptz
       and non_secret_config->>'account_key'=a.account_key and non_secret_config->>'region'=b->'request'->>'region'
       and secret_refs->>'api_key'=b->>'secretId' and 'api_key'=any(configured_fields) for share;
     allowed:=allowed and found;
     if allowed is distinct from true then stop_reason:='authorisation_changed';end if;
   end if;
   update public.platform_jobs set status='succeeded',completed_at=clock_timestamp(),lease_expires_at=null,error_code=null,
     records_processed=p.record_count,result=jsonb_build_object('receipt',receipt,'stop_reason',stop_reason,
       'coverage','one_collection_traversal','ingestion_complete',false) where id=j.id;
   if stop_reason='next_page' then
     select next_allowed_at into next_at from public.learn_business_input_request_gates
       where credential_fingerprint=permit.credential_fingerprint for share;
     if not found then raise exception 'commusoft_queue_gate_missing' using errcode='PT409';end if;
     insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,available_at,parent_job_id,payload)
       values(p_tenant_id,j.connector_id,j.module_id,j.job_type,j.job_key,'queued',j.priority,j.max_attempts,
         greatest(clock_timestamp()+interval '1250 milliseconds',next_at),j.id,jsonb_build_object('connector_account_id',a.id)) returning id into successor;
   end if;
   next_status:='succeeded';
 else
   if coalesce(j.metadata,'{}'::jsonb) ? 'commusoft_page_v1' then raise exception 'commusoft_queue_receipt_mismatch' using errcode='PT409';end if;
   if p_outcome->'success'='true'::jsonb then raise exception 'commusoft_queue_page_missing' using errcode='PT409';end if;
   if not p_outcome ?& array['success','code','retryable','retry_after_seconds'] or (select count(*) from jsonb_object_keys(p_outcome))<>4
     or jsonb_typeof(p_outcome->'retryable') is distinct from 'boolean' or jsonb_typeof(p_outcome->'code') is distinct from 'string'
     or p_outcome->>'code' !~ '^commusoft_[a-z_]{1,80}$' or jsonb_typeof(p_outcome->'retry_after_seconds') is distinct from 'number'
     or p_outcome->>'retry_after_seconds' !~ '^[0-9]{1,8}$' then raise exception 'commusoft_queue_invalid' using errcode='22023';end if;
   delay_seconds:=(p_outcome->>'retry_after_seconds')::integer;
   if delay_seconds>31536000 then raise exception 'commusoft_queue_invalid' using errcode='22023';end if;
   delay_seconds:=greatest(delay_seconds,case j.attempt_count when 1 then 60 when 2 then 300 when 3 then 900 else 3600 end);
   next_status:=case when p_outcome->'retryable'='true'::jsonb and j.attempt_count<j.max_attempts then 'retrying' else 'dead_letter' end;
   failure_code:=p_outcome->>'code';
   update public.platform_jobs set status=next_status,lease_expires_at=null,error_code=failure_code,error_count=coalesce(error_count,0)+1,
     failed_at=clock_timestamp(),available_at=case when next_status='retrying' then clock_timestamp()+make_interval(secs=>delay_seconds) else available_at end,
     dead_lettered_at=case when next_status='dead_letter' then clock_timestamp() else dead_lettered_at end where id=j.id;
 end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'commusoft_queue_not_owned' using errcode='PT409';end if;
 answer:=jsonb_build_object('job_id',j.id,'status',next_status,'successor_id',successor);
 update public.platform_jobs set metadata=coalesce(metadata,'{}')||jsonb_build_object('commusoft_finish_v1',
   jsonb_build_object('claimed_by',p_claimed_by,'attempt_count',p_attempt_count,'outcome',p_outcome,'answer',answer)) where id=j.id;
 return answer;
end $$;
revoke all on function public.learn_commusoft_claim_jobs(uuid),public.learn_commusoft_finish_job(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.learn_commusoft_claim_jobs(uuid),public.learn_commusoft_finish_job(uuid,uuid,text,integer,jsonb) to service_role;

-- Source: 20261031120000_learn_business_input_customers.sql
create index learn_business_input_observations_version_idx
 on public.learn_business_input_observations(version_id,page_id);
create table public.learn_business_input_links (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,
 connection_id uuid not null,
 provider text not null,
 collection text not null,
 external_id text not null,
 source_version_id uuid not null references public.learn_business_input_versions(id) on delete restrict,
 entity_kind text not null check(entity_kind in ('customer','site','contact','job')),
 entity_table text not null,
 entity_id uuid not null,
 card_id uuid references public.customer_cards(id) on delete restrict,
 request jsonb not null,
 actor_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,connection_id,provider,collection,external_id),
 check((entity_kind='customer' and entity_table in ('people','companies'))
    or (entity_kind='contact' and entity_table='people')
    or (entity_kind='site' and entity_table='sites')
    or (entity_kind='job' and entity_table='jobs'))
);
alter table public.learn_business_input_links enable row level security;
revoke all on public.learn_business_input_links from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.learn_business_input_links
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.learn_business_input_links
 for each statement execute function public.learn_business_input_retain();

-- The server must authenticate the caller before supplying p_actor. The current
-- tenant owner/admin and View-As guard are also checked inside this transaction.
-- p_target=NULL is an explicit reviewed CREATE, never an automatic match fallback.
-- p_kind is reviewed classification: configurable customerType IDs, a company
-- name, or a shared mailbox do not independently prove person/company identity.
create function public.learn_commusoft_review_customer(
 p_tenant uuid,p_actor uuid,p_version uuid,p_kind text,p_target uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 v public.learn_business_input_versions%rowtype;
 l public.learn_business_input_links%rowtype;
 c public.provider_connections%rowtype;
 request jsonb; contact jsonb; raw jsonb; meta jsonb;
 flag_name text; field_name text; target_table text; label text; address text;
 target uuid; card uuid; latest timestamptz; latest_versions integer; latest_matches integer;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 perform public.learn_import_batch_authority(p_tenant,p_actor);
 if p_version is null or p_kind is null or p_kind not in ('person','company')
  or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then
  raise exception 'business_input_review_invalid' using errcode='22023';end if;
 -- Same lock order as the source writer. The exclusive connection lock below
 -- fences a new page publication until this reviewed snapshot has committed.
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'business_input_tenant_unavailable' using errcode='42501';end if;
 foreach flag_name in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
  perform 1 from public.feature_flags where tenant_id=p_tenant and flag=flag_name and value='true'::jsonb for share;
  if not found then raise exception 'business_input_module_unavailable' using errcode='42501';end if;
 end loop;
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant;
 if not found or v.provider<>'commusoft' or v.collection<>'properties' then
  raise exception 'business_input_source_unavailable' using errcode='22023';end if;
 perform 1 from public.tenant_connectors where tenant_id=p_tenant and connector_id='commusoft'
  and provider='commusoft' and enabled and status='active' for share;
 if not found then raise exception 'business_input_connector_unavailable' using errcode='42501';end if;
 select * into c from public.provider_connections where id=v.connection_id and tenant_id=p_tenant for update;
 if not found or c.provider is distinct from 'commusoft' or c.status is distinct from 'configured' or c.revoked_at is not null
  or c.verified_at is null or c.verified_at>clock_timestamp() then
  raise exception 'business_input_connection_unavailable' using errcode='42501';end if;
 target_table:=case when p_kind='person' then 'people' else 'companies' end;
 request:=jsonb_build_object('version',p_version,'kind',p_kind,'target',p_target,'actor',p_actor,'reason',btrim(p_reason));
 select * into l from public.learn_business_input_links where tenant_id=p_tenant
  and connection_id=v.connection_id and provider=v.provider and collection=v.collection and external_id=v.external_id;
 if found then
  if l.request is distinct from request then raise exception 'business_input_identity_already_reviewed' using errcode='PT409';end if;
  -- Exact lost-response recovery. Never changes the original target or card.
  execute format('select id from public.%I where tenant_id=$1 and id=$2 for share',l.entity_table)
   into target using p_tenant,l.entity_id;
  perform 1 from public.customer_cards where id=l.card_id and tenant_id=p_tenant
    and ((l.entity_table='people' and person_id=l.entity_id)
      or (l.entity_table='companies' and person_id is null and company_id=l.entity_id)) for share;
  if target is null or not found then
   raise exception 'business_input_target_unavailable' using errcode='PT409';end if;
  return jsonb_build_object('link_id',l.id,'entity_table',l.entity_table,'entity_id',l.entity_id,'card_id',l.card_id,'already',true);
 end if;
 -- Only an observed source version can be approved. Equal-time differing
 -- observations are ambiguous, not UUID-ordered into an invented winner.
 select max(p.committed_at) into latest from public.learn_business_input_observations o
  join public.learn_business_input_pages p on p.id=o.page_id
  join public.learn_business_input_versions s on s.id=o.version_id
  where s.tenant_id=p_tenant and s.connection_id=v.connection_id and s.provider=v.provider
   and s.collection=v.collection and s.external_id=v.external_id
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection;
 select count(distinct s.id),count(distinct s.id) filter(where s.id=v.id) into latest_versions,latest_matches
  from public.learn_business_input_observations o join public.learn_business_input_pages p on p.id=o.page_id
  join public.learn_business_input_versions s on s.id=o.version_id
  where s.tenant_id=p_tenant and s.connection_id=v.connection_id and s.provider=v.provider
   and s.collection=v.collection and s.external_id=v.external_id and p.committed_at=latest
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection;
 if latest_versions<>1 or latest_matches<>1 then raise exception 'business_input_review_stale' using errcode='PT409';end if;
 raw:=v.payload;
 if raw->>'type' is distinct from 'customer' or jsonb_typeof(raw->'id') is distinct from 'number'
  or raw->>'id' is distinct from v.external_id then
  raise exception 'business_input_customer_required' using errcode='22023';end if;
 if p_target is not null then
  execute format('select id from public.%I where tenant_id=$1 and id=$2 for share',target_table)
   into target using p_tenant,p_target;
  if target is null then raise exception 'business_input_target_unavailable' using errcode='22023';end if;
 else
  -- Copy only typed source fields. No invented email, consent, historical
  -- timestamps, performance score, or "verified" status is created.
  contact:=coalesce(nullif(raw->'contact','null'::jsonb),'{}'::jsonb);
  if jsonb_typeof(contact)<>'object' then raise exception 'business_input_customer_invalid' using errcode='22023';end if;
  foreach field_name in array array['firstName','lastName','telephone','mobile','email'] loop
   if contact ? field_name and contact->field_name<>'null'::jsonb and
    (jsonb_typeof(contact->field_name)<>'string' or length(contact->>field_name)>1000) then
    raise exception 'business_input_customer_invalid' using errcode='22023';end if;
  end loop;
  foreach field_name in array array['companyName','addressLine1','addressLine2','addressLine3','town','province','postcode'] loop
   if raw ? field_name and raw->field_name<>'null'::jsonb and
    (jsonb_typeof(raw->field_name)<>'string' or length(raw->>field_name)>1000) then
    raise exception 'business_input_customer_invalid' using errcode='22023';end if;
  end loop;
  address:=nullif(concat_ws(', ',nullif(btrim(raw->>'addressLine1'),''),nullif(btrim(raw->>'addressLine2'),''),
   nullif(btrim(raw->>'addressLine3'),''),nullif(btrim(raw->>'town'),''),nullif(btrim(raw->>'province'),'')),'');
  meta:=jsonb_build_object('learn_business_input',jsonb_build_object('connection_id',v.connection_id,
   'provider',v.provider,'collection',v.collection,'external_id',v.external_id,'source_version_id',v.id));
  if p_kind='person' then
   label:=nullif(btrim(concat_ws(' ',nullif(btrim(contact->>'firstName'),''),nullif(btrim(contact->>'lastName'),''))),'');
   if label is null then raise exception 'business_input_customer_name_required' using errcode='22023';end if;
   insert into public.people(tenant_id,display_name,first_name,last_name,primary_email,primary_phone,address_text,postcode,verified,created_source,metadata)
    values(p_tenant,label,nullif(btrim(contact->>'firstName'),''),nullif(btrim(contact->>'lastName'),''),
     nullif(btrim(contact->>'email'),''),coalesce(nullif(btrim(contact->>'telephone'),''),nullif(btrim(contact->>'mobile'),'')),
     address,nullif(btrim(raw->>'postcode'),''),false,'business_input:commusoft',meta) returning id into target;
  else
   label:=nullif(btrim(raw->>'companyName'),'');
   if label is null then raise exception 'business_input_customer_name_required' using errcode='22023';end if;
   insert into public.companies(tenant_id,name,phone,address_text,postcode,verified,created_source,metadata)
    values(p_tenant,label,coalesce(nullif(btrim(contact->>'telephone'),''),nullif(btrim(contact->>'mobile'),'')),
     address,nullif(btrim(raw->>'postcode'),''),false,'business_input:commusoft',meta) returning id into target;
  end if;
 end if;
 -- Reuse exactly the customer-card identity indexes used by governed imports.
 -- Existing titles, summaries, ownership, activity, assessments and metadata stay.
 if p_kind='person' then
  select display_name into label from public.people where id=target and tenant_id=p_tenant;
  insert into public.customer_cards(tenant_id,person_id,title,metadata)
   values(p_tenant,target,coalesce(nullif(btrim(label),''),'Imported customer'),jsonb_build_object('learn_source_version_id',v.id))
   on conflict(tenant_id,person_id) where person_id is not null do nothing returning id into card;
  if card is null then select id into card from public.customer_cards where tenant_id=p_tenant and person_id=target;end if;
 else
  select name into label from public.companies where id=target and tenant_id=p_tenant;
  insert into public.customer_cards(tenant_id,company_id,title,metadata)
   values(p_tenant,target,coalesce(nullif(btrim(label),''),'Imported customer'),jsonb_build_object('learn_source_version_id',v.id))
   on conflict(tenant_id,company_id) where person_id is null and company_id is not null do nothing returning id into card;
  if card is null then select id into card from public.customer_cards where tenant_id=p_tenant and company_id=target and person_id is null;end if;
 end if;
 perform 1 from public.customer_cards where id=card and tenant_id=p_tenant
  and ((p_kind='person' and person_id=target) or (p_kind='company' and person_id is null and company_id=target)) for share;
 if card is null or not found then raise exception 'business_input_card_changed' using errcode='40001';end if;
 insert into public.learn_business_input_links(tenant_id,connection_id,provider,collection,external_id,source_version_id,
  entity_kind,entity_table,entity_id,card_id,request,actor_id)
  values(p_tenant,v.connection_id,v.provider,v.collection,v.external_id,v.id,'customer',target_table,target,card,request,p_actor)
  returning * into l;
 return jsonb_build_object('link_id',l.id,'entity_table',target_table,'entity_id',target,'card_id',card,'already',false);
end $$;
revoke all on function public.learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text) to service_role;

-- Source: 20261031130000_learn_business_input_review.sql
create function public.learn_business_input_review_access(p_tenant uuid,p_connection uuid default null)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare f text;begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 perform public.learn_import_batch_authority(p_tenant,auth.uid());
 foreach f in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
  perform 1 from public.feature_flags where tenant_id=p_tenant and flag=f and value='true'::jsonb for share;
  if not found then raise exception 'business_input_module_unavailable' using errcode='42501';end if;
 end loop;
 perform 1 from public.tenant_connectors where tenant_id=p_tenant and provider='commusoft' and connector_id='commusoft' and enabled and status='active' for share;
 if not found then raise exception 'business_input_connector_unavailable' using errcode='42501';end if;
 if p_connection is not null then
  perform 1 from public.provider_connections where tenant_id=p_tenant and id=p_connection and provider='commusoft'
   and status='configured' and revoked_at is null and verified_at<=clock_timestamp() for share;
  if not found then raise exception 'business_input_connection_unavailable' using errcode='42501';end if;
 end if;
end $$;
create function public.learn_business_input_text(p_value jsonb,p_key text) returns text
language sql immutable set search_path=pg_catalog as $$
 select case when jsonb_typeof(p_value->p_key)='string' then nullif(left(btrim(p_value->>p_key),1000),'') end;
$$;
create function public.learn_business_customer_summary(p_value jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object(
  'person_name',nullif(concat_ws(' ',public.learn_business_input_text(p_value->'contact','firstName'),public.learn_business_input_text(p_value->'contact','lastName')),''),
  'company_name',public.learn_business_input_text(p_value,'companyName'),
  'email',public.learn_business_input_text(p_value->'contact','email'),
  'phone',coalesce(public.learn_business_input_text(p_value->'contact','telephone'),public.learn_business_input_text(p_value->'contact','mobile')),
  'address',nullif(concat_ws(', ',public.learn_business_input_text(p_value,'addressLine1'),public.learn_business_input_text(p_value,'addressLine2'),public.learn_business_input_text(p_value,'addressLine3'),public.learn_business_input_text(p_value,'town'),public.learn_business_input_text(p_value,'province')),''),
  'postcode',public.learn_business_input_text(p_value,'postcode'),
  'source_type',public.learn_business_input_text(p_value,'type'),
  'customer_type',case when jsonb_typeof(p_value->'customerType') in ('number','string') then left(p_value->>'customerType',100) end);
$$;
create function public.learn_commusoft_review_connections(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;begin
 perform public.learn_business_input_review_access(p_tenant);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(nullif(left(non_secret_config->>'account_key',150),''),'Commusoft connection')) order by id),'[]') into result
  from public.provider_connections where tenant_id=p_tenant and provider='commusoft' and status='configured' and revoked_at is null and verified_at<=clock_timestamp();
 return jsonb_build_object('tenant_id',p_tenant,'connections',result);
end $$;
create function public.learn_commusoft_review_page(p_tenant uuid,p_connection uuid,p_after text default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;more boolean;last_id text;begin
 if p_connection is null or p_limit is null or p_limit not between 1 and 50 or
  (p_after is not null and p_after!~'^[0-9]{1,16}$') then raise exception 'business_input_page_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 with identities as (
  select distinct external_id from public.learn_business_input_versions
  where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft' and collection='properties'
   and (p_after is null or external_id collate "C">p_after collate "C")
 ), latest as (
  select s.*,l.id as link_id,l.entity_table,l.entity_id,l.card_id,l.source_version_id as linked_version
  from identities i cross join lateral (
   select v.id,v.external_id,v.payload,p.committed_at from public.learn_business_input_versions v
   join public.learn_business_input_observations o on o.version_id=v.id join public.learn_business_input_pages p on p.id=o.page_id
   where v.tenant_id=p_tenant and v.connection_id=p_connection and v.provider='commusoft' and v.collection='properties' and v.external_id=i.external_id
    and p.tenant_id=v.tenant_id and p.connection_id=v.connection_id and p.provider=v.provider and p.collection=v.collection
   order by p.committed_at desc,v.id limit 1
  ) s left join public.learn_business_input_links l on l.tenant_id=p_tenant and l.connection_id=p_connection
    and l.provider='commusoft' and l.collection='properties' and l.external_id=s.external_id
  where s.payload->>'type'='customer' or l.entity_kind='customer'
 ), bounded as (select * from latest order by external_id collate "C" limit p_limit+1), output as (
  select *,row_number() over(order by external_id collate "C") as n from bounded
 )
 select coalesce(jsonb_agg(jsonb_build_object('version_id',id,'external_id',external_id,'observed_at',committed_at,
   'summary',public.learn_business_customer_summary(payload),
   'link',case when link_id is not null then jsonb_build_object('entity_table',entity_table,'entity_id',entity_id,'card_id',card_id,'source_version_id',linked_version) end)
   order by external_id collate "C") filter(where n<=p_limit),'[]'),count(*)>p_limit,
   max(external_id collate "C") filter(where n<=p_limit) into result,more,last_id from output;
 return jsonb_build_object('tenant_id',p_tenant,'connection_id',p_connection,'rows',result,'next_cursor',case when more then last_id end);
end $$;

create function public.learn_commusoft_customer_candidates(p_tenant uuid,p_version uuid,p_kind text,p_search text default '',p_after uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;s jsonb;q text;result jsonb;more boolean;last_id uuid;
begin
 if p_version is null or p_kind is null or p_kind not in ('person','company') or p_search is null or length(btrim(p_search))>150
  or length(btrim(p_search))=1 or p_limit is null or p_limit not between 1 and 50 then raise exception 'business_input_search_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant);
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant and provider='commusoft' and collection='properties';
 if not found then raise exception 'business_input_source_unavailable' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,v.connection_id);
 s:=public.learn_business_customer_summary(v.payload);q:=lower(btrim(p_search));
 with candidates as (
  select id,display_name as name,primary_email as email,primary_phone as phone,postcode from public.people where tenant_id=p_tenant and p_kind='person'
  union all select id,name,null,phone,postcode from public.companies where tenant_id=p_tenant and p_kind='company'
 ), matches as (
  select *,case
   when nullif(lower(btrim(email)),'')=nullif(lower(btrim(s->>'email')),'') then 'shared_email'
   when nullif(regexp_replace(phone,'[^0-9]','','g'),'')=nullif(regexp_replace(s->>'phone','[^0-9]','','g'),'') then 'shared_phone'
   when nullif(lower(btrim(name)),'')=nullif(lower(btrim(s->>case when p_kind='person' then 'person_name' else 'company_name' end)),'') then 'same_name'
   else 'search' end as reason from candidates
  where (p_after is null or id>p_after) and (
   (q<>'' and position(q in lower(concat_ws(' ',name,email,phone,postcode)))>0) or
   (q='' and (nullif(lower(btrim(email)),'')=nullif(lower(btrim(s->>'email')),'') or
    nullif(regexp_replace(phone,'[^0-9]','','g'),'')=nullif(regexp_replace(s->>'phone','[^0-9]','','g'),'') or
    nullif(lower(btrim(name)),'')=nullif(lower(btrim(s->>case when p_kind='person' then 'person_name' else 'company_name' end)),'') ))
  ) order by id limit p_limit+1
 ), numbered as (select *,row_number() over(order by id) as n from matches)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',left(name,1000),'email',left(email,1000),'phone',left(phone,1000),'postcode',left(postcode,1000),'reason',reason) order by id) filter(where n<=p_limit),'[]'),
  count(*)>p_limit,(array_agg(id order by id) filter(where n<=p_limit))[p_limit] into result,more,last_id from numbered;
 return jsonb_build_object('tenant_id',p_tenant,'version_id',p_version,'kind',p_kind,'rows',result,'next_cursor',case when more then last_id end);
end $$;

-- The existing private writer remains uncallable by authenticated clients.
-- The new facade supplies auth.uid(), never a caller-selected actor.
do $$declare d text;needle text:='if auth.role() is distinct from ''service_role'' then';begin
 d:=pg_get_functiondef('public.learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'business_input_writer_contract_changed';end if;
 execute replace(d,needle,'if auth.role() is distinct from ''service_role'' and not (auth.role()=''authenticated'' and auth.uid() is not null and p_actor is not distinct from auth.uid()) then');
end $$;
create function public.learn_commusoft_confirm_customer(p_tenant uuid,p_version uuid,p_kind text,p_target uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 return public.learn_commusoft_review_customer(p_tenant,auth.uid(),p_version,p_kind,p_target,p_reason);
end $$;
revoke all on function public.learn_business_input_review_access(uuid,uuid),public.learn_business_input_text(jsonb,text),public.learn_business_customer_summary(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.learn_commusoft_review_connections(uuid),public.learn_commusoft_review_page(uuid,uuid,text,integer),public.learn_commusoft_customer_candidates(uuid,uuid,text,text,uuid,integer),public.learn_commusoft_confirm_customer(uuid,uuid,text,uuid,text) from public,anon,service_role;
grant execute on function public.learn_commusoft_review_connections(uuid),public.learn_commusoft_review_page(uuid,uuid,text,integer),public.learn_commusoft_customer_candidates(uuid,uuid,text,text,uuid,integer),public.learn_commusoft_confirm_customer(uuid,uuid,text,uuid,text) to authenticated;

-- Source: 20261031140000_learn_business_input_work.sql
create table public.learn_business_input_projection_attempts (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,
 source_version_id uuid not null references public.learn_business_input_versions(id) on delete restrict,
 actor_id uuid not null,request jsonb not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_business_input_projection_attempts enable row level security;
revoke all on public.learn_business_input_projection_attempts from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.learn_business_input_projection_attempts
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.learn_business_input_projection_attempts
 for each statement execute function public.learn_business_input_retain();
create index learn_business_input_projection_attempts_source_idx
 on public.learn_business_input_projection_attempts(tenant_id,source_version_id,created_at);

create function public.learn_business_input_latest(p_tenant uuid,p_connection uuid,p_provider text,p_collection text,p_external text)
returns public.learn_business_input_versions language plpgsql set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;t timestamptz;n integer;begin
 select max(p.committed_at) into t from public.learn_business_input_versions s
  join public.learn_business_input_observations o on o.version_id=s.id join public.learn_business_input_pages p on p.id=o.page_id
  where s.tenant_id=p_tenant and s.connection_id=p_connection and s.provider=p_provider and s.collection=p_collection and s.external_id=p_external
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection;
 select count(distinct s.id) into n from public.learn_business_input_versions s
  join public.learn_business_input_observations o on o.version_id=s.id join public.learn_business_input_pages p on p.id=o.page_id
  where s.tenant_id=p_tenant and s.connection_id=p_connection and s.provider=p_provider and s.collection=p_collection and s.external_id=p_external
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection and p.committed_at=t;
 if n<>1 then return v;end if;
 select s.* into v from public.learn_business_input_versions s
  join public.learn_business_input_observations o on o.version_id=s.id join public.learn_business_input_pages p on p.id=o.page_id
  where s.tenant_id=p_tenant and s.connection_id=p_connection and s.provider=p_provider and s.collection=p_collection and s.external_id=p_external
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection and p.committed_at=t limit 1;
 return v;
end $$;

-- Called only while the authenticated projector holds connection/roster locks.
-- Resolve each property in its original connection; numeric IDs never become FKs.
create function public.learn_commusoft_property_owner(p_tenant uuid,p_connection uuid,p_external text,p_allow_site boolean default true)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;l public.learn_business_input_links%rowtype;
 s public.sites%rowtype;owner jsonb;person uuid;company uuid;parent text;original jsonb;begin
 v:=public.learn_business_input_latest(p_tenant,p_connection,'commusoft','properties',p_external);
 if v.id is null then return jsonb_build_object('state','held','reason','property_missing_or_ambiguous');end if;
 select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=p_connection
  and provider='commusoft' and collection='properties' and external_id=p_external;
 if not found then return jsonb_build_object('state','held','reason','property_identity_unreviewed');end if;
 if v.payload->>'type'='customer' and l.entity_kind='customer' then
  if l.entity_table='people' then
   select id into person from public.people where tenant_id=p_tenant and id=l.entity_id for share;
  elsif l.entity_table='companies' then
   select id into company from public.companies where tenant_id=p_tenant and id=l.entity_id for share;
  end if;
  if person is null and company is null then return jsonb_build_object('state','held','reason','customer_target_missing');end if;
  perform 1 from public.customer_cards where id=l.card_id and tenant_id=p_tenant and
   ((person is not null and person_id=person) or (company is not null and person_id is null and company_id=company)) for share;
  if not found then return jsonb_build_object('state','held','reason','customer_card_changed');end if;
  return jsonb_build_object('state','ready','person_id',person,'company_id',company,'site_id',null,'card_id',l.card_id,'customer_link_id',l.id);
 elsif p_allow_site and v.payload->>'type'='workaddress' and l.entity_kind='site' and l.entity_table='sites' then
  parent:=v.payload->>'parentPropertyID';
  if jsonb_typeof(v.payload->'parentPropertyID') is distinct from 'number' or parent!~'^[1-9][0-9]{0,15}$' or parent=p_external then
   return jsonb_build_object('state','held','reason','site_parent_invalid');end if;
  select payload into original from public.learn_business_input_versions where id=l.source_version_id;
  if original->>'parentPropertyID' is distinct from parent then return jsonb_build_object('state','held','reason','site_source_owner_changed');end if;
  owner:=public.learn_commusoft_property_owner(p_tenant,p_connection,parent,false);
  if owner->>'state'<>'ready' then return owner;end if;
  select * into s from public.sites where id=l.entity_id and tenant_id=p_tenant for share;
  if not found or s.person_id is distinct from (owner->>'person_id')::uuid or s.company_id is distinct from (owner->>'company_id')::uuid then
   return jsonb_build_object('state','held','reason','site_canonical_owner_changed');end if;
  return owner||jsonb_build_object('site_id',s.id,'site_link_id',l.id);
 end if;
 return jsonb_build_object('state','held','reason','property_kind_changed');
end $$;

create function public.learn_business_input_projection_result(p_tenant uuid,p_version uuid,p_request jsonb,p_result jsonb)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare attempt uuid;begin
 insert into public.learn_business_input_projection_attempts(tenant_id,source_version_id,actor_id,request,result)
  values(p_tenant,p_version,auth.uid(),p_request,p_result) returning id into attempt;
 return p_result||jsonb_build_object('attempt_id',attempt);
end $$;

create function public.learn_commusoft_confirm_work_record(p_tenant uuid,p_version uuid,p_target uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 v public.learn_business_input_versions%rowtype;latest public.learn_business_input_versions%rowtype;
 l public.learn_business_input_links%rowtype;s public.sites%rowtype;j public.jobs%rowtype;
 owner jsonb;request jsonb;result jsonb;meta jsonb;field text;kind text;parent text;reason text;target uuid;
 person uuid;company uuid;site uuid;namespace text;address text;status text;created timestamptz;completed timestamptz;ts text;
begin
 perform public.learn_business_input_review_access(p_tenant);
 if p_version is null or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then
  raise exception 'business_input_review_invalid' using errcode='22023';end if;
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant and provider='commusoft';
 if not found or not (v.collection='jobs' or (v.collection='properties' and v.payload->>'type'='workaddress')) then
  raise exception 'business_input_work_source_required' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,v.connection_id);
 perform 1 from public.provider_connections where tenant_id=p_tenant and id=v.connection_id for update;
 kind:=case when v.collection='jobs' then 'job' else 'site' end;
 request:=jsonb_build_object('target',p_target,'reason',btrim(p_reason),'kind',kind);
 -- The block exits on a held condition; the final attempt records the reason.
 <<project>> begin
  latest:=public.learn_business_input_latest(p_tenant,v.connection_id,v.provider,v.collection,v.external_id);
  if latest.id is distinct from v.id then reason:='source_changed_or_ambiguous';exit project;end if;
  if jsonb_typeof(v.payload->'id') is distinct from 'number' or v.payload->>'id' is distinct from v.external_id then reason:='source_identity_invalid';exit project;end if;
  select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=v.connection_id
   and provider=v.provider and collection=v.collection and external_id=v.external_id;
  if found and (l.source_version_id<>v.id or l.entity_kind<>kind or (p_target is not null and p_target<>l.entity_id)) then
   reason:='existing_identity_needs_review';exit project;end if;
  field:=case when kind='site' then 'parentPropertyID' else 'propertyID' end;parent:=v.payload->>field;
  if jsonb_typeof(v.payload->field) is distinct from 'number' or parent!~'^[1-9][0-9]{0,15}$'
   or (kind='site' and parent=v.external_id) then reason:='property_reference_invalid';exit project;end if;
  if parent::numeric>9007199254740991 then reason:='property_reference_invalid';exit project;end if;
  owner:=public.learn_commusoft_property_owner(p_tenant,v.connection_id,parent,kind='job');
  if owner->>'state'<>'ready' then reason:=owner->>'reason';exit project;end if;
  person:=(owner->>'person_id')::uuid;company:=(owner->>'company_id')::uuid;site:=(owner->>'site_id')::uuid;
  target:=coalesce(l.entity_id,p_target);namespace:='commusoft:connection:'||v.connection_id::text;
  if target is null then
   -- Existing CSV imports are candidates, not proof of the same provider account.
   if kind='site' and exists(select 1 from public.sites where tenant_id=p_tenant and source_system in ('commusoft',namespace) and external_id=v.external_id)
    or kind='job' and exists(select 1 from public.jobs where tenant_id=p_tenant and source_system in ('commusoft',namespace) and external_id=v.external_id) then
    reason:='existing_external_identity_needs_review';exit project;end if;
   meta:=jsonb_build_object('learn_business_input',jsonb_build_object('connection_id',v.connection_id,'source_version_id',v.id,'property_external_id',parent,'relationships',owner));
   if kind='site' then
    foreach field in array array['addressLine1','addressLine2','addressLine3','town','province','postcode'] loop
     if v.payload ? field and v.payload->field<>'null'::jsonb and (jsonb_typeof(v.payload->field)<>'string' or length(v.payload->>field)>1000) then reason:='site_field_invalid';exit project;end if;
    end loop;
    address:=public.learn_business_customer_summary(v.payload)->>'address';
    insert into public.sites(tenant_id,source_system,external_id,person_id,company_id,label,address_text,postcode,created_source,verified,metadata)
     values(p_tenant,namespace,v.external_id,person,company,coalesce(public.learn_business_input_text(v.payload,'addressLine1'),'Work site '||v.external_id),address,
      public.learn_business_input_text(v.payload,'postcode'),'business_input:commusoft',false,meta) returning id into target;
   else
    if jsonb_typeof(v.payload->'status') is distinct from 'string' or v.payload->>'status' not in ('Open','Complete','Closed') then reason:='job_status_unrecognised';exit project;end if;
    if v.payload ? 'description' and v.payload->'description'<>'null'::jsonb and (jsonb_typeof(v.payload->'description')<>'string' or length(v.payload->>'description')>1000) then reason:='job_field_invalid';exit project;end if;
    status:=case v.payload->>'status' when 'Open' then 'open' when 'Complete' then 'completed' else 'closed' end;
    if v.payload ? 'completed' and v.payload->'completed'<>'null'::jsonb and jsonb_typeof(v.payload->'completed')<>'object' then reason:='job_timestamp_invalid';exit project;end if;
    -- Only explicit source timestamps with a timezone are eligible. Closed does
    -- not mean completed: outcome, money, staff and reward semantics stay raw.
    foreach field in array array['created','completed'] loop
     ts:=case when field='created' then v.payload->>'createdOnDateTime' else v.payload->'completed'->>'completedOnDateTime' end;
     if ts is not null then
      if ts!~'^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then reason:='job_timestamp_invalid';exit project;end if;
      begin if field='created' then created:=ts::timestamptz;else completed:=ts::timestamptz;end if;
      exception when invalid_datetime_format or datetime_field_overflow then reason:='job_timestamp_invalid';exit project;end;
     end if;
    end loop;
    insert into public.jobs(tenant_id,source_system,external_id,job_number,customer_person_id,customer_company_id,site_id,title,description,status,created_date,completed_date,created_source,verified,metadata)
     values(p_tenant,namespace,v.external_id,v.external_id,person,company,site,coalesce(public.learn_business_input_text(v.payload,'description'),'Job '||v.external_id),
      public.learn_business_input_text(v.payload,'description'),status,created,completed,'business_input:commusoft',false,meta) returning id into target;
   end if;
  else
   if kind='site' then
    select * into s from public.sites where tenant_id=p_tenant and id=target for share;
    if not found or s.person_id is distinct from person or s.company_id is distinct from company then reason:='target_site_owner_mismatch';exit project;end if;
   else
    select * into j from public.jobs where tenant_id=p_tenant and id=target for share;
    if not found or j.customer_person_id is distinct from person or j.customer_company_id is distinct from company or j.site_id is distinct from site then reason:='target_job_owner_mismatch';exit project;end if;
   end if;
  end if;
  if l.id is null then
   insert into public.learn_business_input_links(tenant_id,connection_id,provider,collection,external_id,source_version_id,entity_kind,entity_table,entity_id,card_id,request,actor_id)
    values(p_tenant,v.connection_id,v.provider,v.collection,v.external_id,v.id,kind,case when kind='site' then 'sites' else 'jobs' end,target,(owner->>'card_id')::uuid,request,auth.uid()) returning * into l;
   result:=jsonb_build_object('state','linked','entity_id',target,'entity_kind',kind,'link_id',l.id,'already',false);
  else result:=jsonb_build_object('state','linked','entity_id',target,'entity_kind',kind,'link_id',l.id,'already',true);end if;
 end project;
 if reason is not null then result:=jsonb_build_object('state','held','reason',reason);end if;
 return public.learn_business_input_projection_result(p_tenant,v.id,request,result);
end $$;
revoke all on function public.learn_business_input_latest(uuid,uuid,text,text,text),public.learn_commusoft_property_owner(uuid,uuid,text,boolean),public.learn_business_input_projection_result(uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.learn_commusoft_confirm_work_record(uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.learn_commusoft_confirm_work_record(uuid,uuid,uuid,text) to authenticated;

-- Source: 20261031150000_learn_business_input_work_batches.sql
create table public.learn_business_input_projection_batches (
 tenant_id uuid not null,id uuid not null,actor_id uuid not null,request jsonb not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,id)
);
alter table public.learn_business_input_projection_batches enable row level security;
revoke all on public.learn_business_input_projection_batches from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.learn_business_input_projection_batches
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.learn_business_input_projection_batches
 for each statement execute function public.learn_business_input_retain();

create function public.learn_commusoft_work_batch(p_tenant uuid,p_request uuid,p_connection uuid,p_kind text,p_items jsonb,p_reason text,p_cancel boolean default false,p_expected_actor uuid default auth.uid())
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b public.learn_business_input_projection_batches%rowtype;v public.learn_business_input_versions%rowtype;
 request jsonb;result jsonb;outcomes jsonb:='[]';item jsonb;outcome jsonb;version uuid;target uuid;
 seen uuid[]:='{}';identities text[]:='{}';linked integer:=0;held integer:=0;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 if p_expected_actor is distinct from auth.uid() then raise exception 'business_input_actor_changed' using errcode='42501';end if;
 -- Existing tenant roster lock also serializes competing confirmations/cancellations.
 perform public.learn_import_batch_authority(p_tenant,auth.uid());
 if p_request is null or p_connection is null or p_kind is null or p_kind not in ('site','job') or p_cancel is null
  or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 or jsonb_typeof(p_items) is distinct from 'array'
  or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'business_input_batch_invalid' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>2
   or jsonb_typeof(item->'version_id') is distinct from 'string' or item->>'version_id'!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   or not item ? 'target_id' or not (item->'target_id'='null'::jsonb or (jsonb_typeof(item->'target_id')='string' and item->>'target_id'~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')) then
   raise exception 'business_input_batch_item_invalid' using errcode='22023';end if;
  version:=(item->>'version_id')::uuid;
  if version=any(seen) then raise exception 'business_input_batch_duplicate' using errcode='22023';end if;
  seen:=array_append(seen,version);
 end loop;
 request:=jsonb_build_object('connection_id',p_connection,'kind',p_kind,'items',p_items,'reason',btrim(p_reason));
 select * into b from public.learn_business_input_projection_batches where tenant_id=p_tenant and id=p_request;
 if found then
  if b.actor_id is distinct from auth.uid() or b.request is distinct from request then raise exception 'business_input_batch_conflict' using errcode='PT409';end if;
  return b.result; -- A saved cancellation also fences a late original apply.
 end if;
 if not p_cancel then
  perform public.learn_business_input_review_access(p_tenant,p_connection);
  perform 1 from public.provider_connections where id=p_connection and tenant_id=p_tenant for update;
  -- Prevalidate every scope before any row is projected. Unknown/foreign rows
  -- abort the batch, rather than becoming successful partial application.
  for item in select value from jsonb_array_elements(p_items) loop
   select * into v from public.learn_business_input_versions where id=(item->>'version_id')::uuid and tenant_id=p_tenant
    and connection_id=p_connection and provider='commusoft';
   if not found or (p_kind='job' and v.collection<>'jobs') or
    (p_kind='site' and (v.collection<>'properties' or v.payload->>'type' is distinct from 'workaddress')) then
    raise exception 'business_input_batch_scope_invalid' using errcode='22023';end if;
   if v.external_id=any(identities) then raise exception 'business_input_batch_identity_duplicate' using errcode='22023';end if;
   identities:=array_append(identities,v.external_id);
  end loop;
  for item in select value from jsonb_array_elements(p_items) loop
   outcome:=public.learn_commusoft_confirm_work_record(p_tenant,(item->>'version_id')::uuid,(item->>'target_id')::uuid,btrim(p_reason));
   if outcome->>'state'='linked' then linked:=linked+1;
   elsif outcome->>'state'='held' then held:=held+1;
   else raise exception 'business_input_batch_outcome_invalid';end if;
   outcomes:=outcomes||jsonb_build_array(jsonb_build_object('version_id',item->>'version_id','outcome',outcome));
  end loop;
 end if;
 result:=jsonb_build_object('batch_id',p_request,'tenant_id',p_tenant,'actor_id',auth.uid(),'connection_id',p_connection,'kind',p_kind,
  'state',case when p_cancel then 'cancelled' else 'recorded' end,'items',outcomes,'linked',linked,'held',held);
 insert into public.learn_business_input_projection_batches(tenant_id,id,actor_id,request,result) values(p_tenant,p_request,auth.uid(),request,result);
 return result;
end $$;

create function public.learn_commusoft_work_batch_result(p_tenant uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 perform public.learn_import_batch_authority(p_tenant,auth.uid());
 if p_request is null then raise exception 'business_input_batch_invalid' using errcode='22023';end if;
 select b.result into result from public.learn_business_input_projection_batches b where tenant_id=p_tenant and id=p_request and actor_id=auth.uid();
 return result; -- null is an observed absence, never a cancelled/incomplete write guarantee.
end $$;

create function public.learn_commusoft_work_review_page(p_tenant uuid,p_connection uuid,p_kind text,p_after text default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r record;v public.learn_business_input_versions%rowtype;l public.learn_business_input_links%rowtype;
 rows jsonb:='[]';owner jsonb;attempt jsonb;label text;parent text;customer text;v_collection text;last_id text;counted integer:=0;more boolean:=false;
begin
 if p_connection is null or p_kind is null or p_kind not in ('site','job') or p_limit is null or p_limit not between 1 and 50
  or (p_after is not null and p_after!~'^[0-9]{1,16}$') then raise exception 'business_input_page_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 v_collection:=case when p_kind='site' then 'properties' else 'jobs' end;
 for r in select distinct s.external_id collate "C" as external_id from public.learn_business_input_versions s where s.tenant_id=p_tenant and s.connection_id=p_connection
  and s.provider='commusoft' and s.collection=v_collection and (p_kind='job' or s.payload->>'type'='workaddress')
  and (p_after is null or s.external_id collate "C">p_after collate "C") order by s.external_id collate "C" limit p_limit+1 loop
  counted:=counted+1;if counted>p_limit then more:=true;exit;end if;last_id:=r.external_id;
  v:=public.learn_business_input_latest(p_tenant,p_connection,'commusoft',v_collection,r.external_id);
  select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and learn_business_input_links.collection=v_collection and external_id=r.external_id;
  parent:=case when p_kind='site' then v.payload->>'parentPropertyID' else v.payload->>'propertyID' end;
  owner:=case when v.id is null then jsonb_build_object('state','held','reason','source_changed_or_ambiguous')
   else public.learn_commusoft_property_owner(p_tenant,p_connection,parent,p_kind='job') end;
  customer:=null;
  if owner->>'state'='ready' then
   if owner->>'person_id' is not null then select display_name into customer from public.people where tenant_id=p_tenant and id=(owner->>'person_id')::uuid;
   else select name into customer from public.companies where tenant_id=p_tenant and id=(owner->>'company_id')::uuid;end if;
  end if;
  select a.result into attempt from public.learn_business_input_projection_attempts a where a.tenant_id=p_tenant and a.source_version_id=v.id order by a.created_at desc,a.id desc limit 1;
  label:=case when p_kind='site' then public.learn_business_input_text(v.payload,'addressLine1') else public.learn_business_input_text(v.payload,'description') end;
  rows:=rows||jsonb_build_array(jsonb_build_object('external_id',r.external_id,'version_id',v.id,'title',coalesce(label,initcap(p_kind)||' '||r.external_id),
   'property_reference',case when parent~'^[1-9][0-9]{0,15}$' then parent end,'customer_name',left(customer,1000),'relationship_reason',owner->>'reason',
   'source_status',public.learn_business_input_text(v.payload,'status'),'linked_version_id',l.source_version_id,'last_result',attempt,
   'selectable',v.id is not null and coalesce(p_kind='job' or v.payload->>'type'='workaddress',false)));
 end loop;
 return jsonb_build_object('tenant_id',p_tenant,'connection_id',p_connection,'kind',p_kind,'rows',rows,'next_cursor',case when more then last_id end);
end $$;
revoke all on function public.learn_commusoft_work_batch(uuid,uuid,uuid,text,jsonb,text,boolean,uuid),public.learn_commusoft_work_batch_result(uuid,uuid),public.learn_commusoft_work_review_page(uuid,uuid,text,text,integer) from public,anon,service_role;
grant execute on function public.learn_commusoft_work_batch(uuid,uuid,uuid,text,jsonb,text,boolean,uuid),public.learn_commusoft_work_batch_result(uuid,uuid),public.learn_commusoft_work_review_page(uuid,uuid,text,text,integer) to authenticated;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_commusoft_inputs_v1','saatxzwxvdvqevbnskxy');
notify pgrst,'reload schema';
commit;
