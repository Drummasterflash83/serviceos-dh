-- Reviewed reference-only saved-report publication. No receipt, amount, flag,
-- schedule, owner identity or provider request is created on installation.
begin;

create table public.learn_quickbooks_owner_report_publications (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 revision bigint not null check(revision > 0),
 decision text not null check(decision in ('approve','revoke')),
 profit_request uuid not null references public.learn_quickbooks_report_requests(id),
 receivables_request uuid not null references public.learn_quickbooks_report_requests(id),
 profit_sha256 text not null check(profit_sha256 ~ '^[0-9a-f]{64}$'),
 receivables_sha256 text not null check(receivables_sha256 ~ '^[0-9a-f]{64}$'),
 realm_id text not null check(realm_id ~ '^[1-9][0-9]{0,29}$'),
 period_start date not null,
 period_end date not null,
 accounting_method text not null check(accounting_method in ('Cash','Accrual')),
 ar_as_of date not null,
 reviewed_by uuid not null references public.profiles(id),
 accounting_review_reference text not null
  check(length(btrim(accounting_review_reference)) between 3 and 300),
 reason text not null check(length(btrim(reason)) between 3 and 500),
 reviewed_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,revision),
 check(profit_request <> receivables_request and period_start <= period_end
   and period_end = ar_as_of)
);
create index learn_quickbooks_owner_report_latest
 on public.learn_quickbooks_owner_report_publications(tenant_id,revision desc);
alter table public.learn_quickbooks_owner_report_publications enable row level security;
revoke all on public.learn_quickbooks_owner_report_publications
 from public,anon,authenticated,service_role;
create trigger owner_report_publications_immutable before update or delete
 on public.learn_quickbooks_owner_report_publications for each row
 execute function public.learn_operator_input_immutable();
create trigger owner_report_publications_not_truncated before truncate
 on public.learn_quickbooks_owner_report_publications for each statement
 execute function public.learn_operator_input_immutable();

-- The existing invoice authority allows admin, so it must not guard net profit.
create function public.learn_quickbooks_owner_report_access(p_tenant uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null
  or p_tenant is null then
  raise exception 'owner_report_forbidden' using errcode='42501';end if;
 perform 1 from auth.users u where u.id=auth.uid() and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share;
 if not found then raise exception 'owner_report_forbidden' using errcode='42501';end if;
 perform 1 from public.profiles p join public.tenants t on t.id=p.tenant_id
  where p.id=auth.uid() and p.tenant_id=p_tenant and p.role='owner'
   and t.status='active' for share of p,t;
 if not found or exists(select 1 from public.view_as_context v
  where v.actor_user_id=auth.uid() and v.ended_at is null
   and (v.expires_at is null or v.expires_at>clock_timestamp()))
  or exists(select 1 from public.platform_authority_grants g
   where g.profile_id=auth.uid()
    and g.permission in ('platform.controlplane.view','platform.controlplane.admin')
    and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
    and coalesce(g.effective_to,'infinity')>clock_timestamp()) then
  raise exception 'owner_report_forbidden' using errcode='42501';end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='learn.enabled' and value='true'::jsonb for share;
 if not found then raise exception 'owner_report_forbidden' using errcode='42501';end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.owner_accounts_report' and value='true'::jsonb for share;
 if not found then raise exception 'owner_report_disabled' using errcode='42501';end if;
end $$;
revoke all on function public.learn_quickbooks_owner_report_access(uuid)
 from public,anon,authenticated,service_role;

-- Only the original authorised OpenFolk report actor may review the exact
-- saved pair. The existing summary reader validates source shape and audits.
create function public.learn_quickbooks_owner_report_review(
 p_tenant uuid,p_decision text,p_profit_request uuid,p_receivables_request uuid,
 p_profit_sha256 text,p_receivables_sha256 text,p_expected_revision bigint,
 p_accounting_review_reference text,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.learn_quickbooks_owner_report_publications%rowtype;
 reviewed jsonb;publication_id uuid;audit uuid;next_revision bigint;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null
  or p_tenant is null or p_decision is null or p_decision not in ('approve','revoke')
  or p_expected_revision is null or p_expected_revision<0
  or p_accounting_review_reference is null
  or length(btrim(p_accounting_review_reference)) not between 3 and 300
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'owner_report_review_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.owner_report_review' and value='true'::jsonb for share;
 if not found then raise exception 'owner_report_review_disabled' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('owner-report:'||p_tenant::text,0));
 select * into prior from public.learn_quickbooks_owner_report_publications
  where tenant_id=p_tenant order by revision desc limit 1 for update;
 if coalesce(prior.revision,0)<>p_expected_revision then
  raise exception 'owner_report_review_changed' using errcode='40001';end if;
 next_revision:=p_expected_revision+1;
 if p_decision='approve' then
  if p_profit_request is null or p_receivables_request is null
   or p_profit_request=p_receivables_request
   or p_profit_sha256 is null or p_receivables_sha256 is null
   or p_profit_sha256 !~ '^[0-9a-f]{64}$'
   or p_receivables_sha256 !~ '^[0-9a-f]{64}$' then
   raise exception 'owner_report_review_invalid' using errcode='22023';end if;
  reviewed:=public.learn_quickbooks_report_summary_preview(
   p_tenant,p_profit_request,p_receivables_request,btrim(p_reason));
  if reviewed->>'environment' is distinct from 'production'
   or reviewed->>'profit_sha256' is distinct from p_profit_sha256
   or reviewed->>'receivables_sha256' is distinct from p_receivables_sha256
   or reviewed->>'realm_id' is null then
   raise exception 'owner_report_review_source_changed' using errcode='40001';end if;
 else
  if prior.id is null or prior.decision<>'approve'
   or p_profit_request is not null or p_receivables_request is not null
   or p_profit_sha256 is not null or p_receivables_sha256 is not null then
   raise exception 'owner_report_review_invalid' using errcode='22023';end if;
 end if;
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 insert into public.learn_quickbooks_owner_report_publications(
  tenant_id,revision,decision,profit_request,receivables_request,
  profit_sha256,receivables_sha256,realm_id,period_start,period_end,
  accounting_method,ar_as_of,reviewed_by,accounting_review_reference,reason)
 values(p_tenant,next_revision,p_decision,
  case when p_decision='approve' then p_profit_request else prior.profit_request end,
  case when p_decision='approve' then p_receivables_request else prior.receivables_request end,
  case when p_decision='approve' then p_profit_sha256 else prior.profit_sha256 end,
  case when p_decision='approve' then p_receivables_sha256 else prior.receivables_sha256 end,
  case when p_decision='approve' then reviewed->>'realm_id' else prior.realm_id end,
  case when p_decision='approve' then (reviewed->>'period_start')::date else prior.period_start end,
  case when p_decision='approve' then (reviewed->>'period_end')::date else prior.period_end end,
  case when p_decision='approve' then reviewed->>'accounting_method' else prior.accounting_method end,
  case when p_decision='approve' then (reviewed->>'ar_as_of')::date else prior.ar_as_of end,
  auth.uid(),btrim(p_accounting_review_reference),btrim(p_reason))
  returning id into publication_id;
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'owner_report.'||p_decision,
  jsonb_build_object('publication_id',publication_id,'revision',next_revision,
   'profit_request',case when p_decision='approve' then p_profit_request else prior.profit_request end,
   'receivables_request',case when p_decision='approve' then p_receivables_request else prior.receivables_request end),
  btrim(p_reason)) returning id into audit;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','owner-report-review/1','tenant_id',p_tenant,
  'decision',p_decision,'revision',next_revision,'publication_id',publication_id,
  'audit_id',audit);
end $$;

-- Owner-exact read: no operator impersonation or admin/team net-profit payload.
create function public.learn_quickbooks_owner_accounts_report(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog
set statement_timeout='15s' as $$
declare pub public.learn_quickbooks_owner_report_publications%rowtype;
 pl public.learn_quickbooks_report_requests%rowtype;
 ar public.learn_quickbooks_report_requests%rowtype;
 pl_receipt public.learn_quickbooks_report_receipts%rowtype;
 ar_receipt public.learn_quickbooks_report_receipts%rowtype;
 summary jsonb;audit uuid;
begin
 perform public.learn_quickbooks_owner_report_access(p_tenant);
 select * into pub from public.learn_quickbooks_owner_report_publications
  where tenant_id=p_tenant order by revision desc limit 1 for share;
 if pub.id is null or pub.decision<>'approve' then
  raise exception 'owner_report_unpublished' using errcode='42501';end if;
 select * into pl from public.learn_quickbooks_report_requests
  where id=pub.profit_request and tenant_id=p_tenant
   and report_kind='ProfitAndLoss' and state='complete' for share;
 select * into ar from public.learn_quickbooks_report_requests
  where id=pub.receivables_request and tenant_id=p_tenant
   and report_kind='AgedReceivables' and state='complete' for share;
 if pl.id is null or ar.id is null or pl.connection_id<>ar.connection_id
  or pl.environment<>'production' or ar.environment<>'production'
  or pl.realm_id<>ar.realm_id or pl.realm_id<>pub.realm_id
  or pl.period_start<>pub.period_start or pl.period_end<>pub.period_end
  or pl.accounting_method<>pub.accounting_method or ar.report_date<>pub.ar_as_of
  or pl.period_end<>ar.report_date or ar.aging_method is distinct from 'Report_Date' then
  raise exception 'owner_report_source_changed' using errcode='40001';end if;
 select * into pl_receipt from public.learn_quickbooks_report_receipts
  where request_id=pl.id and tenant_id=p_tenant and report_kind='ProfitAndLoss'
   and validation_state='verified' and response_sha256=pub.profit_sha256 for share;
 select * into ar_receipt from public.learn_quickbooks_report_receipts
  where request_id=ar.id and tenant_id=p_tenant and report_kind='AgedReceivables'
   and validation_state='verified' and response_sha256=pub.receivables_sha256 for share;
 if pl_receipt.request_id is null or ar_receipt.request_id is null
  or pl_receipt.header->>'StartPeriod' is distinct from pl.period_start::text
  or pl_receipt.header->>'EndPeriod' is distinct from pl.period_end::text
  or pl_receipt.header->>'ReportBasis' is distinct from pl.accounting_method
  or not exists(select 1 from jsonb_array_elements(case when
     jsonb_typeof(ar_receipt.header->'Option')='array' then ar_receipt.header->'Option'
     else '[]'::jsonb end) x
   where x->>'Name'='report_date' and x->>'Value'=ar.report_date::text) then
  raise exception 'owner_report_source_changed' using errcode='40001';end if;
 summary:=public.learn_quickbooks_report_summary_extract(
  pl_receipt.raw_response::jsonb,ar_receipt.raw_response::jsonb);
 perform public.learn_quickbooks_owner_report_access(p_tenant);
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail)
 values(p_tenant,auth.uid(),'owner_report.read',jsonb_build_object(
  'publication_id',pub.id,'revision',pub.revision,
  'profit_sha256',pub.profit_sha256,'receivables_sha256',pub.receivables_sha256))
 returning id into audit;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','owner-accounts-report/1',
  'audience','client_owner_only','tenant_id',p_tenant,'source','QuickBooks Online',
  'scope','published_company_accounts_not_job_costing','realm_id',pub.realm_id,
  'period_start',pub.period_start,'period_end',pub.period_end,
  'accounting_method',pub.accounting_method,'ar_as_of',pub.ar_as_of,
  'currency',summary->>'currency','publication_revision',pub.revision,
  'accounts_gross_profit',summary->>'accounts_gross_profit',
  'net_profit',summary->>'net_profit',
  'aged_receivables',jsonb_build_object('current',summary->>'ar_current',
   'age_1_30',summary->>'ar_1_30','age_31_60',summary->>'ar_31_60',
   'age_61_90',summary->>'ar_61_90','age_91_plus',summary->>'ar_91_plus',
   'total',summary->>'ar_total'),
  'field_gross_profit',jsonb_build_object('status','held','reason','job_cost_mapping_not_verified'),
  'arr',jsonb_build_object('status','held','reason','recurring_contract_not_verified'),
  'audit_id',audit);
end $$;

revoke all on function public.learn_quickbooks_owner_report_review(
 uuid,text,uuid,uuid,text,text,bigint,text,text),
 public.learn_quickbooks_owner_accounts_report(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_owner_report_review(
 uuid,text,uuid,uuid,text,text,bigint,text,text) to authenticated;
grant execute on function public.learn_quickbooks_owner_accounts_report(uuid)
 to authenticated;
commit;
