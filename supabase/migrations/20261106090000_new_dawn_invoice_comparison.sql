-- One-use, operator-only QuickBooks invoice readback. No source import, schedule,
-- provider mutation, credential grant, or feature-flag change on installation.
begin;

create table public.learn_quickbooks_invoice_checks (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 connection_id uuid not null,
 actor_id uuid not null references public.profiles(id),
 environment text not null check(environment in ('sandbox','production')),
 realm_id text not null,
 connection_revision bigint not null,
 token_generation bigint not null,
 versions uuid[] not null check(cardinality(versions) between 2 and 3),
 reason text not null check(length(btrim(reason)) between 3 and 500),
 state text not null default 'prepared' check(state in ('prepared','claimed','complete','failed')),
 claimed_at timestamptz,
 result jsonb,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(connection_id,tenant_id) references public.learn_quickbooks_connections(id,tenant_id)
);
alter table public.learn_quickbooks_invoice_checks enable row level security;
revoke all on public.learn_quickbooks_invoice_checks from public,anon,authenticated,service_role;

create function public.learn_quickbooks_invoice_check_candidates(
 p_tenant uuid,p_connection uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.learn_quickbooks_connections%rowtype;items jsonb;audit uuid;begin
 if auth.role() is distinct from 'authenticated' or p_connection is null or p_reason is null
  or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'invoice_check_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 select * into c from public.learn_quickbooks_connections where id=p_connection and tenant_id=p_tenant
  and status in ('active','paused') and confirmed_at is not null and realm_id is not null for share;
 if not found then raise exception 'invoice_check_connection_unavailable' using errcode='42501';end if;
 with samples as materialized(
  select l.version_id,l.external_id,l.last_observed_at,v.payload
  from public.learn_quickbooks_latest l join public.learn_quickbooks_source_versions v on v.id=l.version_id
  where l.tenant_id=p_tenant and l.environment=c.environment and l.realm_id=c.realm_id
   and l.entity='Invoice' and not l.conflicted
   and public.learn_quickbooks_money(v.payload->'Balance') is not null
   and public.learn_quickbooks_strict_date(v.payload->>'DueDate') is not null
  order by l.last_observed_at desc,l.external_id desc limit 20
 ) select coalesce(jsonb_agg(jsonb_build_object('version_id',version_id,'invoice_id',external_id,
   'document_number',left(payload->>'DocNumber',80),'due_date',payload->>'DueDate',
   'observed_at',last_observed_at) order by last_observed_at desc,external_id desc),'[]'::jsonb)
 into items from samples;
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'invoice.provider_check_candidates',jsonb_build_object('connection_id',c.id,
  'realm_id',c.realm_id,'versions',(select coalesce(jsonb_agg(x->'version_id'),'[]'::jsonb)
   from jsonb_array_elements(items)x)),btrim(p_reason)) returning id into audit;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','quickbooks-invoice-candidates/1','tenant_id',p_tenant,
  'actor_id',auth.uid(),'connection_id',c.id,'environment',c.environment,'realm_id',c.realm_id,
  'rows',items,'audit_id',audit,'checked_at',clock_timestamp());
end $$;

create function public.learn_quickbooks_invoice_check_start(
 p_tenant uuid,p_connection uuid,p_request uuid,p_versions uuid[],p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.learn_quickbooks_connections%rowtype;n integer;
begin
 if auth.role() is distinct from 'authenticated' or p_request is null or p_connection is null
  or p_versions is null or cardinality(p_versions) not between 2 and 3
  or array_position(p_versions,null) is not null
  or (select count(distinct selected.version_id) from unnest(p_versions) as selected(version_id))<>cardinality(p_versions)
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'invoice_check_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 select * into c from public.learn_quickbooks_connections
  where id=p_connection and tenant_id=p_tenant and status in ('active','paused')
   and confirmed_at is not null and realm_id is not null for share;
 if not found then raise exception 'invoice_check_connection_unavailable' using errcode='42501';end if;
 select count(*) into n from unnest(p_versions) ids(id)
  join public.learn_quickbooks_source_versions v on v.id=ids.id
  join public.learn_quickbooks_latest l on l.version_id=v.id
  where v.tenant_id=p_tenant and v.environment=c.environment and v.realm_id=c.realm_id
   and v.entity='Invoice' and not l.conflicted and l.tenant_id=v.tenant_id
   and l.environment=v.environment and l.realm_id=v.realm_id and l.entity=v.entity
   and l.external_id=v.external_id;
 if n<>cardinality(p_versions) then raise exception 'invoice_check_source_unavailable' using errcode='42501';end if;
 insert into public.learn_quickbooks_invoice_checks
  (id,tenant_id,connection_id,actor_id,environment,realm_id,connection_revision,token_generation,versions,reason)
 values(p_request,p_tenant,c.id,auth.uid(),c.environment,c.realm_id,c.revision,c.token_generation,p_versions,btrim(p_reason));
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'invoice.provider_check_started',
  jsonb_build_object('request_id',p_request,'connection_id',c.id,'realm_id',c.realm_id,
   'versions',to_jsonb(p_versions)),btrim(p_reason));
 return jsonb_build_object('requestId',p_request,'state','prepared');
end $$;

-- Only the server role sees the short-lived access token. A claimed request
-- cannot be replayed, and no refresh grant is issued by this path.
create function public.learn_quickbooks_invoice_check_acquire(p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_invoice_checks%rowtype;c public.learn_quickbooks_connections%rowtype;
 pair jsonb;items jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'invoice_check_forbidden' using errcode='42501';end if;
 select * into r from public.learn_quickbooks_invoice_checks where id=p_request for update;
 if not found or r.state<>'prepared' or r.created_at<clock_timestamp()-interval '5 minutes' then
  raise exception 'invoice_check_unavailable' using errcode='42501';end if;
 perform public.learn_quickbooks_actor_access(r.tenant_id,r.actor_id);
 select * into c from public.learn_quickbooks_connections where id=r.connection_id and tenant_id=r.tenant_id
  and environment=r.environment and realm_id=r.realm_id and revision=r.connection_revision
  and token_generation=r.token_generation and status in ('active','paused') and confirmed_at is not null
  and access_expires_at>clock_timestamp()+interval '2 minutes' for share;
 if not found then raise exception 'invoice_check_connection_changed' using errcode='42501';end if;
 select decrypted_secret::jsonb into pair from vault.decrypted_secrets
  where id=c.token_secret_id and name=public.provider_secret_name(c.tenant_id,'quickbooks',c.id::text||':tokens');
 if pair->>'accessToken' is null or (pair->>'accessExpiresAt')::timestamptz<=clock_timestamp()+interval '2 minutes' then
  raise exception 'invoice_check_credential_unavailable' using errcode='55000';end if;
 select jsonb_agg(jsonb_build_object('versionId',v.id,'invoiceId',v.external_id) order by ids.ordinality)
  into items from unnest(r.versions) with ordinality ids(id,ordinality)
  join public.learn_quickbooks_source_versions v on v.id=ids.id
  join public.learn_quickbooks_latest l on l.version_id=v.id and not l.conflicted
  where v.tenant_id=r.tenant_id and v.environment=r.environment and v.realm_id=r.realm_id and v.entity='Invoice';
 if jsonb_array_length(coalesce(items,'[]'::jsonb))<>cardinality(r.versions) then
  raise exception 'invoice_check_source_changed' using errcode='42501';end if;
 update public.learn_quickbooks_invoice_checks set state='claimed',claimed_at=clock_timestamp() where id=r.id;
 return jsonb_build_object('requestId',r.id,'tenantId',r.tenant_id,'connectionId',r.connection_id,
  'realmId',r.realm_id,'environment',r.environment,'accessToken',pair->>'accessToken','items',items);
end $$;

create function public.learn_quickbooks_invoice_check_current(p_request uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_invoice_checks%rowtype;begin
 if auth.role() is distinct from 'service_role' then return false;end if;
 select * into r from public.learn_quickbooks_invoice_checks where id=p_request and state='claimed'
  and claimed_at>clock_timestamp()-interval '2 minutes';
 if not found then return false;end if;
 perform public.learn_quickbooks_actor_access(r.tenant_id,r.actor_id);
 return exists(select 1 from public.learn_quickbooks_connections c where c.id=r.connection_id
  and c.tenant_id=r.tenant_id and c.environment=r.environment and c.realm_id=r.realm_id
  and c.revision=r.connection_revision and c.token_generation=r.token_generation
  and c.status in ('active','paused') and c.confirmed_at is not null);
 exception when sqlstate '42501' then return false;
end $$;

-- Parse the original provider JSON text in Postgres so decimal numbers never
-- round-trip through JavaScript Number. Persist only comparison results.
create function public.learn_quickbooks_invoice_check_finish(p_request uuid,p_raw text[])
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_invoice_checks%rowtype;entry jsonb;v public.learn_quickbooks_source_versions%rowtype;
 result jsonb:='[]'::jsonb;raw text;invoice jsonb;idx integer;balanced boolean;dated boolean;
 audit uuid;
begin
 if auth.role() is distinct from 'service_role' or p_raw is null or cardinality(p_raw) not between 2 and 3
  or array_position(p_raw,null) is not null then raise exception 'invoice_check_invalid' using errcode='22023';end if;
 select * into r from public.learn_quickbooks_invoice_checks where id=p_request for update;
 if not found or r.state<>'claimed' or cardinality(p_raw)<>cardinality(r.versions)
  or not public.learn_quickbooks_invoice_check_current(p_request) then
  raise exception 'invoice_check_unavailable' using errcode='42501';end if;
 for idx in 1..cardinality(p_raw) loop
  raw:=p_raw[idx];
  if length(raw) not between 1 and 131072 then raise exception 'invoice_check_response_invalid' using errcode='22023';end if;
  entry:=raw::jsonb;invoice:=entry->'Invoice';
  select * into v from public.learn_quickbooks_source_versions where id=r.versions[idx] and tenant_id=r.tenant_id;
  perform 1 from public.learn_quickbooks_latest where version_id=v.id and not conflicted;
  if not found then raise exception 'invoice_check_source_changed' using errcode='42501';end if;
  if jsonb_typeof(invoice) is distinct from 'object' or invoice->>'Id' is distinct from v.external_id
   or jsonb_typeof(invoice->'Balance') is distinct from 'number'
   or public.learn_quickbooks_money(invoice->'Balance') is null
   or invoice->>'DueDate' is null or public.learn_quickbooks_strict_date(invoice->>'DueDate') is null
   or jsonb_typeof(entry->'Fault') is not null then
   raise exception 'invoice_check_response_invalid' using errcode='22023';end if;
  balanced:=public.learn_quickbooks_money(invoice->'Balance') is not distinct from public.learn_quickbooks_money(v.payload->'Balance');
  dated:=invoice->>'DueDate' is not distinct from v.payload->>'DueDate';
  result:=result||jsonb_build_array(jsonb_build_object('version_id',v.id,'invoice_id',v.external_id,
   'retained_balance',public.learn_quickbooks_money(v.payload->'Balance')::text,
   'provider_balance',public.learn_quickbooks_money(invoice->'Balance')::text,
   'retained_due_date',v.payload->>'DueDate','provider_due_date',invoice->>'DueDate',
   'balance_matches',balanced,'due_date_matches',dated,
   'retained_observed_at',(select last_observed_at from public.learn_quickbooks_latest where version_id=v.id),
   'provider_updated_at',invoice#>>'{MetaData,LastUpdatedTime}'));
 end loop;
 update public.learn_quickbooks_invoice_checks set state='complete',result=result where id=r.id;
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(r.tenant_id,r.actor_id,'invoice.provider_check_completed',jsonb_build_object('request_id',r.id,
  'versions',to_jsonb(r.versions),'all_balances_match',not exists(select 1 from jsonb_array_elements(result)x where x->>'balance_matches'<>'true'),
  'all_due_dates_match',not exists(select 1 from jsonb_array_elements(result)x where x->>'due_date_matches'<>'true')),
  r.reason) returning id into audit;
 return jsonb_build_object('version','quickbooks-invoice-check/1','request_id',r.id,'tenant_id',r.tenant_id,
  'environment',r.environment,'realm_id',r.realm_id,'compared_at',clock_timestamp(),'audit_id',audit,'rows',result);
exception when invalid_text_representation or numeric_value_out_of_range then
 raise exception 'invoice_check_response_invalid' using errcode='22023';
end $$;

create function public.learn_quickbooks_invoice_check_result(p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_invoice_checks%rowtype;begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then
  raise exception 'invoice_check_forbidden' using errcode='42501';end if;
 select * into r from public.learn_quickbooks_invoice_checks where id=p_request and actor_id=auth.uid();
 if not found then raise exception 'invoice_check_unavailable' using errcode='42501';end if;
 perform public.learn_operator_input_access(r.tenant_id,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(r.tenant_id,auth.uid());
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(r.tenant_id,auth.uid(),'invoice.provider_check_result_read',jsonb_build_object('request_id',r.id),r.reason);
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('request_id',r.id,'state',r.state,'rows',r.result);
end $$;

create function public.learn_quickbooks_invoice_check_fail(p_request uuid,p_code text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_invoice_checks%rowtype;begin
 if auth.role() is distinct from 'service_role' or p_code is null or p_code not in
  ('scope_changed','authentication_required','provider_unavailable','response_too_large',
   'response_invalid','transport_unavailable','result_unconfirmed') then
  raise exception 'invoice_check_invalid' using errcode='22023';end if;
 select * into r from public.learn_quickbooks_invoice_checks where id=p_request for update;
 if not found or r.state<>'claimed' then return;end if;
 update public.learn_quickbooks_invoice_checks set state='failed' where id=r.id;
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(r.tenant_id,r.actor_id,'invoice.provider_check_failed',
  jsonb_build_object('request_id',r.id,'code',p_code),r.reason);
end $$;

revoke all on function public.learn_quickbooks_invoice_check_candidates(uuid,uuid,text),
 public.learn_quickbooks_invoice_check_start(uuid,uuid,uuid,uuid[],text),
 public.learn_quickbooks_invoice_check_acquire(uuid),public.learn_quickbooks_invoice_check_current(uuid),
 public.learn_quickbooks_invoice_check_finish(uuid,text[]),public.learn_quickbooks_invoice_check_result(uuid),
 public.learn_quickbooks_invoice_check_fail(uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_invoice_check_candidates(uuid,uuid,text),
 public.learn_quickbooks_invoice_check_start(uuid,uuid,uuid,uuid[],text),
 public.learn_quickbooks_invoice_check_result(uuid) to authenticated;
grant execute on function public.learn_quickbooks_invoice_check_acquire(uuid),
 public.learn_quickbooks_invoice_check_current(uuid),public.learn_quickbooks_invoice_check_finish(uuid,text[]),
 public.learn_quickbooks_invoice_check_fail(uuid,text) to service_role;
commit;
