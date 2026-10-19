/** Rollback-only hosted TEST contract for the saved-report summary. No provider GET. */
import { readFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

export function rehearsalSql() {
  const capture = readFileSync(new URL('../../supabase/migrations/20261106110000_new_dawn_quickbooks_report_capture.sql', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../../supabase/migrations/20261106140000_new_dawn_quickbooks_report_summary_preview.sql', import.meta.url), 'utf8');
  if (!/\nbegin;\n/i.test(capture) || !/\ncommit;\s*$/i.test(capture) ||
    !/\nbegin;\n/i.test(migration) || !/\ncommit;\s*$/i.test(migration)) throw Error('Migration wrapper changed');
  const captureBody = capture.replace(/\nbegin;\n/i, '\n').replace(/\ncommit;\s*$/i, '\n');
  const body = migration.replace(/\nbegin;\n/i, '\n').replace(/\ncommit;\s*$/i, '\n');
  return `begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
${captureBody}
${body}
do $fixture$
declare c public.learn_quickbooks_connections%rowtype;actor uuid;ordinary_actor uuid;got jsonb;
 p_id uuid:='debbbbbb-0000-4000-8000-000000000001';
 a_id uuid:='debbbbbb-0000-4000-8000-000000000002';
 profit jsonb:='{"Header":{"ReportName":"ProfitAndLoss","StartPeriod":"2026-09-01","EndPeriod":"2026-09-30","ReportBasis":"Accrual","Currency":"GBP"},"Columns":{"Column":[{"ColType":"Account"},{"ColType":"Money"}]},"Rows":{"Row":[{"type":"Section","group":"GrossProfit","Summary":{"ColData":[{"value":"Gross Profit"},{"value":"250.00"}]}},{"type":"Section","group":"NetIncome","Summary":{"ColData":[{"value":"Net Income"},{"value":"100.00"}]}}]}}'::jsonb;
 aging jsonb:='{"Header":{"ReportName":"AgedReceivables","Currency":"GBP","Option":[{"Name":"report_date","Value":"2026-09-30"}]},"Columns":{"Column":[{"ColType":"Customer"},{"ColType":"Money","ColTitle":"Current"},{"ColType":"Money","ColTitle":"1 - 30"},{"ColType":"Money","ColTitle":"31 - 60"},{"ColType":"Money","ColTitle":"61 - 90"},{"ColType":"Money","ColTitle":"91 and over"},{"ColType":"Money","ColTitle":"Total"}]},"Rows":{"Row":[{"type":"Section","group":"GrandTotal","Summary":{"ColData":[{"value":"TOTAL"},{"value":"50.00"},{"value":"20.00"},{"value":"15.00"},{"value":"10.00"},{"value":"5.00"},{"value":"100.00"}]}}]}}'::jsonb;
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
 got:=public.learn_quickbooks_report_summary_extract(profit,aging);
 if got->>'accounts_gross_profit'<>'250.00' or got->>'net_profit'<>'100.00'
  or got->>'ar_total'<>'100.00' then raise exception 'fixture_extract_failed';end if;
 begin
  perform public.learn_quickbooks_report_summary_extract(
   jsonb_set(profit,'{Rows,Row,1,group}','"GrossProfit"'::jsonb),aging);
  raise exception 'fixture_duplicate_allowed';
 exception when sqlstate '22023' then if sqlerrm<>'report_summary_shape_held' then raise;end if;end;
 begin
  perform public.learn_quickbooks_report_summary_extract(profit,
   jsonb_set(aging,'{Rows,Row,0,Summary,ColData,6,value}','"100.01"'::jsonb));
  raise exception 'fixture_unbalanced_allowed';
 exception when sqlstate '22023' then if sqlerrm<>'report_summary_total_held' then raise;end if;end;
 begin
  perform public.learn_quickbooks_report_summary_extract(profit,
   jsonb_set(aging,'{Columns,Column,1,ColTitle}','"Total"'::jsonb));
  raise exception 'fixture_reordered_allowed';
 exception when sqlstate '22023' then if sqlerrm<>'report_summary_shape_held' then raise;end if;end;
 begin
  perform public.learn_quickbooks_report_summary_extract(
   profit#-'{Header,Currency}',aging#-'{Header,Currency}');
  raise exception 'fixture_missing_currency_allowed';
 exception when sqlstate '22023' then if sqlerrm<>'report_summary_shape_held' then raise;end if;end;
 if has_function_privilege('anon','public.learn_quickbooks_report_summary_extract(jsonb,jsonb)','EXECUTE')
  or has_function_privilege('authenticated','public.learn_quickbooks_report_summary_extract(jsonb,jsonb)','EXECUTE')
  or has_function_privilege('anon','public.learn_quickbooks_report_summary_preview(uuid,uuid,uuid,text)','EXECUTE') then
  raise exception 'fixture_grant_boundary_failed';end if;
 insert into public.learn_quickbooks_report_requests(id,tenant_id,connection_id,actor_id,
  environment,realm_id,connection_revision,token_generation,report_kind,
  period_start,period_end,accounting_method,reason,state)
 values(p_id,c.tenant_id,c.id,actor,c.environment,c.realm_id,c.revision,c.token_generation,
  'ProfitAndLoss','2026-09-01','2026-09-30','Accrual','Synthetic rollback preview','complete');
 insert into public.learn_quickbooks_report_requests(id,tenant_id,connection_id,actor_id,
  environment,realm_id,connection_revision,token_generation,report_kind,
  report_date,aging_method,reason,state)
 values(a_id,c.tenant_id,c.id,actor,c.environment,c.realm_id,c.revision,c.token_generation,
  'AgedReceivables','2026-09-30','Report_Date','Synthetic rollback preview','complete');
 insert into public.learn_quickbooks_report_receipts(request_id,tenant_id,report_kind,
  raw_response,response_sha256,header,validation_state)
 values(p_id,c.tenant_id,'ProfitAndLoss',profit::text,repeat('a',64),profit->'Header','verified'),
  (a_id,c.tenant_id,'AgedReceivables',aging::text,repeat('b',64),aging->'Header','verified');
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin
  perform public.learn_quickbooks_report_summary_preview(c.tenant_id,p_id,a_id,'Synthetic flag denial');
  raise exception 'fixture_flag_off_allowed';
 exception when sqlstate '42501' then if sqlerrm<>'report_summary_disabled' then raise;end if;end;
 update public.feature_flags set value='true'::jsonb where tenant_id=c.tenant_id and flag='new_dawn.report_summary_preview';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(c.tenant_id,'new_dawn.report_summary_preview','true'::jsonb);end if;
 got:=public.learn_quickbooks_report_summary_preview(c.tenant_id,p_id,a_id,'Synthetic operator preview');
 if got->>'audience'<>'openfolk_operator_only' or got->>'realm_id' is distinct from c.realm_id
  or got#>>'{summary,ar_total}'<>'100.00' or got->>'audit_id' is null
  or not exists(select 1 from public.learn_quickbooks_finance_events
   where id=(got->>'audit_id')::uuid and event='report.summary_preview_read') then
  raise exception 'fixture_preview_failed';end if;
 select p.id into ordinary_actor from public.profiles p join auth.users u on u.id=p.id
  where u.deleted_at is null and not exists(select 1 from public.platform_authority_grants g
   where g.profile_id=p.id and g.permission='platform.controlplane.admin'
    and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
    and coalesce(g.effective_to,'infinity')>clock_timestamp()) order by p.id limit 1;
 if ordinary_actor is null then raise exception 'fixture_ordinary_actor_missing';end if;
 perform set_config('request.jwt.claim.sub',ordinary_actor::text,true);
 begin
  perform public.learn_quickbooks_report_summary_preview(c.tenant_id,p_id,a_id,'Synthetic ordinary denial');
  raise exception 'fixture_ordinary_allowed';
 exception when sqlstate '42501' then null;end;
end $fixture$;
select 'new-dawn-report-summary/1' as marker;
rollback;`;
}

export async function rehearse(fetcher = fetch, token = savedCliToken()) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`, {
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:rehearsalSql()}),redirect:'error',signal:AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const code = typeof problem?.code === 'string' && /^[A-Z0-9]{5}$/.test(problem.code) ? problem.code : 'unknown';
    throw Error(`TEST rollback report summary failed (HTTP ${response.status}, SQLSTATE ${code})`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length!==1 || rows[0]?.marker!=='new-dawn-report-summary/1')
    throw Error('TEST rollback report summary receipt missing');
  return {state:'passed_rolled_back',project:TEST_PROJECT,providerRequests:0,syntheticFigures:8};
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try { console.log(JSON.stringify(await rehearse())); }
  catch (error) { console.error(error.message);process.exitCode=1; }
}
