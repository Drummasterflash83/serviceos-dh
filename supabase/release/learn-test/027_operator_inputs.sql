-- OpenFolk LEARN input controls, TEST only. No operator grants, keys or work seeded.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
set local search_path=public,pg_temp;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if (select count(*) from of_test_deploy.migrations)<>27 or not exists(select 1 from of_test_deploy.migrations where migration_name='learn_commusoft_inputs_v1' and source_sha256='78e885c2bcb815fb7308dc1431155dab3542171abef7db9fe29c23fcd901eeee' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Exact release 026 required';end if;
 if to_regclass('public.platform_authority_grants') is not null or to_regclass('public.learn_operator_input_requests') is not null or to_regprocedure('public.current_user_is_openfolk_operator(text)') is not null then raise exception 'Operator objects already exist; inspect contract';end if;
 if exists(select 1 from public.authority_permissions where permission in ('platform.controlplane.view','platform.controlplane.admin')) then raise exception 'Operator permissions already exist; inspect definitions';end if;
end $$;
insert into authority_permissions (permission, category, description) values
  ('platform.controlplane.view','platform','OpenFolk operator: read the Control Plane'),
  ('platform.controlplane.admin','platform','OpenFolk operator: administer the Control Plane')
on conflict (permission) do nothing;

create table if not exists platform_authority_grants (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references profiles(id) on delete cascade,
  permission     text not null references authority_permissions(permission),
  effective_from timestamptz not null default now(),
  effective_to   timestamptz,                       -- null = active; revoke = set this
  granted_by     text not null,                     -- real actor who granted (email/id)
  reason         text,
  source         text not null default 'openfolk',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- At most one ACTIVE grant of a permission per operator.
create unique index if not exists pag_active_uk
  on platform_authority_grants (profile_id, permission)
  where effective_to is null;
create index if not exists pag_profile on platform_authority_grants (profile_id);
drop trigger if exists pag_set_updated_at on platform_authority_grants;
create trigger pag_set_updated_at before update on platform_authority_grants
  for each row execute function set_updated_at();

create or replace function current_user_is_openfolk_operator(required_permission text default 'platform.controlplane.view')
  returns boolean language sql stable security definer set search_path = public as $$
  -- Authenticated + existing profile (the join to profiles enforces both: a null
  -- auth.uid() matches no row) + an ACTIVE grant of the required permission.
  select exists (
    select 1
    from public.profiles p
    join public.platform_authority_grants g on g.profile_id = p.id
    where p.id = auth.uid()
      and (
        g.permission = required_permission
        or (required_permission = 'platform.controlplane.view'
            and g.permission = 'platform.controlplane.admin')
      )
      and coalesce(g.effective_from, '-infinity'::timestamptz) <= now()
      and coalesce(g.effective_to,   'infinity'::timestamptz)  >  now()
  );
$$;

comment on function current_user_is_openfolk_operator(text) is
  'Platform-operator gate: authenticated + existing profile + ACTIVE platform.controlplane grant (admin implies view). Independent of profiles.role, which is tenant-facing only. Does NOT confer tenant data access.';


alter table public.platform_authority_grants enable row level security;
revoke all on public.platform_authority_grants from public,anon,authenticated,service_role;
grant select on public.platform_authority_grants to authenticated,service_role;
grant insert,update,delete on public.platform_authority_grants to service_role;
create policy platform_authority_grants_select on public.platform_authority_grants for select to authenticated using(public.current_user_is_openfolk_operator());
revoke all on function public.current_user_is_openfolk_operator(text) from public,anon,authenticated,service_role;
grant execute on function public.current_user_is_openfolk_operator(text) to authenticated;
create table public.learn_operator_input_requests (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),
 definition jsonb not null,
 receipt jsonb not null,
 previous_state jsonb,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_operator_input_requests enable row level security;
revoke all on public.learn_operator_input_requests from public,anon,authenticated,service_role;
create function public.learn_operator_input_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$begin
 raise exception 'learn_operator_history_immutable' using errcode='55000';
end $$;
create trigger learn_operator_input_immutable before update or delete on public.learn_operator_input_requests
 for each row execute function public.learn_operator_input_immutable();

create function public.learn_operator_input_access(p_tenant uuid,p_actor uuid,p_write boolean)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare required_grant text:=case when p_write then 'platform.controlplane.admin' else 'platform.controlplane.view' end;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'learn_operator_snapshot_invalid' using errcode='22023';end if;
 if auth.role() is distinct from 'authenticated' or auth.uid() is null or p_actor is distinct from auth.uid()
  or p_tenant is null or p_write is null then raise exception 'learn_operator_forbidden' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() for share;
 if not found then raise exception 'learn_operator_forbidden' using errcode='42501';end if;
 -- Retain the existing effective-dated authority model and fence revocation until
 -- this operation finishes. Platform access does not grant raw tenant data access.
 perform 1 from public.platform_authority_grants g where g.profile_id=auth.uid()
  and (g.permission=required_grant or
    (required_grant='platform.controlplane.view' and g.permission='platform.controlplane.admin'))
  and coalesce(effective_from,'-infinity')<=clock_timestamp()
  and coalesce(effective_to,'infinity')>clock_timestamp() for share;
 if not found or not public.current_user_is_openfolk_operator(required_grant) then
  raise exception 'learn_operator_forbidden' using errcode='42501';end if;
 if exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null
  and (expires_at is null or expires_at>clock_timestamp())) then raise exception 'learn_operator_preview_forbidden' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant for share;
 if not found then raise exception 'learn_operator_tenant_unavailable' using errcode='42501';end if;
end $$;

-- Explicit booleans only. Missing values remain null in the read model.
create function public.learn_operator_input_flags(p_tenant uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog as $$
 select jsonb_build_object('learn.enabled',(select value from public.feature_flags where tenant_id=p_tenant and flag='learn.enabled'),
  'learn.inputs.commusoft.enabled',(select value from public.feature_flags where tenant_id=p_tenant and flag='learn.inputs.commusoft.enabled'));
$$;

-- One immutable request protocol for approve/check/cancel. A cancellation records
-- a tombstone: a late original apply returns cancellation, never enqueues work.
create function public.learn_operator_input_request(
 p_tenant uuid,p_request uuid,p_actor uuid,p_definition jsonb,p_mode text default 'apply'
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.learn_operator_input_requests%rowtype;c public.provider_connections%rowtype;
 tc public.tenant_connectors%rowtype;a public.connector_accounts%rowtype;
 receipt jsonb;previous jsonb;scope jsonb;flags jsonb;kind text;reason text;k text;
 connection_id uuid;revision timestamptz;expiry timestamptz;resource text;contact_type text;
 pages integer;page_size integer;aid uuid;jid uuid:=gen_random_uuid();
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

create function public.learn_operator_inputs(p_tenant uuid) returns jsonb
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
   'max_pages',a.settings->'commusoft_import'->'maxPages','checkpoint',jsonb_build_object('approvalId',a.sync_cursor->'approvalId','pages',a.sync_cursor->'pages','after',a.sync_cursor->'after','complete',a.sync_cursor->'complete'),
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
revoke all on function public.learn_operator_input_immutable(),public.learn_operator_input_access(uuid,uuid,boolean),public.learn_operator_input_flags(uuid),
 public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text),public.learn_operator_inputs(uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text),public.learn_operator_inputs(uuid) to authenticated;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_operator_inputs_v1','saatxzwxvdvqevbnskxy');
notify pgrst,'reload schema';
commit;
