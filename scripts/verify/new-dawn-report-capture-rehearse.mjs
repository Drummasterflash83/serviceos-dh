/** Rollback-only hosted TEST rehearsal. Synthetic report responses; no provider GET. */
import { readFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

export function rehearsalSql() {
  const migration = readFileSync(new URL('../../supabase/migrations/20261106110000_new_dawn_quickbooks_report_capture.sql', import.meta.url), 'utf8');
  if (!/\nbegin;\n/i.test(migration) || !/\ncommit;\s*$/i.test(migration)) throw Error('Migration wrapper changed');
  const body = migration.replace(/\nbegin;\n/i, '\n').replace(/\ncommit;\s*$/i, '\n');
  return `begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
${body}
do $fixture$
declare c public.learn_quickbooks_connections%rowtype;actor uuid;ordinary_actor uuid;r jsonb;
 p_id uuid:='deaaaaaa-0000-4000-8000-000000000001';
 a_id uuid:='deaaaaaa-0000-4000-8000-000000000002';
 d_id uuid:='deaaaaaa-0000-4000-8000-000000000003';
 h_id uuid:='deaaaaaa-0000-4000-8000-000000000004';
 s_id uuid:='deaaaaaa-0000-4000-8000-000000000005';
begin
 select c0.* into c from public.learn_quickbooks_connections c0
  join public.tenants t on t.id=c0.tenant_id and t.status='active'
  where c0.realm_id is not null order by c0.id limit 1;
 if c.id is null then raise exception 'fixture_connection_missing';end if;
 select g.profile_id into actor from public.platform_authority_grants g
  join public.profiles p on p.id=g.profile_id join auth.users u on u.id=p.id
  where g.permission='platform.controlplane.admin'
   and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
   and coalesce(g.effective_to,'infinity')>clock_timestamp()
   and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
   and not exists(select 1 from public.view_as_context x where x.actor_user_id=g.profile_id
    and x.ended_at is null and (x.expires_at is null or x.expires_at>clock_timestamp()))
  order by g.profile_id limit 1;
 if actor is null then raise exception 'fixture_actor_missing';end if;
 perform public.learn_quickbooks_actor_access(c.tenant_id,actor);
 update public.learn_quickbooks_connections set status='paused',confirmed_at=clock_timestamp() where id=c.id;
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 r:=public.learn_quickbooks_report_start(c.tenant_id,c.id,s_id,c.realm_id,c.environment,
  'ProfitAndLoss','2026-09-01','2026-09-30','Accrual',null,null,'Synthetic operator start');
 if r->>'state'<>'prepared' or not exists(select 1 from public.learn_quickbooks_report_requests
  where id=s_id and state='prepared' and actor_id=actor) then raise exception 'fixture_operator_start_failed';end if;
 insert into public.learn_quickbooks_report_requests(id,tenant_id,connection_id,actor_id,
  environment,realm_id,connection_revision,token_generation,report_kind,period_start,period_end,
  accounting_method,reason,state,claimed_at)
 values(p_id,c.tenant_id,c.id,actor,c.environment,c.realm_id,c.revision,c.token_generation,
  'ProfitAndLoss','2026-09-01','2026-09-30','Accrual','Synthetic rollback report check','claimed',clock_timestamp());
 insert into public.learn_quickbooks_report_requests(id,tenant_id,connection_id,actor_id,
  environment,realm_id,connection_revision,token_generation,report_kind,report_date,
  aging_method,reason,state,claimed_at)
 values(a_id,c.tenant_id,c.id,actor,c.environment,c.realm_id,c.revision,c.token_generation,
  'AgedReceivables','2026-10-19','Report_Date','Synthetic rollback report check','claimed',clock_timestamp());
 insert into public.learn_quickbooks_report_requests(id,tenant_id,connection_id,actor_id,
  environment,realm_id,connection_revision,token_generation,report_kind,period_start,period_end,
  accounting_method,reason,state,claimed_at)
 values(h_id,c.tenant_id,c.id,actor,c.environment,c.realm_id,c.revision,c.token_generation,
  'ProfitAndLoss','2026-09-01','2026-09-30','Accrual','Synthetic held report check','claimed',clock_timestamp());
 perform set_config('request.jwt.claim.role','service_role',true);
 r:=public.learn_quickbooks_report_finish(p_id,
  '{"Header":{"ReportName":"ProfitAndLoss","StartPeriod":"2026-09-01","EndPeriod":"2026-09-30","ReportBasis":"Accrual","Currency":"GBP","Time":"2026-10-19T10:00:00Z"},"Rows":{"Row":[{"ColData":[{"value":12345678901234567890.01}]}]}}');
 if r->>'kind'<>'ProfitAndLoss' or r->>'audit_id' is null
  or r->>'response_sha256' is null then raise exception 'fixture_profit_receipt_failed';end if;
 r:=public.learn_quickbooks_report_finish(a_id,
  '{"Header":{"ReportName":"AgedReceivables","Option":[{"Name":"report_date","Value":"2026-10-19"}],"Currency":"GBP","Time":"2026-10-19T10:00:00Z"},"Rows":{"Row":[]}}');
 if r->>'kind'<>'AgedReceivables' or r->>'audit_id' is null then raise exception 'fixture_aging_receipt_failed';end if;
 r:=public.learn_quickbooks_report_finish(h_id,
  '{"Header":{"ReportName":"BalanceSheet","Currency":"GBP"},"Rows":{"Row":[]}}');
 if r->>'validation_state'<>'held' or r->>'validation_code'<>'report_name_mismatch'
  or not exists(select 1 from public.learn_quickbooks_report_requests where id=h_id and state='held')
  or not exists(select 1 from public.learn_quickbooks_finance_events
   where id=(r->>'audit_id')::uuid and event='report.capture_held') then
  raise exception 'fixture_held_receipt_failed';end if;
 if (select count(*) from public.learn_quickbooks_report_receipts where request_id in(p_id,a_id,h_id))<>3
  or (select count(*) from public.learn_quickbooks_report_requests where id in(p_id,a_id) and state='complete')<>2
  or (select count(*) from public.learn_quickbooks_finance_events where event='report.capture_completed'
   and detail->>'request_id' in(p_id::text,a_id::text))<>2 then
  raise exception 'fixture_report_contract_failed';end if;
 begin
  update public.learn_quickbooks_report_receipts set raw_response='{}' where request_id=p_id;
  raise exception 'fixture_immutable_missing';
 exception when sqlstate '55000' then
  if sqlerrm<>'learn_operator_history_immutable' then raise;end if;
 end;
 if has_table_privilege('anon','public.learn_quickbooks_report_receipts','SELECT')
  or has_table_privilege('authenticated','public.learn_quickbooks_report_receipts','SELECT')
  or has_function_privilege('anon','public.learn_quickbooks_report_start(uuid,uuid,uuid,text,text,text,date,date,text,date,text,text)','EXECUTE')
  or has_function_privilege('authenticated','public.learn_quickbooks_report_finish(uuid,text)','EXECUTE') then
  raise exception 'fixture_grant_boundary_failed';end if;
 select p.id into ordinary_actor from public.profiles p join auth.users u on u.id=p.id
 where u.deleted_at is null and not exists(select 1 from public.platform_authority_grants g
  where g.profile_id=p.id and g.permission='platform.controlplane.admin'
   and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
   and coalesce(g.effective_to,'infinity')>clock_timestamp())
 order by p.id limit 1;
 if ordinary_actor is null then raise exception 'fixture_ordinary_actor_missing';end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',ordinary_actor::text,true);
 begin
  perform public.learn_quickbooks_report_start(c.tenant_id,c.id,d_id,c.realm_id,c.environment,'ProfitAndLoss',
   '2026-09-01','2026-09-30','Accrual',null,null,'Synthetic ordinary-user denial');
  raise exception 'fixture_ordinary_start_allowed';
 exception when sqlstate '42501' then null;end;
 begin
  perform public.learn_quickbooks_report_result(p_id);
  raise exception 'fixture_ordinary_result_allowed';
 exception when sqlstate '42501' then null;end;
end $fixture$;
select 'new-dawn-report-capture/1' as marker;
rollback;`;
}

export async function rehearse(fetcher = fetch, token = savedCliToken()) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: rehearsalSql() }), redirect: 'error', signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const code = typeof problem?.code === 'string' && /^[A-Z0-9]{5}$/.test(problem.code) ? problem.code : 'unknown';
    throw Error(`TEST rollback report rehearsal failed (HTTP ${response.status}, SQLSTATE ${code})`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.marker !== 'new-dawn-report-capture/1')
    throw Error('TEST rollback report rehearsal receipt missing');
  return { state:'passed_rolled_back', project:TEST_PROJECT, providerRequests:0,
    syntheticReports:3, privateValuesReturned:false };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try { console.log(JSON.stringify(await rehearse())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
