-- Property-scoped contact traversal. Initial approvals allow at most 10,000 pages;
-- each continuation allows at most 10,000 further pages without discarding prior progress. No provider calls, grants to operators,
-- credentials, tenant switches, jobs, schedules or data backfill on installation.
begin;
create table public.learn_commusoft_contact_targets (
 tenant_id uuid not null,
 connection_id uuid not null,
 approval_id uuid not null,
 property_id bigint not null check(property_id between 1 and 9007199254740991),
 property_type text not null check(property_type in ('customer','workaddress')),
 source_version_id uuid not null references public.learn_business_input_versions(id),
 position integer not null check(position>0),
 next_property_id bigint check(next_property_id between 1 and 9007199254740991),
 primary key(tenant_id,connection_id,approval_id,property_id),
 unique(tenant_id,connection_id,approval_id,position)
);
alter table public.learn_commusoft_contact_targets enable row level security;
revoke all on public.learn_commusoft_contact_targets from public,anon,authenticated,service_role;
grant select on public.learn_commusoft_contact_targets to service_role;
create trigger retain_rows before update or delete on public.learn_commusoft_contact_targets
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.learn_commusoft_contact_targets
 for each statement execute function public.learn_business_input_retain();

-- Same private target validation for credential release and page publication.
-- A plan is frozen from one completed property traversal, never caller-supplied IDs.
create function public.learn_commusoft_contact_target(p_tenant uuid,p_connection uuid,p_cfg jsonb,p_cp jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare t public.learn_commusoft_contact_targets%rowtype;prop bigint;done integer;total integer;
begin
 if p_cfg->>'resource' is distinct from 'propertyContacts' or p_cfg->>'contactPlanVersion' is distinct from '1'
  or coalesce(p_cfg->>'contactType','') not in ('customer','workaddress')
  or jsonb_typeof(p_cfg->'contactTargetCount') is distinct from 'number'
  or coalesce(p_cfg->>'contactTargetCount','')!~'^[1-9][0-9]{0,8}$'
  or jsonb_typeof(p_cfg->'firstPropertyId') is distinct from 'number'
  or coalesce(p_cfg->>'firstPropertyId','')!~'^[1-9][0-9]{0,15}$' then return null;end if;
 total:=(p_cfg->>'contactTargetCount')::integer;
 if p_cp='{}'::jsonb then prop:=(p_cfg->>'firstPropertyId')::bigint;done:=0;
 else
  if p_cp->>'approvalId' is distinct from p_cfg->>'approvalId' or p_cp->'complete' is distinct from 'false'::jsonb
   or jsonb_typeof(p_cp->'propertyId') is distinct from 'number' or coalesce(p_cp->>'propertyId','')!~'^[1-9][0-9]{0,15}$'
   or jsonb_typeof(p_cp->'propertiesCompleted') is distinct from 'number' or coalesce(p_cp->>'propertiesCompleted','')!~'^[0-9]{1,9}$' then return null;end if;
  prop:=(p_cp->>'propertyId')::bigint;done:=(p_cp->>'propertiesCompleted')::integer;
 end if;
 select * into t from public.learn_commusoft_contact_targets where tenant_id=p_tenant and connection_id=p_connection
  and approval_id=(p_cfg->>'approvalId')::uuid and property_id=prop;
 if not found or t.property_type is distinct from p_cfg->>'contactType' or t.position<>done+1 or done>=total
  or (t.next_property_id is null) is distinct from (t.position=total) then return null;end if;
 return jsonb_build_object('propertyId',t.property_id,'nextPropertyId',t.next_property_id,'position',t.position,'total',total);
end $$;
revoke all on function public.learn_commusoft_contact_target(uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
create or replace function public.learn_operator_input_request(
 p_tenant uuid,p_request uuid,p_actor uuid,p_definition jsonb,p_mode text default 'apply'
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.learn_operator_input_requests%rowtype;c public.provider_connections%rowtype;
 tc public.tenant_connectors%rowtype;a public.connector_accounts%rowtype;
 receipt jsonb;previous jsonb;scope jsonb;flags jsonb;kind text;reason text;k text;
 connection_id uuid;revision timestamptz;expiry timestamptz;resource text;contact_type text;
 pages integer;page_size integer;aid uuid;jid uuid:=gen_random_uuid();
 property_approval uuid;target_count integer;first_property bigint;
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_mode is null or p_mode not in ('apply','check','cancel')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>10000 then
  raise exception 'learn_operator_request_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-request:'||p_request::text,0));
 select * into prior from public.learn_operator_input_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.definition<>p_definition then
   raise exception 'learn_operator_request_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if p_mode='check' then return jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','pending');end if;
 if p_mode='cancel' then
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','cancelled');
  insert into public.learn_operator_input_requests(id,tenant_id,actor_id,definition,receipt)
   values(p_request,p_tenant,p_actor,p_definition,receipt);
  return receipt;
 end if;
 kind:=p_definition->>'kind';reason:=p_definition->>'reason';
 if jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(reason)) not between 1 and 1000
  or kind is null or kind not in ('set_modules','start_commusoft') then raise exception 'learn_operator_definition_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 if kind='set_modules' then
  if (select count(*) from jsonb_object_keys(p_definition))<>4
   or jsonb_typeof(p_definition->'expected') is distinct from 'object'
   or jsonb_typeof(p_definition->'values') is distinct from 'object'
   or (select count(*) from jsonb_object_keys(p_definition->'values'))<>2
   or jsonb_typeof(p_definition->'values'->'learn.enabled') is distinct from 'boolean'
   or jsonb_typeof(p_definition->'values'->'learn.inputs.commusoft.enabled') is distinct from 'boolean' then
   raise exception 'learn_operator_flags_invalid' using errcode='22023';end if;
  perform 1 from public.feature_flags where tenant_id=p_tenant and flag in ('learn.enabled','learn.inputs.commusoft.enabled') order by flag for update;
  flags:=public.learn_operator_input_flags(p_tenant);
  if flags is distinct from p_definition->'expected' then raise exception 'learn_operator_flags_changed' using errcode='PT409';end if;
  previous:=flags;
  foreach k in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
   update public.feature_flags set value=p_definition->'values'->k where tenant_id=p_tenant and flag=k;
   if not found then insert into public.feature_flags(tenant_id,flag,value) values(p_tenant,k,p_definition->'values'->k);end if;
  end loop;
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','recorded','kind',kind,'flags',p_definition->'values');
 else
  if not p_definition ?& array['kind','reason','connection_id','revision','resource','max_pages','page_size','expires_at']
   or (p_definition-array['kind','reason','connection_id','revision','resource','contact_type','max_pages','page_size','expires_at'])<>'{}'::jsonb
   or jsonb_typeof(p_definition->'connection_id') is distinct from 'string'
   or p_definition->>'connection_id'!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   or jsonb_typeof(p_definition->'max_pages') is distinct from 'number' or p_definition->>'max_pages'!~'^[0-9]{1,5}$'
   or jsonb_typeof(p_definition->'page_size') is distinct from 'number' or p_definition->>'page_size'!~'^[0-9]{1,3}$'
   or jsonb_typeof(p_definition->'revision') is distinct from 'string'
   or jsonb_typeof(p_definition->'expires_at') is distinct from 'string' then raise exception 'learn_operator_import_invalid' using errcode='22023';end if;
  connection_id:=(p_definition->>'connection_id')::uuid;revision:=(p_definition->>'revision')::timestamptz;
  expiry:=(p_definition->>'expires_at')::timestamptz;resource:=p_definition->>'resource';contact_type:=p_definition->>'contact_type';
  pages:=(p_definition->>'max_pages')::integer;page_size:=(p_definition->>'page_size')::integer;
  if not isfinite(revision) or not isfinite(expiry) or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '24 hours'
   or pages not between 1 and 10000 or page_size not between 1 and 100 or resource is null or resource not in ('properties','propertyContacts','jobs')
   or (resource='propertyContacts' and (contact_type is null or contact_type not in ('customer','workaddress')))
   or (resource<>'propertyContacts' and p_definition ? 'contact_type') then raise exception 'learn_operator_import_invalid' using errcode='22023';end if;
  perform 1 from public.tenants where id=p_tenant and status='active';
  if not found then raise exception 'learn_operator_tenant_inactive' using errcode='55000';end if;
  foreach k in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
   perform 1 from public.feature_flags where tenant_id=p_tenant and flag=k and value='true'::jsonb for share;
   if not found then raise exception 'learn_operator_module_disabled' using errcode='55000';end if;
  end loop;
  select * into c from public.provider_connections where id=connection_id and tenant_id=p_tenant for share;
  if not found or c.provider is distinct from 'commusoft' or c.status is distinct from 'configured' or c.auth_mode is distinct from 'private_api_key'
   or c.revoked_at is not null or c.verified_at is null or c.verified_at>clock_timestamp() or c.updated_at is distinct from revision
   or coalesce(c.non_secret_config->>'region','') not in ('uk','us')
   or length(btrim(coalesce(c.non_secret_config->>'account_key',''))) not between 1 and 2000
   or not coalesce('api_key'=any(c.configured_fields),false)
   or coalesce(c.secret_refs->>'api_key','')!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
   raise exception 'learn_operator_connection_changed' using errcode='PT409';end if;
  -- Existence only: the setup surface never selects a secret value. The worker
  -- still revalidates the tenant-qualified secret and all authority at acquisition.
  perform 1 from vault.secrets where id=(c.secret_refs->>'api_key')::uuid and name='provider_secret:'||p_tenant::text||':commusoft:api_key';
  if not found then raise exception 'learn_operator_credential_missing' using errcode='55000';end if;
  select * into tc from public.tenant_connectors where tenant_id=p_tenant and connector_id='commusoft' for update;
  if not found then
   insert into public.tenant_connectors(tenant_id,connector_id,provider,category,status,enabled)
    values(p_tenant,'commusoft','commusoft','business_input','active',true) returning * into tc;
  elsif tc.provider is distinct from 'commusoft' or tc.enabled is distinct from true or tc.status is distinct from 'active' then
   raise exception 'learn_operator_connector_disabled' using errcode='55000';
  end if;
  select * into a from public.connector_accounts where tenant_id=p_tenant and tenant_connector_id=tc.id and account_key=c.non_secret_config->>'account_key' for update;
  if found then
   if a.status is distinct from 'active' or exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync'
    and payload->>'connector_account_id'=a.id::text and status in ('queued','running','retrying')) then
    raise exception 'learn_operator_import_active' using errcode='55000';end if;
   if a.settings ? 'commusoft_import' and (a.sync_cursor->'complete' is distinct from 'true'::jsonb
    or a.sync_cursor->>'approvalId' is distinct from a.settings->'commusoft_import'->>'approvalId') then
    raise exception 'learn_operator_import_incomplete' using errcode='55000';end if;
   if a.settings ? 'commusoft_import' and a.settings->'commusoft_import'->>'connectionId' is distinct from c.id::text then
    raise exception 'learn_operator_account_connection_changed' using errcode='PT409';end if;
   previous:=jsonb_build_object('approval',a.settings->'commusoft_import','checkpoint',a.sync_cursor);aid:=a.id;
  else
   insert into public.connector_accounts(tenant_id,tenant_connector_id,account_key,display_name,status)
    values(p_tenant,tc.id,c.non_secret_config->>'account_key','Commusoft','active') returning id into aid;
  end if;
  scope:=jsonb_build_object('approved',true,'approvalId',p_request,'connectionId',c.id,'consentReference','learn-operator-input:'||p_request::text,
   'expiresAt',expiry,'maxPages',pages,'pageSize',page_size,'resource',resource)
   ||case when resource='propertyContacts' then jsonb_build_object('contactType',contact_type) else '{}'::jsonb end;
  if resource='propertyContacts' then
   -- Use the last completed property traversal, not the mutable newest union of
   -- source versions. Account/connection locks serialize approvals and imports.
   select (p.checkpoint_after->>'approvalId')::uuid into property_approval
    from public.learn_business_input_pages p where p.tenant_id=p_tenant and p.connection_id=c.id
     and p.provider='commusoft' and p.collection='properties' and p.checkpoint_after->'complete'='true'::jsonb
    order by p.committed_at desc,p.id desc limit 1;
   if property_approval is null then raise exception 'learn_operator_property_traversal_required' using errcode='55000';end if;
   with observed as (
    select distinct on(v.external_id) v.id,v.payload,v.external_id
     from public.learn_business_input_pages p
     join public.learn_business_input_observations o on o.page_id=p.id
     join public.learn_business_input_versions v on v.id=o.version_id and v.tenant_id=p.tenant_id
      and v.connection_id=p.connection_id and v.provider=p.provider and v.collection=p.collection
     where p.tenant_id=p_tenant and p.connection_id=c.id and p.provider='commusoft' and p.collection='properties'
      and p.checkpoint_after->>'approvalId'=property_approval::text
     order by v.external_id,(p.checkpoint_after->>'pages')::integer desc
   ), chosen as (
    select id,(payload->>'id')::bigint as property_id from observed
     where payload->>'type'=contact_type and jsonb_typeof(payload->'id')='number'
      and payload->>'id'~'^[1-9][0-9]{0,15}$' and payload->>'id'=external_id
   ) insert into public.learn_commusoft_contact_targets(tenant_id,connection_id,approval_id,property_id,property_type,source_version_id,position,next_property_id)
    select p_tenant,c.id,p_request,property_id,contact_type,id,row_number() over(order by property_id),lead(property_id) over(order by property_id)
    from chosen where property_id<=9007199254740991;
   select count(*)::integer,min(t.property_id) into target_count,first_property from public.learn_commusoft_contact_targets t
    where t.tenant_id=p_tenant and t.connection_id=c.id and t.approval_id=p_request;
   if target_count=0 then raise exception 'learn_operator_contact_properties_missing' using errcode='55000';end if;
   scope:=scope||jsonb_build_object('contactPlanVersion',1,'contactTargetCount',target_count,'firstPropertyId',first_property,'propertyTraversalApprovalId',property_approval);
  end if;
  update public.connector_accounts set settings=settings||jsonb_build_object('commusoft_import',scope),sync_cursor='{}' where id=aid;
  insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
   values(jid,p_tenant,'commusoft','learn','commusoft.source_sync','commusoft.source:'||aid::text||':'||p_request::text,'queued',5,clock_timestamp(),jsonb_build_object('connector_account_id',aid),p_actor);
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','recorded','kind',kind,'account_id',aid,'job_id',jid);
 end if;
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 insert into public.learn_operator_input_requests(id,tenant_id,actor_id,definition,receipt,previous_state)
  values(p_request,p_tenant,p_actor,p_definition,receipt,previous);
 return receipt;
end $$;

create or replace function public.learn_commusoft_acquire_page(
  p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,p_expected jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  j public.platform_jobs%rowtype;
  a public.connector_accounts%rowtype;
  c public.provider_connections%rowtype;
  cfg jsonb; cp jsonb; req jsonb; target jsonb; pages integer; after_id bigint; flag_name text;
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
     or jsonb_typeof(cfg->'maxPages') is distinct from 'number' or (cfg->>'maxPages')::integer not between 1 and 2147483647
     or jsonb_typeof(cfg->'pageSize') is distinct from 'number' or (cfg->>'pageSize')::integer not between 1 and 100
     or coalesce(cfg->>'resource','') not in ('properties','propertyContacts','jobs') then return null; end if;
  if cfg->>'resource'='propertyContacts' then
    if coalesce(cfg->>'contactType','') not in ('customer','workaddress') then return null; end if;
  elsif cfg ? 'contactType' then return null; end if;

  if j.job_key is distinct from 'commusoft.source:'||a.id::text||':'||(cfg->>'approvalId') then return null;end if;
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
  if pages=0 and after_id is not null or pages>0 and after_id is null and cfg->>'resource'<>'propertyContacts'
   or after_id is not null and (after_id<1 or after_id>9007199254740991) then return null;end if;
  req:=jsonb_build_object('region',c.non_secret_config->>'region','resource',cfg->>'resource','after',after_id,'limit',(cfg->>'pageSize')::integer);
  if cfg->>'resource'='propertyContacts' then
   target:=public.learn_commusoft_contact_target(p_tenant_id,c.id,cfg,a.sync_cursor);
   if target is null or target is distinct from p_expected->'contactTarget' then return null;end if;
   req:=req||jsonb_build_object('contactType',cfg->>'contactType','propertyId',target->'propertyId');
  end if;
  if req is distinct from p_expected->'request' or p_expected->'pages' is distinct from to_jsonb(pages)
     or p_expected->'complete' is distinct from 'false'::jsonb then return null; end if;

  if coalesce(j.metadata,'{}'::jsonb) ? 'commusoft_page_v1' then return null;end if;
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

create or replace function public.learn_commusoft_commit_page(
  p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,p_permit_id uuid,p_envelope jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  permit public.learn_business_input_request_permits%rowtype;
  prior public.learn_business_input_pages%rowtype;
  j public.platform_jobs%rowtype;
  a public.connector_accounts%rowtype;
  connection public.provider_connections%rowtype;
  b jsonb; cfg jsonb; cp jsonb; target jsonb; next_cp jsonb; receipt jsonb; flag_name text;
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
  if j.job_key is distinct from 'commusoft.source:'||(b->>'accountId')||':'||(cfg->>'approvalId') then raise exception 'commusoft_queue_identity' using errcode='PT409';end if;
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

  if cfg->>'resource'='propertyContacts' then
   target:=public.learn_commusoft_contact_target(p_tenant_id,connection.id,cfg,cp);
   if target is null or b->'request'->'propertyId' is distinct from target->'propertyId' then raise exception 'commusoft_contact_scope_changed' using errcode='PT409';end if;
  end if;

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
    if cfg->>'resource'='propertyContacts' and item->'propertyID' is distinct from target->'propertyId' then
     raise exception 'commusoft_contact_parent_mismatch' using errcode='22023';end if;
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
  if target is not null then
   next_cp:=next_cp||jsonb_build_object('propertyId',case when has_more then target->'propertyId' else target->'nextPropertyId' end,
    'propertiesCompleted',(target->>'position')::integer-case when has_more then 1 else 0 end,
    'complete',not has_more and target->'nextPropertyId'='null'::jsonb);
  end if;
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

create or replace function public.learn_operator_inputs(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare connections jsonb;accounts jsonb;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 select coalesce(jsonb_agg(x.row order by x.id),'[]') into connections from (
  select c.id,jsonb_build_object('id',c.id,'status',c.status,'revision',c.updated_at,'verified_at',c.verified_at,'revoked',c.revoked_at is not null,
   'account_key',left(c.non_secret_config->>'account_key',2000),'region',c.non_secret_config->>'region',
   'credential_bound',exists(select 1 from vault.secrets s where s.id::text=c.secret_refs->>'api_key' and s.name='provider_secret:'||p_tenant::text||':commusoft:api_key')) as row
  from public.provider_connections c where c.tenant_id=p_tenant and c.provider='commusoft' order by c.id limit 21
 ) x;
 if jsonb_array_length(connections)>20 then raise exception 'learn_operator_connection_limit' using errcode='54000';end if;
 select coalesce(jsonb_agg(x.row order by x.id),'[]') into accounts from (
  select a.id,jsonb_build_object('id',a.id,'status',a.status,'connector_enabled',tc.enabled and tc.status='active',
   'connection_id',a.settings->'commusoft_import'->>'connectionId','resource',a.settings->'commusoft_import'->>'resource',
   'approval_id',a.settings->'commusoft_import'->>'approvalId','expires_at',a.settings->'commusoft_import'->>'expiresAt',
   'contact_target_count',a.settings->'commusoft_import'->'contactTargetCount','max_pages',a.settings->'commusoft_import'->'maxPages','checkpoint',(jsonb_build_object('approvalId',a.sync_cursor->'approvalId','pages',a.sync_cursor->'pages','after',a.sync_cursor->'after','complete',a.sync_cursor->'complete')||case when a.sync_cursor ? 'propertyId' then jsonb_build_object('propertyId',a.sync_cursor->'propertyId','propertiesCompleted',a.sync_cursor->'propertiesCompleted') else '{}'::jsonb end),
   'latest_job',(select jsonb_build_object('id',j.id,'status',j.status,'error_code',
    case when j.error_code~'^commusoft_[a-z_]{1,80}$' then j.error_code when j.error_code is not null then 'commusoft_worker_failed' end,
    'attempt_count',j.attempt_count,'available_at',j.available_at,'lease_expires_at',j.lease_expires_at,'completed_at',j.completed_at,
    'stop_reason',case when j.result->>'stop_reason' in ('collection_exhausted','page_budget_exhausted','next_page','authorisation_changed') then j.result->>'stop_reason' end)
    from public.platform_jobs j where j.tenant_id=p_tenant and j.job_type='commusoft.source_sync' and j.payload->>'connector_account_id'=a.id::text order by j.created_at desc,j.id desc limit 1)) as row
  from public.connector_accounts a join public.tenant_connectors tc on tc.id=a.tenant_connector_id and tc.tenant_id=a.tenant_id
  where a.tenant_id=p_tenant and tc.connector_id='commusoft' and tc.provider='commusoft' order by a.id limit 21
 ) x;
 if jsonb_array_length(accounts)>20 then raise exception 'learn_operator_account_limit' using errcode='54000';end if;
 return jsonb_build_object('tenant_id',p_tenant,'checked_at',clock_timestamp(),'flags',public.learn_operator_input_flags(p_tenant),'connections',connections,'accounts',accounts);
end $$;

create or replace function public.learn_operator_resume_commusoft(
 p_tenant uuid,p_request uuid,p_actor uuid,p_definition jsonb,p_mode text default 'apply'
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.learn_operator_input_requests%rowtype;a public.connector_accounts%rowtype;
 c public.provider_connections%rowtype;tc public.tenant_connectors%rowtype;j public.platform_jobs%rowtype;
 cfg jsonb;cp jsonb;observed jsonb;receipt jsonb;previous jsonb;k text;
 expiry timestamptz;revision timestamptz;pages integer;retained integer;jid uuid:=gen_random_uuid();
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_mode is null or p_mode not in ('apply','check','cancel')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>10000 then
  raise exception 'learn_operator_request_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-request:'||p_request::text,0));
 select * into prior from public.learn_operator_input_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.definition<>p_definition then
   raise exception 'learn_operator_request_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if p_mode='check' then return jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','pending');end if;
 if p_mode='cancel' then
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','cancelled');
  insert into public.learn_operator_input_requests(id,tenant_id,actor_id,definition,receipt)
   values(p_request,p_tenant,p_actor,p_definition,receipt);
  return receipt;
 end if;
 if p_definition->>'kind' is distinct from 'resume_commusoft'
  or not p_definition ?& array['kind','reason','account_id','approval_id','job_id','connection_id','revision','checkpoint','max_pages','expires_at']
  or (select count(*) from jsonb_object_keys(p_definition))<>10
  or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
  or jsonb_typeof(p_definition->'revision') is distinct from 'string'
  or jsonb_typeof(p_definition->'expires_at') is distinct from 'string'
  or jsonb_typeof(p_definition->'checkpoint') is distinct from 'object'
  or jsonb_typeof(p_definition->'max_pages') is distinct from 'number' or p_definition->>'max_pages'!~'^[0-9]{1,10}$' then
  raise exception 'learn_operator_resume_invalid' using errcode='22023';end if;
 foreach k in array array['account_id','approval_id','job_id','connection_id'] loop
  if jsonb_typeof(p_definition->k) is distinct from 'string' or p_definition->>k!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
   raise exception 'learn_operator_resume_invalid' using errcode='22023';end if;
 end loop;
 expiry:=(p_definition->>'expires_at')::timestamptz;revision:=(p_definition->>'revision')::timestamptz;pages:=(p_definition->>'max_pages')::integer;
 if not isfinite(expiry) or not isfinite(revision) or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '24 hours' or pages not between 1 and 2147483647 then
  raise exception 'learn_operator_resume_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 perform 1 from public.tenants where id=p_tenant and status='active';
 if not found then raise exception 'learn_operator_tenant_inactive' using errcode='55000';end if;
 foreach k in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
  perform 1 from public.feature_flags where tenant_id=p_tenant and flag=k and value='true'::jsonb for share;
  if not found then raise exception 'learn_operator_module_disabled' using errcode='55000';end if;
 end loop;
 select * into c from public.provider_connections where id=(p_definition->>'connection_id')::uuid and tenant_id=p_tenant for share;
 if not found or c.provider is distinct from 'commusoft' or c.status is distinct from 'configured' or c.auth_mode is distinct from 'private_api_key'
  or c.revoked_at is not null or c.verified_at is null or c.verified_at>clock_timestamp() or c.updated_at is distinct from revision
  or coalesce(c.non_secret_config->>'region','') not in ('uk','us')
  or not coalesce('api_key'=any(c.configured_fields),false)
  or coalesce(c.secret_refs->>'api_key','')!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
  raise exception 'learn_operator_connection_changed' using errcode='PT409';end if;
 perform 1 from vault.secrets where id=(c.secret_refs->>'api_key')::uuid and name='provider_secret:'||p_tenant::text||':commusoft:api_key';
 if not found then raise exception 'learn_operator_credential_missing' using errcode='55000';end if;
 select * into tc from public.tenant_connectors where tenant_id=p_tenant and connector_id='commusoft' for update;
 if not found or tc.provider is distinct from 'commusoft' or tc.enabled is distinct from true or tc.status is distinct from 'active' then
  raise exception 'learn_operator_connector_disabled' using errcode='55000';end if;
 select * into a from public.connector_accounts where id=(p_definition->>'account_id')::uuid and tenant_id=p_tenant and tenant_connector_id=tc.id for update;
 if not found or a.status is distinct from 'active' or a.account_key is distinct from c.non_secret_config->>'account_key' then
  raise exception 'learn_operator_account_changed' using errcode='PT409';end if;
 cfg:=a.settings->'commusoft_import';cp:=a.sync_cursor;
 observed:=jsonb_build_object('approvalId',cp->'approvalId','pages',cp->'pages','after',cp->'after','complete',cp->'complete');
 if cp ? 'propertyId' then observed:=observed||jsonb_build_object('propertyId',cp->'propertyId','propertiesCompleted',cp->'propertiesCompleted');end if;
 if cfg->'approved' is distinct from 'true'::jsonb or cfg->>'approvalId' is distinct from p_definition->>'approval_id'
  or cfg->>'connectionId' is distinct from c.id::text or observed is distinct from p_definition->'checkpoint'
  or jsonb_typeof(cfg->'maxPages') is distinct from 'number' or coalesce(cfg->>'maxPages','')!~'^[0-9]{1,10}$'
  or jsonb_typeof(cfg->'expiresAt') is distinct from 'string'
  or coalesce(cfg->>'resource','') not in ('properties','jobs','propertyContacts')
  or (cfg->>'resource'='propertyContacts' and coalesce(cfg->>'contactType','') not in ('customer','workaddress')) then
  raise exception 'learn_operator_progress_changed' using errcode='PT409';end if;
 if cfg->>'resource'='propertyContacts' and public.learn_commusoft_contact_target(p_tenant,c.id,cfg,cp) is null then
  raise exception 'learn_operator_contact_plan_invalid' using errcode='PT409';end if;
 -- No active attempt is reset or displaced, even after its lease expires.
 if exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync'
  and payload->>'connector_account_id'=a.id::text and status in ('queued','running','retrying')) then
  raise exception 'learn_operator_import_active' using errcode='55000';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync'
  and payload->>'connector_account_id'=a.id::text order by created_at desc,id desc limit 1 for update;
 if not found or j.id::text is distinct from p_definition->>'job_id' or j.status not in ('succeeded','dead_letter')
  or j.job_key is distinct from 'commusoft.source:'||a.id::text||':'||(cfg->>'approvalId')
  or coalesce(j.lease_expires_at,'-infinity')>clock_timestamp() then
  raise exception 'learn_operator_progress_changed' using errcode='PT409';end if;
 -- Committed but unsettled work must go through source-free worker recovery.
 if j.status='dead_letter' and (j.metadata ? 'commusoft_page_v1' or exists(select 1 from public.learn_business_input_pages where job_id=j.id)) then
  raise exception 'learn_operator_page_unsettled' using errcode='55000';end if;
 if j.status='succeeded' and not exists(select 1 from public.learn_business_input_pages where job_id=j.id and tenant_id=p_tenant
  and connection_id=c.id and provider='commusoft' and collection=cfg->>'resource' and checkpoint_after=cp) then
  raise exception 'learn_operator_checkpoint_invalid' using errcode='PT409';end if;
 if cp='{}'::jsonb then
  retained:=0;
  if j.status='succeeded' or exists(select 1 from public.learn_business_input_pages where tenant_id=p_tenant and connection_id=c.id and checkpoint_after->>'approvalId'=cfg->>'approvalId') then
   raise exception 'learn_operator_checkpoint_invalid' using errcode='PT409';end if;
 else
  if cp->>'approvalId' is distinct from cfg->>'approvalId' or cp->'complete' is distinct from 'false'::jsonb
   or jsonb_typeof(cp->'pages') is distinct from 'number' or cp->>'pages'!~'^[0-9]{1,10}$' then
   raise exception 'learn_operator_checkpoint_invalid' using errcode='PT409';end if;
  retained:=(cp->>'pages')::integer;
  -- Require the exact last retained page, not a cursor supplied by the browser.
  select checkpoint_after into observed from public.learn_business_input_pages where tenant_id=p_tenant and connection_id=c.id
   and provider='commusoft' and collection=cfg->>'resource' and checkpoint_after->>'approvalId'=cfg->>'approvalId'
   order by (checkpoint_after->>'pages')::integer desc limit 1;
  if not found or observed is distinct from cp or retained<1 then raise exception 'learn_operator_checkpoint_invalid' using errcode='PT409';end if;
 end if;
 if pages<=retained or pages::bigint-retained>10000 or pages<(cfg->>'maxPages')::integer or expiry<(cfg->>'expiresAt')::timestamptz then
  raise exception 'learn_operator_resume_limits' using errcode='22023';end if;
 previous:=jsonb_build_object('approval',cfg,'checkpoint',cp,'job_id',j.id,'job_status',j.status);
 cfg:=cfg||jsonb_build_object('expiresAt',expiry,'maxPages',pages);
 update public.connector_accounts set settings=settings||jsonb_build_object('commusoft_import',cfg) where id=a.id;
 insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,max_attempts,available_at,parent_job_id,payload,created_by)
  values(jid,p_tenant,'commusoft','learn','commusoft.source_sync',j.job_key,'queued',5,clock_timestamp(),j.id,jsonb_build_object('connector_account_id',a.id),p_actor);
 receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','recorded','kind','resume_commusoft','account_id',a.id,'job_id',jid,'approval_id',cfg->>'approvalId','checkpoint',p_definition->'checkpoint');
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 insert into public.learn_operator_input_requests(id,tenant_id,actor_id,definition,receipt,previous_state) values(p_request,p_tenant,p_actor,p_definition,receipt,previous);
 return receipt;
end $$;
commit;
