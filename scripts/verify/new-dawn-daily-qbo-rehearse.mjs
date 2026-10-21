/** Rollback-only TEST SQL rehearsal. No QuickBooks call, token read or lasting installation. */
import { readFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

export function rehearsalSql() {
  const prerequisite = readFileSync(new URL('../../supabase/migrations/20261106110000_new_dawn_quickbooks_report_capture.sql', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../../supabase/migrations/20261112170000_new_dawn_daily_quickbooks_reports.sql', import.meta.url), 'utf8');
  if (![prerequisite, source].every(sql => /\nbegin;\n/i.test(sql) && /\ncommit;\s*$/i.test(sql)))
    throw Error('migration_wrapper_changed');
  const unwrap = sql => sql.replace(/\nbegin;\n/i, '\n').replace(/\ncommit;\s*$/i, '\n');
  const body = unwrap(prerequisite) + '\n' + unwrap(source);
  return `begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
${body}
do $fixture$
declare c public.learn_quickbooks_connections%rowtype;a public.learn_quickbooks_apps%rowtype;
 actor uuid;r uuid:='deab0000-0000-4000-8000-000000000001';
 synthetic_tenant uuid; synthetic_app uuid:='deab0000-0000-4000-8000-000000000010';
 synthetic_connection uuid:='deab0000-0000-4000-8000-000000000011';
 scheduled uuid:='deab0000-0000-4000-8000-000000000002';
 manual uuid:='deab0000-0000-4000-8000-000000000003';
begin
 select id into synthetic_tenant from public.tenants where status='active' order by id limit 1;
 if synthetic_tenant is null then raise exception 'fixture_active_tenant_missing';end if;
 select g.profile_id into actor from public.platform_authority_grants g
  join public.profiles p on p.id=g.profile_id join auth.users u on u.id=p.id
  where g.permission='platform.controlplane.admin'
   and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
   and coalesce(g.effective_to,'infinity')>clock_timestamp()
   and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
   and not exists(select 1 from public.view_as_context x where x.actor_user_id=g.profile_id
    and x.ended_at is null and (x.expires_at is null or x.expires_at>clock_timestamp()))
  order by g.profile_id limit 1;
 if actor is null then raise exception 'fixture_operator_missing';end if;
 insert into public.learn_quickbooks_apps(id,environment,client_id,redirect_uri,client_secret_id)
 values(synthetic_app,'production','syntheticdailyreport','https://test.openfolk.ai/quickbooks/callback',gen_random_uuid())
 returning * into a;
 insert into public.learn_quickbooks_connections(id,tenant_id,environment,app_id,realm_id,status,
  token_secret_id,confirmed_at,created_by)
 values(synthetic_connection,synthetic_tenant,'production',a.id,'93939393939393939393','paused',
  gen_random_uuid(),clock_timestamp(),actor) returning * into c;
 perform public.learn_quickbooks_actor_access(c.tenant_id,actor);
 update public.feature_flags set value='true'::jsonb where tenant_id=c.tenant_id and flag='learn.enabled';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(c.tenant_id,'learn.enabled','true'::jsonb);end if;
 update public.feature_flags set value='true'::jsonb where tenant_id=c.tenant_id and flag='learn.inputs.quickbooks.enabled';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(c.tenant_id,'learn.inputs.quickbooks.enabled','true'::jsonb);end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 if public.learn_quickbooks_daily_report_control(c.tenant_id,c.id,0,true,'2026-04-01',
  'Synthetic rollback approval','Synthetic rollback only FY27 reports')->>'enabled'<>'true' then
  raise exception 'fixture_control_enable_failed';end if;
 insert into public.learn_quickbooks_daily_report_runs(id,connection_id,tenant_id,report_date,schedule_revision,state)
 values(r,c.id,c.tenant_id,current_date-1,1,'claimed');
 perform set_config('request.jwt.claim.role','service_role',true);
 if not public.learn_quickbooks_daily_report_current(r) then raise exception 'fixture_current_policy_failed';end if;
 insert into public.learn_quickbooks_report_requests(id,tenant_id,connection_id,actor_id,
  environment,realm_id,connection_revision,token_generation,report_kind,period_start,
  period_end,accounting_method,reason,daily_run_id,state,claimed_at)
 values(scheduled,c.tenant_id,c.id,actor,c.environment,c.realm_id,c.revision,c.token_generation,
  'ProfitAndLoss','2026-04-01',current_date-1,'Accrual','Synthetic scheduled report check',r,
  'claimed',clock_timestamp());
 insert into public.learn_quickbooks_report_requests(id,tenant_id,connection_id,actor_id,
  environment,realm_id,connection_revision,token_generation,report_kind,period_start,
  period_end,accounting_method,reason,state,claimed_at)
 values(manual,c.tenant_id,c.id,actor,c.environment,c.realm_id,c.revision,c.token_generation,
  'ProfitAndLoss','2026-04-01',current_date-1,'Accrual','Synthetic manual report check',
  'claimed',clock_timestamp());
 if not public.learn_quickbooks_report_current(scheduled)
  or not public.learn_quickbooks_report_current(manual) then raise exception 'fixture_prior_contract_failed';end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 if public.learn_quickbooks_daily_report_control(c.tenant_id,c.id,1,false,'2026-04-01',
  'Synthetic rollback revoke','Synthetic rollback policy withdrawal')->>'enabled'<>'false' then
  raise exception 'fixture_control_disable_failed';end if;
 perform set_config('request.jwt.claim.role','service_role',true);
 if public.learn_quickbooks_daily_report_current(r) or public.learn_quickbooks_report_current(scheduled)
  or not public.learn_quickbooks_report_current(manual) then raise exception 'fixture_revocation_failed';end if;
 update public.learn_quickbooks_report_requests set state='prepared' where id=scheduled;
 begin
  perform public.learn_quickbooks_report_acquire(scheduled);
  raise exception 'fixture_revoked_acquire_allowed';
 exception when sqlstate '42501' then null;end;
 if has_table_privilege('anon','public.learn_quickbooks_daily_reports','SELECT')
  or has_table_privilege('authenticated','public.learn_quickbooks_daily_report_runs','SELECT')
  or has_function_privilege('anon','public.learn_quickbooks_daily_report_claim()','EXECUTE')
  or has_function_privilege('authenticated','public.learn_quickbooks_daily_report_claim()','EXECUTE')
  or not has_function_privilege('service_role','public.learn_quickbooks_daily_report_claim()','EXECUTE')
  or not has_function_privilege('authenticated','public.learn_quickbooks_report_start(uuid,uuid,uuid,text,text,text,date,date,text,date,text,text)','EXECUTE')
  or has_function_privilege('service_role','public.learn_quickbooks_report_start(uuid,uuid,uuid,text,text,text,date,date,text,date,text,text)','EXECUTE')
  or not has_function_privilege('service_role','public.learn_quickbooks_report_acquire(uuid)','EXECUTE') then
  raise exception 'fixture_grant_boundary_failed';end if;
end $fixture$;
select 'new-dawn-daily-qbo-rehearsal/1' as marker;
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
    const message = String(problem?.message ?? problem?.error ?? '');
    const state = message.match(/\b(?:[0-9A-Z]{5})\b/)?.[0] ?? code;
    const fixture = message.match(/fixture_[a-z_]+/)?.[0] ?? 'sql_error';
    throw Error(`TEST rollback daily QBO rehearsal failed (HTTP ${response.status}, SQLSTATE ${state}, ${fixture})`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.marker !== 'new-dawn-daily-qbo-rehearsal/1')
    throw Error('TEST rollback daily QBO rehearsal receipt missing');
  return { state:'passed_rolled_back', project:TEST_PROJECT, providerRequests:0,
    syntheticDailyRuns:1, privateValuesReturned:false };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try { console.log(JSON.stringify(await rehearse())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
