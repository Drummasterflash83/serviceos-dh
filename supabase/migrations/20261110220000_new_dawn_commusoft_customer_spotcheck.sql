-- Ten exact, operator-selected Commusoft customer GETs. Installation is inert:
-- no permit, provider request, canonical identity or link is created here.
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';

create table public.new_dawn_commusoft_customer_spotcheck_batches (
 id uuid primary key,
 tenant_id uuid not null unique references public.tenants(id),
 actor_id uuid not null references public.profiles(id),
 connection_id uuid not null references public.provider_connections(id),
 connection_revision timestamptz not null,
 secret_id uuid not null,
 reason text not null check(length(btrim(reason)) between 3 and 500),
 created_at timestamptz not null default clock_timestamp()
);
create table public.new_dawn_commusoft_customer_spotcheck_items (
 batch_id uuid not null references public.new_dawn_commusoft_customer_spotcheck_batches(id),
 ordinal smallint not null check(ordinal between 0 and 10),
 tenant_id uuid not null references public.tenants(id),
 external_id text check(external_id ~ '^[1-9][0-9]{0,15}$'),
 source_version_id uuid references public.learn_business_input_versions(id),
 constraint spotcheck_item_shape check((ordinal=0 and external_id is null and source_version_id is null)
  or (ordinal between 1 and 10 and external_id is not null and source_version_id is not null)),
 state text not null default 'prepared' check(state in ('prepared','claimed','complete','failed')),
 claimed_at timestamptz,
 checked_at timestamptz,
 raw_sha256 text,
 result jsonb,
 failure_code text,
 primary key(batch_id,ordinal),
 unique(batch_id,external_id),
 unique(batch_id,source_version_id)
);
alter table public.new_dawn_commusoft_customer_spotcheck_batches enable row level security;
alter table public.new_dawn_commusoft_customer_spotcheck_items enable row level security;
revoke all on public.new_dawn_commusoft_customer_spotcheck_batches,
 public.new_dawn_commusoft_customer_spotcheck_items from public,anon,authenticated,service_role;
create trigger retain_batch before update or delete on public.new_dawn_commusoft_customer_spotcheck_batches
 for each row execute function public.learn_business_input_retain();
create trigger retain_batch_truncate before truncate on public.new_dawn_commusoft_customer_spotcheck_batches
 for each statement execute function public.learn_business_input_retain();
create trigger retain_item_delete before delete on public.new_dawn_commusoft_customer_spotcheck_items
 for each row execute function public.learn_business_input_retain();
create trigger retain_item_truncate before truncate on public.new_dawn_commusoft_customer_spotcheck_items
 for each statement execute function public.learn_business_input_retain();

-- The ten IDs/versions are submitted once from the private reviewed sample.
-- The unique tenant key makes this a bounded acceptance run, not a reusable
-- arbitrary provider reader. It does not release a credential or call provider.
create function public.new_dawn_commusoft_customer_spotcheck_register(
 p_tenant uuid,p_batch uuid,p_items jsonb,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();c public.provider_connections%rowtype;connection_count int;
 item jsonb;v public.learn_business_input_versions%rowtype;ord int:=0;
 external text;version_id uuid;audit uuid:=gen_random_uuid();
begin
 if auth.role() is distinct from 'authenticated' or p_batch is null
  or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)<>10
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'spotcheck_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 perform public.new_dawn_commusoft_job_actor_access(p_tenant,actor);
 perform 1 from public.feature_flags where tenant_id=p_tenant and flag='learn.enabled'
  and value='true'::jsonb for share;
 if not found then raise exception 'spotcheck_input_off' using errcode='42501';end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant and flag='learn.inputs.commusoft.enabled'
  and value='true'::jsonb for share;
 if not found then raise exception 'spotcheck_input_off' using errcode='42501';end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant and flag='new_dawn.m2_customer_spotcheck'
  and value='true'::jsonb for share;
 if not found then raise exception 'spotcheck_flag_off' using errcode='42501';end if;
 perform 1 from public.tenant_connectors where tenant_id=p_tenant and provider='commusoft'
  and connector_id='commusoft' and enabled and status='active' for share;
 if not found then raise exception 'spotcheck_connector_off' using errcode='42501';end if;
 perform 1 from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync'
  and status in('queued','running','retrying') for share;
 if found then raise exception 'spotcheck_import_active' using errcode='55000';end if;
 select count(*)::int into connection_count from public.provider_connections where tenant_id=p_tenant
  and provider='commusoft' and status='configured' and auth_mode='private_api_key'
  and revoked_at is null and verified_at is not null;
 if connection_count<>1 then raise exception 'spotcheck_connection_ambiguous' using errcode='42501';end if;
 select * into c from public.provider_connections where tenant_id=p_tenant and provider='commusoft'
  and status='configured' and auth_mode='private_api_key' and revoked_at is null
  and verified_at is not null and coalesce(non_secret_config->>'region','') in('uk','us')
  and coalesce(secret_refs->>'api_key','')~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' for share;
 if not found then raise exception 'spotcheck_connection_unavailable' using errcode='42501';end if;
 insert into public.new_dawn_commusoft_customer_spotcheck_batches
  (id,tenant_id,actor_id,connection_id,connection_revision,secret_id,reason)
 values(p_batch,p_tenant,actor,c.id,c.updated_at,(c.secret_refs->>'api_key')::uuid,btrim(p_reason));
 for item in select value from jsonb_array_elements(p_items) loop
  ord:=ord+1;
  if jsonb_typeof(item) is distinct from 'object' or
   (select count(*) from jsonb_object_keys(item))<>2 or
   not(item ? 'external_id' and item ? 'source_version_id') or
   not(case when coalesce(item->>'external_id','')~'^[1-9][0-9]{0,15}$'
    then (item->>'external_id')::numeric<=9007199254740991 else false end) or
   coalesce(item->>'source_version_id','')!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
   raise exception 'spotcheck_item_invalid' using errcode='22023';end if;
  external:=item->>'external_id';version_id:=(item->>'source_version_id')::uuid;
  v:=public.learn_business_input_latest(p_tenant,c.id,'commusoft','properties',external);
  if v.id is distinct from version_id or v.payload->>'type' is distinct from 'customer'
   or jsonb_typeof(v.payload->'id') is distinct from 'number'
   or v.payload->>'id' is distinct from external then
   raise exception 'spotcheck_source_changed' using errcode='42501';end if;
  insert into public.new_dawn_commusoft_customer_spotcheck_items
   (batch_id,ordinal,tenant_id,external_id,source_version_id)
  values(p_batch,ord,p_tenant,external,version_id);
 end loop;
 -- One additional, separately invoked customer-type read; an unknown or
 -- denied provider response is retained as a failed check, never inferred.
 insert into public.new_dawn_commusoft_customer_spotcheck_items
  (batch_id,ordinal,tenant_id) values(p_batch,0,p_tenant);
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'client_customers.provider_spotcheck_registered',
  'commusoft_customer_spotcheck',p_batch::text,
  jsonb_build_object('batch_id',p_batch,'count',10,'connection_id',c.id),
  btrim(p_reason),p_batch::text,false,'new-dawn-commusoft-customer-spotcheck');
 return jsonb_build_object('state','prepared','batch_id',p_batch,'count',10,'audit_id',audit);
end $$;

create function public.new_dawn_commusoft_customer_spotcheck_authorize(p_batch uuid,p_ordinal int)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b public.new_dawn_commusoft_customer_spotcheck_batches%rowtype;
 i public.new_dawn_commusoft_customer_spotcheck_items%rowtype;
begin
 if auth.role() is distinct from 'authenticated' or p_ordinal not between 0 and 10 then
  raise exception 'spotcheck_forbidden' using errcode='42501';end if;
 select * into b from public.new_dawn_commusoft_customer_spotcheck_batches where id=p_batch;
 if not found or b.actor_id is distinct from auth.uid() or
  b.created_at<clock_timestamp()-interval '24 hours' then
  raise exception 'spotcheck_forbidden' using errcode='42501';end if;
 perform public.learn_operator_input_access(b.tenant_id,b.actor_id,true);
 perform public.new_dawn_commusoft_job_actor_access(b.tenant_id,b.actor_id);
 select * into i from public.new_dawn_commusoft_customer_spotcheck_items
  where batch_id=p_batch and ordinal=p_ordinal;
 if not found then raise exception 'spotcheck_forbidden' using errcode='42501';end if;
 return jsonb_build_object('state',i.state,'batch_id',p_batch,'ordinal',p_ordinal,
  'result',i.result,'failure_code',i.failure_code);
end $$;

create function public.new_dawn_commusoft_customer_spotcheck_current(p_batch uuid,p_ordinal int)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare b public.new_dawn_commusoft_customer_spotcheck_batches%rowtype;
 i public.new_dawn_commusoft_customer_spotcheck_items%rowtype;
 v public.learn_business_input_versions%rowtype;
begin
 if auth.role() is distinct from 'service_role' or p_ordinal not between 0 and 10 then return false;end if;
 select * into b from public.new_dawn_commusoft_customer_spotcheck_batches where id=p_batch;
 if not found or b.created_at<clock_timestamp()-interval '24 hours' then return false;end if;
 select * into i from public.new_dawn_commusoft_customer_spotcheck_items
  where batch_id=p_batch and ordinal=p_ordinal and tenant_id=b.tenant_id
   and state='claimed' and claimed_at>clock_timestamp()-interval '90 seconds';
 if not found then return false;end if;
 perform public.new_dawn_commusoft_job_actor_access(b.tenant_id,b.actor_id);
 perform 1 from public.feature_flags where tenant_id=b.tenant_id and flag='learn.enabled'
  and value='true'::jsonb for share;
 if not found then return false;end if;
 perform 1 from public.feature_flags where tenant_id=b.tenant_id and flag='learn.inputs.commusoft.enabled'
  and value='true'::jsonb for share;
 if not found then return false;end if;
 perform 1 from public.feature_flags where tenant_id=b.tenant_id and flag='new_dawn.m2_customer_spotcheck'
  and value='true'::jsonb for share;
 if not found then return false;end if;
 perform 1 from public.tenant_connectors where tenant_id=b.tenant_id and provider='commusoft'
  and connector_id='commusoft' and enabled and status='active' for share;
 if not found then return false;end if;
 perform 1 from public.platform_jobs where tenant_id=b.tenant_id and job_type='commusoft.source_sync'
  and status in('queued','running','retrying') for share;
 if found then return false;end if;
 perform 1 from public.provider_connections where id=b.connection_id and tenant_id=b.tenant_id
  and provider='commusoft' and status='configured' and auth_mode='private_api_key'
  and revoked_at is null and verified_at is not null and updated_at=b.connection_revision
  and secret_refs->>'api_key'=b.secret_id::text for share;
 if not found then return false;end if;
 if p_ordinal=0 then return true;end if;
 v:=public.learn_business_input_latest(b.tenant_id,b.connection_id,'commusoft','properties',i.external_id);
 return v.id is not distinct from i.source_version_id and v.payload->>'type'='customer'
  and jsonb_typeof(v.payload->'id')='number' and v.payload->>'id'=i.external_id;
exception when sqlstate '42501' then return false;
end $$;

create function public.new_dawn_commusoft_customer_spotcheck_acquire(p_batch uuid,p_ordinal int)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b public.new_dawn_commusoft_customer_spotcheck_batches%rowtype;
 i public.new_dawn_commusoft_customer_spotcheck_items%rowtype;
 secret text;fingerprint text;next_at timestamptz;region text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'spotcheck_forbidden' using errcode='42501';end if;
 select * into b from public.new_dawn_commusoft_customer_spotcheck_batches where id=p_batch;
 select * into i from public.new_dawn_commusoft_customer_spotcheck_items
  where batch_id=p_batch and ordinal=p_ordinal for update;
 if not found or b.id is null or i.state<>'prepared' then
  raise exception 'spotcheck_unavailable' using errcode='42501';end if;
 update public.new_dawn_commusoft_customer_spotcheck_items set state='claimed',claimed_at=clock_timestamp()
  where batch_id=p_batch and ordinal=p_ordinal;
 if not public.new_dawn_commusoft_customer_spotcheck_current(p_batch,p_ordinal) then
  raise exception 'spotcheck_scope_changed' using errcode='42501';end if;
 select non_secret_config->>'region' into region from public.provider_connections
  where id=b.connection_id and tenant_id=b.tenant_id for share;
 select decrypted_secret into secret from vault.decrypted_secrets where id=b.secret_id
  and name='provider_secret:'||b.tenant_id::text||':commusoft:api_key';
 if secret is null or length(secret) not between 1 and 4096 or secret !~ '^[!-~]+$' then
  raise exception 'spotcheck_credential_unavailable' using errcode='42501';end if;
 fingerprint:=encode(sha256(convert_to('commusoft:'||secret,'UTF8')),'hex');
 insert into public.learn_business_input_request_gates values(fingerprint,clock_timestamp()) on conflict do nothing;
 select next_allowed_at into next_at from public.learn_business_input_request_gates
  where credential_fingerprint=fingerprint for update;
 if next_at>clock_timestamp() then
  update public.new_dawn_commusoft_customer_spotcheck_items set state='prepared',claimed_at=null
   where batch_id=p_batch and ordinal=p_ordinal;
  return jsonb_build_object('state','wait','retry_at',ceil(extract(epoch from next_at)*1000)::bigint);
 end if;
 update public.learn_business_input_request_gates set next_allowed_at=clock_timestamp()+interval '1250 milliseconds'
  where credential_fingerprint=fingerprint;
 return jsonb_build_object('state','ready','batch_id',p_batch,'ordinal',p_ordinal,
  'resource',case when p_ordinal=0 then 'customer_types' else 'customer' end,
  'external_id',i.external_id,'source_version_id',i.source_version_id,
  'region',region,'api_key',secret);
end $$;

create function public.new_dawn_commusoft_customer_spotcheck_finish(
 p_batch uuid,p_ordinal int,p_raw text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b public.new_dawn_commusoft_customer_spotcheck_batches%rowtype;
 i public.new_dawn_commusoft_customer_spotcheck_items%rowtype;
 v public.learn_business_input_versions%rowtype;body jsonb;outcome jsonb;
 categories jsonb;entry jsonb;normalized jsonb:='[]'::jsonb;audit uuid:=gen_random_uuid();
 source_contact jsonb;provider_contact jsonb;
begin
 if auth.role() is distinct from 'service_role' or p_raw is null
  or length(p_raw) not between 2 and 131072 then
  raise exception 'spotcheck_invalid' using errcode='22023';end if;
 select * into b from public.new_dawn_commusoft_customer_spotcheck_batches where id=p_batch;
 select * into i from public.new_dawn_commusoft_customer_spotcheck_items
  where batch_id=p_batch and ordinal=p_ordinal for update;
 if not found or b.id is null or not public.new_dawn_commusoft_customer_spotcheck_current(p_batch,p_ordinal) then
  raise exception 'spotcheck_scope_changed' using errcode='42501';end if;
 body:=p_raw::jsonb;
 if p_ordinal=0 then
  if jsonb_typeof(body)='array' then categories:=body;
  elsif jsonb_typeof(body)='object' and jsonb_typeof(body->'data')='array'
   and not(body ? 'error') then categories:=body->'data';
  else raise exception 'spotcheck_types_shape_unknown' using errcode='22023';end if;
  if jsonb_array_length(categories) not between 1 and 100 then
   raise exception 'spotcheck_types_shape_unknown' using errcode='22023';end if;
  for entry in select value from jsonb_array_elements(categories) loop
   if jsonb_typeof(entry) is distinct from 'object'
    or jsonb_typeof(entry->'id') not in('number','string')
    or coalesce(entry->>'id','')!~'^[1-9][0-9]{0,8}$'
    or jsonb_typeof(entry->'name') is distinct from 'string'
    or length(btrim(entry->>'name')) not between 1 and 200
    or (entry ? 'companyNameRequired' and
     (jsonb_typeof(entry->'companyNameRequired') not in('string','boolean')
      or length(entry->>'companyNameRequired')>40)) then
    raise exception 'spotcheck_types_shape_unknown' using errcode='22023';end if;
   normalized:=normalized||jsonb_build_array(jsonb_build_object('id',entry->>'id',
    'name',entry->>'name','companyNameRequired',entry->'companyNameRequired'));
  end loop;
  if (select count(distinct x->>'id') from jsonb_array_elements(normalized)x)
   <>jsonb_array_length(normalized) then
   raise exception 'spotcheck_types_shape_unknown' using errcode='22023';end if;
  outcome:=jsonb_build_object('state','complete','batch_id',p_batch,'ordinal',0,
   'resource','customer_types','types',normalized,'checked_at',clock_timestamp(),
   'limitation','Provider labels and companyNameRequired values are evidence, not canonical person/company decisions');
  update public.new_dawn_commusoft_customer_spotcheck_items set state='complete',
   checked_at=clock_timestamp(),result=outcome,
   raw_sha256=encode(sha256(convert_to(p_raw,'UTF8')),'hex')
   where batch_id=p_batch and ordinal=0;
  insert into public.controlplane_change_log
   (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
  values(audit,b.tenant_id,b.actor_id::text,'client_customers.provider_types_checked',
   'commusoft_customer_spotcheck',p_batch::text,
   jsonb_build_object('batch_id',p_batch,'type_count',jsonb_array_length(normalized)),
   b.reason,p_batch::text,false,'new-dawn-commusoft-customer-spotcheck');
  perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
  return outcome||jsonb_build_object('audit_id',audit);
 end if;
 if jsonb_typeof(body) is distinct from 'object' or jsonb_typeof(body->'id') is distinct from 'number'
  or body->>'id' is distinct from i.external_id or body->>'type' is distinct from 'customer'
  or body ? 'error' or jsonb_typeof(body->'customerType') is distinct from 'number'
  or not(case when coalesce(body->>'customerType','')~'^[1-9][0-9]{0,15}$'
   then (body->>'customerType')::numeric<=9007199254740991 else false end) then
  raise exception 'spotcheck_response_invalid' using errcode='22023';end if;
 v:=public.learn_business_input_latest(b.tenant_id,b.connection_id,'commusoft','properties',i.external_id);
 source_contact:=coalesce(v.payload->'contact','{}'::jsonb);
 provider_contact:=coalesce(body->'contact','{}'::jsonb);
 if jsonb_typeof(source_contact) is distinct from 'object'
  or jsonb_typeof(provider_contact) is distinct from 'object' then
  raise exception 'spotcheck_response_invalid' using errcode='22023';end if;
 outcome:=jsonb_build_object('state','complete','batch_id',p_batch,'ordinal',p_ordinal,
  'source_version_id',i.source_version_id,'customer_type_id',body->>'customerType',
  'type_matches',body->>'customerType' is not distinct from v.payload->>'customerType',
  'company_matches',nullif(btrim(body->>'companyName'),'') is not distinct from
    nullif(btrim(v.payload->>'companyName'),''),
  'contact_matches',concat_ws(' ',nullif(btrim(provider_contact->>'firstName'),''),
    nullif(btrim(provider_contact->>'lastName'),'')) is not distinct from
    concat_ws(' ',nullif(btrim(source_contact->>'firstName'),''),
      nullif(btrim(source_contact->>'lastName'),'')),
  'postcode_matches',regexp_replace(lower(coalesce(body->>'postcode','')),'[[:space:]]','','g')
   =regexp_replace(lower(coalesce(v.payload->>'postcode','')),'[[:space:]]','','g'),
  'updated_at_matches',body->>'lastUpdatedOnDateTime' is not distinct from
   v.payload->>'lastUpdatedOnDateTime',
  'provider_updated_at',left(body->>'lastUpdatedOnDateTime',80),
  'checked_at',clock_timestamp());
 update public.new_dawn_commusoft_customer_spotcheck_items set state='complete',
  checked_at=clock_timestamp(),result=outcome,
  raw_sha256=encode(sha256(convert_to(p_raw,'UTF8')),'hex')
 where batch_id=p_batch and ordinal=p_ordinal;
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit,b.tenant_id,b.actor_id::text,'client_customers.provider_spotcheck_completed',
  'commusoft_customer_spotcheck',p_batch::text,
  jsonb_build_object('batch_id',p_batch,'ordinal',p_ordinal,'source_version_id',i.source_version_id,
   'type_matches',outcome->'type_matches','company_matches',outcome->'company_matches',
   'contact_matches',outcome->'contact_matches','postcode_matches',outcome->'postcode_matches',
   'updated_at_matches',outcome->'updated_at_matches'),
  b.reason,p_batch::text,false,'new-dawn-commusoft-customer-spotcheck');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return outcome||jsonb_build_object('audit_id',audit);
end $$;

create function public.new_dawn_commusoft_customer_spotcheck_fail(
 p_batch uuid,p_ordinal int,p_code text
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare b public.new_dawn_commusoft_customer_spotcheck_batches%rowtype;
 i public.new_dawn_commusoft_customer_spotcheck_items%rowtype;
begin
 if auth.role() is distinct from 'service_role' or p_code not in
  ('scope_changed','authentication_required','access_denied','rate_limited',
   'provider_unavailable','response_too_large',
   'response_invalid','transport_unavailable','result_unconfirmed') then
  raise exception 'spotcheck_invalid' using errcode='22023';end if;
 select * into b from public.new_dawn_commusoft_customer_spotcheck_batches where id=p_batch;
 select * into i from public.new_dawn_commusoft_customer_spotcheck_items
  where batch_id=p_batch and ordinal=p_ordinal for update;
 if not found or b.id is null or i.state not in('prepared','claimed') then return;end if;
 update public.new_dawn_commusoft_customer_spotcheck_items set state='failed',failure_code=p_code
  where batch_id=p_batch and ordinal=p_ordinal;
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(gen_random_uuid(),b.tenant_id,b.actor_id::text,'client_customers.provider_spotcheck_failed',
  'commusoft_customer_spotcheck',p_batch::text,
  jsonb_build_object('batch_id',p_batch,'ordinal',p_ordinal,'code',p_code),
  b.reason,p_batch::text,false,'new-dawn-commusoft-customer-spotcheck');
end $$;

revoke all on function public.new_dawn_commusoft_customer_spotcheck_register(uuid,uuid,jsonb,text),
 public.new_dawn_commusoft_customer_spotcheck_authorize(uuid,int),
 public.new_dawn_commusoft_customer_spotcheck_current(uuid,int),
 public.new_dawn_commusoft_customer_spotcheck_acquire(uuid,int),
 public.new_dawn_commusoft_customer_spotcheck_finish(uuid,int,text),
 public.new_dawn_commusoft_customer_spotcheck_fail(uuid,int,text)
 from public,anon,authenticated,service_role;
grant execute on function public.new_dawn_commusoft_customer_spotcheck_register(uuid,uuid,jsonb,text),
 public.new_dawn_commusoft_customer_spotcheck_authorize(uuid,int) to authenticated;
grant execute on function public.new_dawn_commusoft_customer_spotcheck_current(uuid,int),
 public.new_dawn_commusoft_customer_spotcheck_acquire(uuid,int),
 public.new_dawn_commusoft_customer_spotcheck_finish(uuid,int,text),
 public.new_dawn_commusoft_customer_spotcheck_fail(uuid,int,text) to service_role;
commit;
