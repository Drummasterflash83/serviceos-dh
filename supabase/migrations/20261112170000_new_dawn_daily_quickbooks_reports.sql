-- Source-only daily FY27 P&L and A/R capture. Installation is inert: no row,
-- schedule, worker call, token exchange or provider request is created here.
begin;

create table public.learn_quickbooks_daily_reports (
 connection_id uuid primary key,
 tenant_id uuid not null,
 environment text not null check(environment='production'),
 realm_id text not null,
 app_id uuid not null,
 confirmed_at timestamptz not null,
 app_revision bigint not null,
 approved_by uuid not null references public.profiles(id),
 approval_reference text not null check(length(btrim(approval_reference)) between 10 and 200),
 reason text not null check(length(btrim(reason)) between 10 and 500),
 period_start date not null,
 enabled boolean not null default false,
 revision bigint not null default 1,
 changed_at timestamptz not null default clock_timestamp(),
 foreign key(connection_id,tenant_id) references public.learn_quickbooks_connections(id,tenant_id)
);
create table public.learn_quickbooks_daily_report_runs (
 id uuid primary key default gen_random_uuid(),
 connection_id uuid not null references public.learn_quickbooks_daily_reports(connection_id),
 tenant_id uuid not null references public.tenants(id),
 report_date date not null,
 schedule_revision bigint not null,
 state text not null check(state in ('claimed','prepared','complete','held')),
 claimed_at timestamptz not null default clock_timestamp(),
 pnl_request_id uuid,
 ar_request_id uuid,
 outcome_code text,
 finished_at timestamptz,
 unique(connection_id,report_date),
 check((pnl_request_id is null and ar_request_id is null) or
  (pnl_request_id is not null and ar_request_id is not null and pnl_request_id<>ar_request_id))
);
alter table public.learn_quickbooks_report_requests add column daily_run_id uuid
 references public.learn_quickbooks_daily_report_runs(id);
alter table public.learn_quickbooks_daily_reports enable row level security;
alter table public.learn_quickbooks_daily_report_runs enable row level security;
revoke all on public.learn_quickbooks_daily_reports,public.learn_quickbooks_daily_report_runs
 from public,anon,authenticated,service_role;

-- Chris approved this standing read-only Drummonds scope in the 21 Oct New Dawn
-- goal. The authenticated operator action records that approval and a reason.
create function public.learn_quickbooks_daily_report_control(
 p_tenant uuid,p_connection uuid,p_revision bigint,p_enabled boolean,
 p_period_start date,p_approval_reference text,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.learn_quickbooks_connections%rowtype;s public.learn_quickbooks_daily_reports%rowtype;
 a public.learn_quickbooks_apps%rowtype;
begin
 if auth.role() is distinct from 'authenticated' or p_connection is null or p_revision is null
  or p_revision<0 or p_enabled is null or p_period_start is null
  or p_tenant is distinct from '00000000-0000-0000-0000-000000000001'::uuid
  or p_connection is distinct from '04d68333-fc13-42c2-a500-789f386f015c'::uuid
  or p_approval_reference is null or length(btrim(p_approval_reference)) not between 10 and 200
  or p_reason is null or length(btrim(p_reason)) not between 10 and 500 then
  raise exception 'daily_report_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-daily-report:'||p_connection::text,0));
 select * into s from public.learn_quickbooks_daily_reports where connection_id=p_connection for update;
 if coalesce(s.revision,0)<>p_revision then raise exception 'daily_report_changed' using errcode='PT409';end if;
 if not p_enabled then
  if s.connection_id is null or s.tenant_id<>p_tenant or s.period_start<>p_period_start then
   raise exception 'daily_report_unavailable' using errcode='42501';end if;
  update public.learn_quickbooks_daily_reports set enabled=false,revision=p_revision+1,
   approved_by=auth.uid(),approval_reference=btrim(p_approval_reference),reason=btrim(p_reason),
   changed_at=clock_timestamp() where connection_id=p_connection;
  insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
  values(p_tenant,auth.uid(),'report.daily_policy_changed',jsonb_build_object('connection_id',p_connection,
   'revision',p_revision+1,'enabled',false,'approval_reference',btrim(p_approval_reference)),btrim(p_reason));
  return jsonb_build_object('revision',p_revision+1,'enabled',false);
 end if;
 select * into c from public.learn_quickbooks_connections where id=p_connection and tenant_id=p_tenant for share;
 if not found or c.environment<>'production' or c.realm_id<>'1197397945' or c.confirmed_at is null
  or c.status not in ('active','paused') or c.token_secret_id is null then
  raise exception 'daily_report_connection_unavailable' using errcode='42501';end if;
 select * into a from public.learn_quickbooks_apps where id=c.app_id and active for share;
 if not found then raise exception 'daily_report_app_unavailable' using errcode='42501';end if;
 perform public.learn_quickbooks_enabled(p_tenant);
 if p_period_start<>date '2026-04-01' or p_period_start>(clock_timestamp() at time zone 'Europe/London')::date
  or a.environment<>'production' then
  raise exception 'daily_report_scope_invalid' using errcode='22023';end if;
 insert into public.learn_quickbooks_daily_reports(connection_id,tenant_id,environment,realm_id,app_id,
  confirmed_at,app_revision,approved_by,approval_reference,reason,period_start,enabled,revision)
 values(c.id,p_tenant,c.environment,c.realm_id,c.app_id,c.confirmed_at,a.revision,auth.uid(),btrim(p_approval_reference),
  btrim(p_reason),p_period_start,p_enabled,p_revision+1)
 on conflict(connection_id) do update set confirmed_at=excluded.confirmed_at,app_revision=excluded.app_revision,
  approved_by=excluded.approved_by,approval_reference=excluded.approval_reference,
  reason=excluded.reason,period_start=excluded.period_start,enabled=excluded.enabled,
  revision=excluded.revision,changed_at=clock_timestamp();
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'report.daily_policy_changed',jsonb_build_object('connection_id',c.id,
  'revision',p_revision+1,'enabled',p_enabled,'period_start',p_period_start,
  'approval_reference',btrim(p_approval_reference)),btrim(p_reason));
 return jsonb_build_object('revision',p_revision+1,'enabled',p_enabled);
end $$;

-- One bounded operator status read supports the one-click control and makes
-- missed, held and complete days visible without exposing report bodies.
create function public.learn_quickbooks_daily_report_status(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s public.learn_quickbooks_daily_reports%rowtype;
 r public.learn_quickbooks_daily_report_runs%rowtype;
 audit uuid:=gen_random_uuid();
 expected_day date:=(clock_timestamp() at time zone 'Europe/London')::date-1;
 overdue boolean;
begin
 if auth.role() is distinct from 'authenticated' or
  p_tenant is distinct from '00000000-0000-0000-0000-000000000001'::uuid then
  raise exception 'daily_report_forbidden' using errcode='42501';end if;
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 select * into s from public.learn_quickbooks_daily_reports
  where connection_id='04d68333-fc13-42c2-a500-789f386f015c'::uuid
   and tenant_id=p_tenant;
 if found then
  select * into r from public.learn_quickbooks_daily_report_runs
   where connection_id=s.connection_id order by report_date desc limit 1;
 end if;
 overdue:=coalesce(s.enabled,false) and
  (clock_timestamp() at time zone 'Europe/London')::time>=time '06:00' and
  (r.report_date is distinct from expected_day or r.state<>'complete');
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit,p_tenant,auth.uid()::text,'quickbooks.daily_report_status_read',
  'quickbooks',p_tenant::text,
  jsonb_build_object('enabled',coalesce(s.enabled,false),
   'latest_day',r.report_date,'latest_state',r.state),
  'Review daily QuickBooks report capture',audit::text,false,
  'new-dawn-quickbooks-daily-reports');
 return jsonb_build_object('version','new-dawn-daily-quickbooks-status/1',
  'tenant_id',p_tenant,'actor_id',auth.uid(),'audit_id',audit,
  'read_at',clock_timestamp(),'connection_id',
  '04d68333-fc13-42c2-a500-789f386f015c',
  'enabled',coalesce(s.enabled,false),'revision',coalesce(s.revision,0),
  'period_start',s.period_start,'expected_day',expected_day,'overdue',overdue,
  'latest_day',r.report_date,
  'latest_state',r.state,'latest_code',r.outcome_code);
end $$;

create function public.learn_quickbooks_daily_report_current(p_run uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_daily_report_runs%rowtype;s public.learn_quickbooks_daily_reports%rowtype;
begin
 if auth.role() is distinct from 'service_role' then return false;end if;
 select * into r from public.learn_quickbooks_daily_report_runs where id=p_run
  and state in ('claimed','prepared') and claimed_at>clock_timestamp()-interval '5 minutes';
 if not found then return false;end if;
 select * into s from public.learn_quickbooks_daily_reports where connection_id=r.connection_id
  and tenant_id=r.tenant_id and enabled and revision=r.schedule_revision
  and tenant_id='00000000-0000-0000-0000-000000000001'::uuid
  and connection_id='04d68333-fc13-42c2-a500-789f386f015c'::uuid
  and realm_id='1197397945';
 if not found then return false;end if;
 perform public.learn_quickbooks_actor_access(s.tenant_id,s.approved_by);
 perform public.learn_quickbooks_enabled(s.tenant_id);
 return exists(select 1 from public.learn_quickbooks_connections c
  join public.learn_quickbooks_apps a on a.id=c.app_id and a.active and a.revision=s.app_revision
  where c.id=s.connection_id and c.tenant_id=s.tenant_id and c.environment=s.environment
   and c.realm_id=s.realm_id and c.app_id=s.app_id and c.confirmed_at=s.confirmed_at
   and c.status in ('active','paused') and c.confirmed_at is not null and c.token_secret_id is not null);
exception when sqlstate '42501' then return false;
end $$;

-- Select at most one due company per invocation. Yesterday is the last complete
-- Europe/London accounting day; no historic catch-up is silently attempted.
create function public.learn_quickbooks_daily_report_claim() returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.learn_quickbooks_daily_reports%rowtype;r public.learn_quickbooks_daily_report_runs%rowtype;
 d date:=(clock_timestamp() at time zone 'Europe/London')::date-1;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'daily_report_forbidden' using errcode='42501';end if;
 if (clock_timestamp() at time zone 'Europe/London')::time<time '04:00' then return null;end if;
 for s in select * from public.learn_quickbooks_daily_reports where enabled and period_start<=d
  and tenant_id='00000000-0000-0000-0000-000000000001'::uuid
  and connection_id='04d68333-fc13-42c2-a500-789f386f015c'::uuid
  and realm_id='1197397945'
  order by changed_at,connection_id for update skip locked loop
  if exists(select 1 from public.learn_quickbooks_daily_report_runs x
   where x.connection_id=s.connection_id and (x.report_date=d or x.state in ('claimed','prepared'))) then continue;end if;
  insert into public.learn_quickbooks_daily_report_runs(connection_id,tenant_id,report_date,schedule_revision,state)
  values(s.connection_id,s.tenant_id,d,s.revision,'claimed') returning * into r;
  if not public.learn_quickbooks_daily_report_current(r.id) then
   update public.learn_quickbooks_daily_report_runs set state='held',outcome_code='scope_changed',finished_at=clock_timestamp() where id=r.id;
   continue;
  end if;
  insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
  values(s.tenant_id,s.approved_by,'report.daily_claimed',jsonb_build_object('run_id',r.id,
   'report_date',d,'schedule_revision',s.revision,'connection_id',s.connection_id),s.reason);
  return jsonb_build_object('runId',r.id,'tenantId',s.tenant_id,'connectionId',s.connection_id,
   'reportDate',d,'periodStart',s.period_start,'realmId',s.realm_id,'environment',s.environment);
 end loop;
 return null;
end $$;

-- Wrapper ensures the standing grant is current before the existing lease can
-- expose a refresh credential. The generic lease still owns token rotation.
create function public.learn_quickbooks_daily_refresh_acquire(p_run uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_daily_report_runs%rowtype;
begin
 if auth.role() is distinct from 'service_role' or not public.learn_quickbooks_daily_report_current(p_run) then
  raise exception 'daily_report_forbidden' using errcode='42501';end if;
 select * into r from public.learn_quickbooks_daily_report_runs where id=p_run;
 return public.learn_quickbooks_refresh_acquire(r.tenant_id,r.connection_id);
end $$;
create function public.learn_quickbooks_daily_refresh_finish(
 p_run uuid,p_lease uuid,p_generation bigint,p_revision bigint,p_pair jsonb
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_daily_report_runs%rowtype;
begin
 if auth.role() is distinct from 'service_role' or not public.learn_quickbooks_daily_report_current(p_run) then
  raise exception 'daily_report_forbidden' using errcode='42501';end if;
 select * into r from public.learn_quickbooks_daily_report_runs where id=p_run;
 perform public.learn_quickbooks_refresh_finish(r.tenant_id,r.connection_id,p_lease,p_generation,p_revision,p_pair);
end $$;

create function public.learn_quickbooks_daily_report_prepare(p_run uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_daily_report_runs%rowtype;s public.learn_quickbooks_daily_reports%rowtype;
 c public.learn_quickbooks_connections%rowtype;p uuid:=gen_random_uuid();a uuid:=gen_random_uuid();
begin
 if auth.role() is distinct from 'service_role' or not public.learn_quickbooks_daily_report_current(p_run) then
  raise exception 'daily_report_forbidden' using errcode='42501';end if;
 select * into r from public.learn_quickbooks_daily_report_runs where id=p_run for update;
 if r.state<>'claimed' then raise exception 'daily_report_changed' using errcode='PT409';end if;
 select * into s from public.learn_quickbooks_daily_reports where connection_id=r.connection_id for share;
 select * into c from public.learn_quickbooks_connections where id=r.connection_id and tenant_id=r.tenant_id
  and access_expires_at>clock_timestamp()+interval '2 minutes' for share;
 if not found or c.confirmed_at<>s.confirmed_at or c.refresh_lease is not null then
  raise exception 'daily_report_credential_unavailable' using errcode='55000';end if;
 insert into public.learn_quickbooks_report_requests(id,tenant_id,connection_id,actor_id,environment,
  realm_id,connection_revision,token_generation,report_kind,period_start,period_end,
  accounting_method,reason,daily_run_id)
 values(p,r.tenant_id,c.id,s.approved_by,s.environment,s.realm_id,c.revision,c.token_generation,
  'ProfitAndLoss',s.period_start,r.report_date,'Accrual',s.reason,p_run);
 insert into public.learn_quickbooks_report_requests(id,tenant_id,connection_id,actor_id,environment,
  realm_id,connection_revision,token_generation,report_kind,report_date,aging_method,reason,daily_run_id)
 values(a,r.tenant_id,c.id,s.approved_by,s.environment,s.realm_id,c.revision,c.token_generation,
  'AgedReceivables',r.report_date,'Report_Date',s.reason,p_run);
 update public.learn_quickbooks_daily_report_runs set state='prepared',pnl_request_id=p,
  ar_request_id=a where id=p_run;
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(r.tenant_id,s.approved_by,'report.daily_prepared',jsonb_build_object('run_id',p_run,
  'pnl_request_id',p,'ar_request_id',a,'report_date',r.report_date),s.reason);
 return jsonb_build_object('runId',p_run,'tenantId',r.tenant_id,'connectionId',c.id,
  'realmId',s.realm_id,'environment',s.environment,'periodStart',s.period_start,
  'reportDate',r.report_date,'pnlRequestId',p,'arRequestId',a,'reason',s.reason);
end $$;

-- Gate scheduled requests at claim and during provider GET. Manual requests
-- retain the original authority path and behavior.
create or replace function public.learn_quickbooks_report_current(p_request uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_report_requests%rowtype;begin
 if auth.role() is distinct from 'service_role' then return false;end if;
 select * into r from public.learn_quickbooks_report_requests where id=p_request and state='claimed'
  and claimed_at>clock_timestamp()-interval '2 minutes';
 if not found or (r.daily_run_id is not null and not public.learn_quickbooks_daily_report_current(r.daily_run_id)) then return false;end if;
 perform public.learn_quickbooks_actor_access(r.tenant_id,r.actor_id);
 return exists(select 1 from public.learn_quickbooks_connections c where c.id=r.connection_id
  and c.tenant_id=r.tenant_id and c.environment=r.environment and c.realm_id=r.realm_id
  and c.revision=r.connection_revision and c.token_generation=r.token_generation
  and c.status in ('active','paused') and c.confirmed_at is not null);
exception when sqlstate '42501' then return false;
end $$;
create or replace function public.learn_quickbooks_report_acquire(p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_report_requests%rowtype;c public.learn_quickbooks_connections%rowtype;pair jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'report_forbidden' using errcode='42501';end if;
 select * into r from public.learn_quickbooks_report_requests where id=p_request for update;
 if not found or r.state<>'prepared' or r.created_at<clock_timestamp()-interval '5 minutes'
  or (r.daily_run_id is not null and not public.learn_quickbooks_daily_report_current(r.daily_run_id)) then
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

create function public.learn_quickbooks_daily_report_finish(p_run uuid,p_code text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_daily_report_runs%rowtype;s public.learn_quickbooks_daily_reports%rowtype;
 complete_pair boolean;
begin
 if auth.role() is distinct from 'service_role' or p_code is not null and p_code not in
  ('scope_changed','authentication_required','provider_unavailable','response_invalid','capture_unconfirmed') then
  raise exception 'daily_report_invalid' using errcode='22023';end if;
 select * into r from public.learn_quickbooks_daily_report_runs where id=p_run for update;
 if not found or r.state not in ('claimed','prepared') then raise exception 'daily_report_changed' using errcode='PT409';end if;
 select * into s from public.learn_quickbooks_daily_reports where connection_id=r.connection_id;
 select coalesce(bool_and(q.state='complete' and x.validation_state='verified'),false)
  into complete_pair from public.learn_quickbooks_report_requests q
  left join public.learn_quickbooks_report_receipts x on x.request_id=q.id
  where q.id in (r.pnl_request_id,r.ar_request_id) and q.daily_run_id=p_run;
 complete_pair:=complete_pair and (select count(*)=2 from public.learn_quickbooks_report_requests q
  where q.id in (r.pnl_request_id,r.ar_request_id) and q.daily_run_id=p_run);
 if p_code is null and not complete_pair then p_code:='capture_unconfirmed';end if;
 update public.learn_quickbooks_daily_report_runs set state=case when p_code is null then 'complete' else 'held' end,
  outcome_code=p_code,finished_at=clock_timestamp() where id=p_run;
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(r.tenant_id,s.approved_by,case when p_code is null then 'report.daily_completed' else 'report.daily_held' end,
  jsonb_build_object('run_id',p_run,'report_date',r.report_date,'code',p_code),s.reason);
 return jsonb_build_object('state',case when p_code is null then 'complete' else 'held' end,'code',p_code);
end $$;

revoke all on function public.learn_quickbooks_daily_report_control(uuid,uuid,bigint,boolean,date,text,text),
 public.learn_quickbooks_daily_report_status(uuid),
 public.learn_quickbooks_daily_report_current(uuid),public.learn_quickbooks_daily_report_claim(),
 public.learn_quickbooks_daily_refresh_acquire(uuid),
 public.learn_quickbooks_daily_refresh_finish(uuid,uuid,bigint,bigint,jsonb),
 public.learn_quickbooks_daily_report_prepare(uuid),public.learn_quickbooks_daily_report_finish(uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_daily_report_control(uuid,uuid,bigint,boolean,date,text,text) to authenticated;
grant execute on function public.learn_quickbooks_daily_report_status(uuid) to authenticated;
grant execute on function public.learn_quickbooks_daily_report_current(uuid),public.learn_quickbooks_daily_report_claim(),
 public.learn_quickbooks_daily_refresh_acquire(uuid),
 public.learn_quickbooks_daily_refresh_finish(uuid,uuid,bigint,bigint,jsonb),
 public.learn_quickbooks_daily_report_prepare(uuid),public.learn_quickbooks_daily_report_finish(uuid,text)
 to service_role;
commit;
