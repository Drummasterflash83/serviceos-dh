-- Durable, bounded QuickBooks query traversal. No schedules, flags or imports
-- are enabled by installing this migration. Retained pages preserve exact JSON
-- numbers; source identity excludes the replaceable app/connection registration.
begin;
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
commit;
