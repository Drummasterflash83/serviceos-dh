/** Rollback-only LIVE scope rehearsal. No provider request or lasting policy. */
import { readFileSync } from 'node:fs';
import { savedCliToken } from './learn-test-readiness.mjs';

const PROJECT = 'tgbnakbxwcqjeimygroz';
const TENANT = '00000000-0000-0000-0000-000000000001';
const CONNECTION = '04d68333-fc13-42c2-a500-789f386f015c';
const source = readFileSync(new URL('../../supabase/migrations/20261112170000_new_dawn_daily_quickbooks_reports.sql', import.meta.url), 'utf8');
if (!/^--[^\n]*\n[\s\S]*\nbegin;\n/i.test(source) || !/\ncommit;\s*$/i.test(source))
  throw Error('migration_wrapper_changed');
const body = source.replace(/\nbegin;\n/i, '\n').replace(/\ncommit;\s*$/i, '\n');

export function rehearsalSql() {
  return `begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
do $baseline$
begin
 if to_regclass('public.learn_quickbooks_daily_reports') is not null then
  raise exception 'fixture_policy_already_installed';end if;
 if not exists(select 1 from public.learn_quickbooks_connections
  where id='${CONNECTION}'::uuid and tenant_id='${TENANT}'::uuid
   and environment='production' and realm_id='1197397945' and confirmed_at is not null
   and token_secret_id is not null and status in ('active','paused')) then
  raise exception 'fixture_connection_changed';end if;
end $baseline$;
${body}
do $fixture$
declare actor uuid; policy jsonb; status jsonb; claimed jsonb; run_id uuid;
begin
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
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 status:=public.learn_quickbooks_daily_report_status('${TENANT}'::uuid);
 if status->>'enabled' is distinct from 'false' or status->>'revision' is distinct from '0' then
  raise exception 'fixture_status_initial_invalid';end if;
 policy:=public.learn_quickbooks_daily_report_control('${TENANT}'::uuid,
  '${CONNECTION}'::uuid,0,true,'2026-04-01'::date,
  'Chris standing read-only FY27 report approval 2026-10-21',
  'Rollback-only LIVE authority and scope rehearsal; no provider request');
 if policy->>'enabled' is distinct from 'true' or policy->>'revision' is distinct from '1' then
  raise exception 'fixture_control_enable_failed';end if;
 perform set_config('request.jwt.claim.role','service_role',true);
 claimed:=public.learn_quickbooks_daily_report_claim();
 if claimed is null or claimed->>'tenantId' is distinct from '${TENANT}'
  or claimed->>'connectionId' is distinct from '${CONNECTION}' then
  raise exception 'fixture_claim_scope_failed';end if;
 run_id:=(claimed->>'runId')::uuid;
 if not public.learn_quickbooks_daily_report_current(run_id) then
  raise exception 'fixture_run_authority_failed';end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 policy:=public.learn_quickbooks_daily_report_control('${TENANT}'::uuid,
  '${CONNECTION}'::uuid,1,false,'2026-04-01'::date,
  'Chris standing read-only FY27 report approval 2026-10-21',
  'Rollback-only policy revocation and in-flight fencing rehearsal');
 if policy->>'enabled' is distinct from 'false' or policy->>'revision' is distinct from '2' then
  raise exception 'fixture_control_disable_failed';end if;
 perform set_config('request.jwt.claim.role','service_role',true);
 if public.learn_quickbooks_daily_report_current(run_id) then
  raise exception 'fixture_revocation_failed';end if;
 if has_function_privilege('anon','public.learn_quickbooks_daily_report_claim()','EXECUTE')
  or has_function_privilege('authenticated','public.learn_quickbooks_daily_report_claim()','EXECUTE')
  or not has_function_privilege('service_role','public.learn_quickbooks_daily_report_claim()','EXECUTE')
  or has_table_privilege('authenticated','public.learn_quickbooks_daily_reports','SELECT') then
  raise exception 'fixture_grant_boundary_failed';end if;
end $fixture$;
select 'new-dawn-daily-qbo-live-rehearsal/1' as marker;
rollback;`;
}

export async function rehearse(fetcher = fetch, token = savedCliToken()) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: rehearsalSql() }), redirect: 'error', signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const message = String(problem?.message ?? problem?.error ?? '');
    const fixture = message.match(/fixture_[a-z_]+/)?.[0] ?? 'sql_error';
    const state = message.match(/\b[0-9A-Z]{5}\b/)?.[0] ?? 'unknown';
    throw Error(`LIVE rollback daily QBO rehearsal failed (HTTP ${response.status}, SQLSTATE ${state}, ${fixture})`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.marker !== 'new-dawn-daily-qbo-live-rehearsal/1')
    throw Error('LIVE rollback daily QBO rehearsal receipt missing');
  return { state: 'passed_rolled_back', project: PROJECT, providerRequests: 0,
    persistentPolicy: false, privateValuesReturned: false };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try { console.log(JSON.stringify(await rehearse())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
