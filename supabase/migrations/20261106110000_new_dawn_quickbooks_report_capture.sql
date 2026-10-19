-- One-use, operator-only QuickBooks P&L or A/R report evidence capture.
-- Installs no schedule, report request, flag or provider credential.
begin;

create table public.learn_quickbooks_report_requests (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 connection_id uuid not null,
 actor_id uuid not null references public.profiles(id),
 environment text not null check(environment in ('sandbox','production')),
 realm_id text not null,
 connection_revision bigint not null,
 token_generation bigint not null,
 report_kind text not null check(report_kind in ('ProfitAndLoss','AgedReceivables')),
 period_start date,
 period_end date,
 accounting_method text,
 report_date date,
 aging_method text,
 reason text not null check(length(btrim(reason)) between 3 and 500),
 state text not null default 'prepared' check(state in ('prepared','claimed','complete','held','failed')),
 claimed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(connection_id,tenant_id) references public.learn_quickbooks_connections(id,tenant_id),
 check((report_kind='ProfitAndLoss' and period_start is not null and period_end is not null
   and accounting_method in ('Cash','Accrual') and report_date is null and aging_method is null)
  or (report_kind='AgedReceivables' and period_start is null and period_end is null
   and accounting_method is null and report_date is not null and aging_method='Report_Date'))
);
create table public.learn_quickbooks_report_receipts (
 request_id uuid primary key references public.learn_quickbooks_report_requests(id),
 tenant_id uuid not null references public.tenants(id),
 report_kind text not null check(report_kind in ('ProfitAndLoss','AgedReceivables')),
 raw_response text not null check(octet_length(raw_response) between 1 and 2097152),
 response_sha256 text not null check(response_sha256 ~ '^[0-9a-f]{64}$'),
 header jsonb,
 validation_state text not null check(validation_state in ('verified','held')),
 validation_code text check(validation_code in ('report_name_mismatch','scope_mismatch','format_invalid')),
 received_at timestamptz not null default clock_timestamp()
);
alter table public.learn_quickbooks_report_requests enable row level security;
alter table public.learn_quickbooks_report_receipts enable row level security;
revoke all on public.learn_quickbooks_report_requests,public.learn_quickbooks_report_receipts
 from public,anon,authenticated,service_role;
create trigger report_receipt_immutable before update or delete on public.learn_quickbooks_report_receipts
 for each row execute function public.learn_operator_input_immutable();
create trigger report_receipts_not_truncated before truncate on public.learn_quickbooks_report_receipts
 for each statement execute function public.learn_operator_input_immutable();

create function public.learn_quickbooks_report_start(
 p_tenant uuid,p_connection uuid,p_request uuid,p_realm text,p_environment text,p_kind text,
 p_period_start date,p_period_end date,p_accounting_method text,
 p_report_date date,p_aging_method text,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.learn_quickbooks_connections%rowtype;today date:=(clock_timestamp() at time zone 'UTC')::date;
begin
 if auth.role() is distinct from 'authenticated' or p_request is null or p_connection is null
  or p_realm is null or p_realm !~ '^[1-9][0-9]{0,29}$'
  or p_environment is null or p_environment not in ('sandbox','production')
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500
  or not ((p_kind='ProfitAndLoss' and p_period_start is not null and p_period_end is not null
   and p_period_start<=p_period_end and p_period_end<=today and p_period_end-p_period_start<=366
   and p_accounting_method in ('Cash','Accrual') and p_report_date is null and p_aging_method is null)
   or (p_kind='AgedReceivables' and p_period_start is null and p_period_end is null
   and p_accounting_method is null and p_report_date is not null and p_report_date<=today
   and p_report_date>=today-31 and p_aging_method='Report_Date')) then
  raise exception 'report_request_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 select * into c from public.learn_quickbooks_connections
  where id=p_connection and tenant_id=p_tenant and realm_id=p_realm and environment=p_environment
   and status in ('active','paused')
   and confirmed_at is not null and realm_id is not null for share;
 if not found then raise exception 'report_connection_unavailable' using errcode='42501';end if;
 insert into public.learn_quickbooks_report_requests(id,tenant_id,connection_id,actor_id,
  environment,realm_id,connection_revision,token_generation,report_kind,
  period_start,period_end,accounting_method,report_date,aging_method,reason)
 values(p_request,p_tenant,c.id,auth.uid(),c.environment,c.realm_id,c.revision,c.token_generation,
  p_kind,p_period_start,p_period_end,p_accounting_method,p_report_date,p_aging_method,btrim(p_reason));
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'report.capture_started',jsonb_build_object('request_id',p_request,
  'connection_id',c.id,'realm_id',c.realm_id,'environment',c.environment,'kind',p_kind,
  'period_start',p_period_start,'period_end',p_period_end,'accounting_method',p_accounting_method,
  'report_date',p_report_date,'aging_method',p_aging_method),btrim(p_reason));
 return jsonb_build_object('requestId',p_request,'state','prepared');
end $$;

create function public.learn_quickbooks_report_current(p_request uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_report_requests%rowtype;begin
 if auth.role() is distinct from 'service_role' then return false;end if;
 select * into r from public.learn_quickbooks_report_requests where id=p_request and state='claimed'
  and claimed_at>clock_timestamp()-interval '2 minutes';
 if not found then return false;end if;
 perform public.learn_quickbooks_actor_access(r.tenant_id,r.actor_id);
 return exists(select 1 from public.learn_quickbooks_connections c where c.id=r.connection_id
  and c.tenant_id=r.tenant_id and c.environment=r.environment and c.realm_id=r.realm_id
  and c.revision=r.connection_revision and c.token_generation=r.token_generation
  and c.status in ('active','paused') and c.confirmed_at is not null);
exception when sqlstate '42501' then return false;
end $$;

create function public.learn_quickbooks_report_acquire(p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_report_requests%rowtype;c public.learn_quickbooks_connections%rowtype;pair jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'report_forbidden' using errcode='42501';end if;
 select * into r from public.learn_quickbooks_report_requests where id=p_request for update;
 if not found or r.state<>'prepared' or r.created_at<clock_timestamp()-interval '5 minutes' then
  raise exception 'report_unavailable' using errcode='42501';end if;
 perform public.learn_quickbooks_actor_access(r.tenant_id,r.actor_id);
 select * into c from public.learn_quickbooks_connections where id=r.connection_id
  and tenant_id=r.tenant_id and environment=r.environment and realm_id=r.realm_id
  and revision=r.connection_revision and token_generation=r.token_generation
  and status in ('active','paused') and confirmed_at is not null
  and access_expires_at>clock_timestamp()+interval '2 minutes' for share;
 if not found then raise exception 'report_connection_changed' using errcode='42501';end if;
 select decrypted_secret::jsonb into pair from vault.decrypted_secrets
  where id=c.token_secret_id and name=public.provider_secret_name(c.tenant_id,'quickbooks',c.id::text||':tokens');
 if pair->>'accessToken' is null or (pair->>'accessExpiresAt')::timestamptz<=clock_timestamp()+interval '2 minutes' then
  raise exception 'report_credential_unavailable' using errcode='55000';end if;
 update public.learn_quickbooks_report_requests set state='claimed',claimed_at=clock_timestamp() where id=r.id;
 return jsonb_build_object('requestId',r.id,'tenantId',r.tenant_id,'connectionId',r.connection_id,
  'realmId',r.realm_id,'environment',r.environment,'accessToken',pair->>'accessToken',
  'kind',r.report_kind,'periodStart',r.period_start,'periodEnd',r.period_end,
  'accountingMethod',r.accounting_method,'reportDate',r.report_date,'agingMethod',r.aging_method);
end $$;

create function public.learn_quickbooks_report_finish(p_request uuid,p_raw text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_report_requests%rowtype;report_doc jsonb;report_header jsonb;
 receipt_hash text;audit uuid;validation_state text:='verified';validation_code text;begin
 if auth.role() is distinct from 'service_role' or p_raw is null or octet_length(p_raw) not between 1 and 2097152 then
  raise exception 'report_response_invalid' using errcode='22023';end if;
 select * into r from public.learn_quickbooks_report_requests where id=p_request for update;
 if not found or r.state<>'claimed' or not public.learn_quickbooks_report_current(p_request) then
  raise exception 'report_unavailable' using errcode='42501';end if;
 report_doc:=p_raw::jsonb;report_header:=report_doc->'Header';
 if jsonb_typeof(report_doc) is distinct from 'object' or jsonb_typeof(report_header) is distinct from 'object'
  or jsonb_typeof(report_doc->'Rows') is distinct from 'object'
  or jsonb_typeof(report_doc->'Fault') is not null then
  validation_state:='held';validation_code:='format_invalid';
 elsif report_header->>'ReportName' is distinct from r.report_kind then
  validation_state:='held';validation_code:='report_name_mismatch';
 elsif (r.report_kind='ProfitAndLoss' and
    (report_header->>'StartPeriod' is distinct from r.period_start::text
     or report_header->>'EndPeriod' is distinct from r.period_end::text
     or report_header->>'ReportBasis' is distinct from r.accounting_method))
  or (r.report_kind='AgedReceivables' and not exists(
    select 1 from jsonb_array_elements(case when jsonb_typeof(report_header->'Option')='array'
      then report_header->'Option' else '[]'::jsonb end) opt
    where opt->>'Name'='report_date' and opt->>'Value'=r.report_date::text)) then
  validation_state:='held';validation_code:='scope_mismatch';end if;
 receipt_hash:=encode(sha256(convert_to(p_raw,'UTF8')),'hex');
 insert into public.learn_quickbooks_report_receipts(request_id,tenant_id,report_kind,
  raw_response,response_sha256,header,validation_state,validation_code)
 values(r.id,r.tenant_id,r.report_kind,p_raw,receipt_hash,report_header,validation_state,validation_code);
 update public.learn_quickbooks_report_requests
  set state=case when validation_state='verified' then 'complete' else 'held' end where id=r.id;
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(r.tenant_id,r.actor_id,case when validation_state='verified' then 'report.capture_completed' else 'report.capture_held' end,
  jsonb_build_object('request_id',r.id,
  'kind',r.report_kind,'response_sha256',receipt_hash,'response_bytes',octet_length(p_raw),
  'report_time',report_header->>'Time','currency',report_header->>'Currency',
  'validation_state',validation_state,'validation_code',validation_code),r.reason)
 returning id into audit;
 return jsonb_build_object('version','quickbooks-report-capture/1','request_id',r.id,
  'tenant_id',r.tenant_id,'realm_id',r.realm_id,'environment',r.environment,
  'kind',r.report_kind,'period_start',r.period_start,'period_end',r.period_end,
  'accounting_method',r.accounting_method,'report_date',r.report_date,
  'aging_method',r.aging_method,'response_sha256',receipt_hash,
  'response_bytes',octet_length(p_raw),'report_time',report_header->>'Time',
  'currency',report_header->>'Currency','validation_state',validation_state,
  'validation_code',validation_code,'audit_id',audit);
exception when invalid_text_representation or numeric_value_out_of_range then
 raise exception 'report_response_invalid' using errcode='22023';
end $$;

create function public.learn_quickbooks_report_fail(p_request uuid,p_code text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_report_requests%rowtype;begin
 if auth.role() is distinct from 'service_role' or p_code is null or p_code not in
  ('scope_changed','authentication_required','provider_unavailable','response_too_large',
   'response_invalid','transport_unavailable','result_unconfirmed') then
  raise exception 'report_invalid' using errcode='22023';end if;
 select * into r from public.learn_quickbooks_report_requests where id=p_request for update;
 if not found or r.state<>'claimed' then return;end if;
 update public.learn_quickbooks_report_requests set state='failed' where id=r.id;
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(r.tenant_id,r.actor_id,'report.capture_failed',
  jsonb_build_object('request_id',r.id,'code',p_code),r.reason);
end $$;

create function public.learn_quickbooks_report_result(p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_report_requests%rowtype;receipt public.learn_quickbooks_report_receipts%rowtype;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then
  raise exception 'report_forbidden' using errcode='42501';end if;
 select * into r from public.learn_quickbooks_report_requests where id=p_request and actor_id=auth.uid();
 if not found then raise exception 'report_unavailable' using errcode='42501';end if;
 perform public.learn_operator_input_access(r.tenant_id,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(r.tenant_id,auth.uid());
 select * into receipt from public.learn_quickbooks_report_receipts where request_id=r.id;
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(r.tenant_id,auth.uid(),'report.capture_result_read',jsonb_build_object('request_id',r.id),r.reason);
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('request_id',r.id,'state',r.state,'kind',r.report_kind,
  'response_sha256',receipt.response_sha256,'received_at',receipt.received_at,
  'report_time',receipt.header->>'Time','currency',receipt.header->>'Currency',
  'validation_state',receipt.validation_state,'validation_code',receipt.validation_code);
end $$;

revoke all on function public.learn_quickbooks_report_start(uuid,uuid,uuid,text,text,text,date,date,text,date,text,text),
 public.learn_quickbooks_report_current(uuid),public.learn_quickbooks_report_acquire(uuid),
 public.learn_quickbooks_report_finish(uuid,text),public.learn_quickbooks_report_fail(uuid,text),
 public.learn_quickbooks_report_result(uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_report_start(uuid,uuid,uuid,text,text,text,date,date,text,date,text,text),
 public.learn_quickbooks_report_result(uuid) to authenticated;
grant execute on function public.learn_quickbooks_report_current(uuid),public.learn_quickbooks_report_acquire(uuid),
 public.learn_quickbooks_report_finish(uuid,text),public.learn_quickbooks_report_fail(uuid,text) to service_role;
commit;
