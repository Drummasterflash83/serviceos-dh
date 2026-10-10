-- Retained provider-neutral source pages/versions. No canonical projection,
-- scheduler, provider call, backfill or deletion of existing source data.
begin;
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
commit;
