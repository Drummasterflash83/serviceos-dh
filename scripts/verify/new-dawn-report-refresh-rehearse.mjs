/** Rollback-only TEST authorization rehearsal. No OAuth or accounting request. */
import { readFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
export function rehearsalSql() {
  const migration = readFileSync(new URL('../../supabase/migrations/20261107120000_new_dawn_quickbooks_report_refresh_authorize.sql', import.meta.url), 'utf8');
  if (!/^begin;\n/i.test(migration) || !/\ncommit;\s*$/i.test(migration)) throw Error('Migration wrapper changed');
  const body = migration.replace(/^begin;\n/i, '').replace(/\ncommit;\s*$/i, '\n');
  return `begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
${body}
do $fixture$
declare c public.learn_quickbooks_connections%rowtype;actor uuid;ordinary uuid;tenant uuid;r jsonb;
 req uuid:='debbbbbb-0000-4000-8000-000000000001';before_events bigint;
begin
 select id into tenant from public.tenants where status='active' order by id limit 1;
 if tenant is null then raise exception 'fixture_tenant_missing';end if;
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
 perform public.learn_quickbooks_actor_access(tenant,actor);
 insert into public.learn_quickbooks_apps(id,environment,client_id,redirect_uri,client_secret_id)
 values('debbbbbb-0000-4000-8000-000000000002','sandbox','synthetic-report-refresh-rehearsal',
  'https://example.invalid/quickbooks/callback','debbbbbb-0000-4000-8000-000000000003');
 insert into public.learn_quickbooks_connections(id,tenant_id,environment,app_id,realm_id,status,
  created_by,confirmed_at,confirmed_by)
 values('debbbbbb-0000-4000-8000-000000000004',tenant,'sandbox',
  'debbbbbb-0000-4000-8000-000000000002','123456789','paused',actor,clock_timestamp(),actor)
 returning * into c;
 select count(*) into before_events from public.learn_quickbooks_finance_events;
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 r:=public.learn_quickbooks_report_refresh_authorize(c.tenant_id,c.id,req,c.realm_id,c.environment,'Synthetic report refresh review');
 if r->>'requestId' is distinct from req::text or r->>'connectionId' is distinct from c.id::text
  or r->>'realmId' is distinct from c.realm_id or r->>'environment' is distinct from c.environment
  or (select count(*) from public.learn_quickbooks_finance_events)<>before_events+1
  or not exists(select 1 from public.learn_quickbooks_finance_events where actor_id=actor
   and event='report.refresh_requested' and detail->>'request_id'=req::text) then
  raise exception 'fixture_operator_authorization_failed';end if;
 begin
  perform public.learn_quickbooks_report_refresh_authorize(c.tenant_id,c.id,gen_random_uuid(),'999999',c.environment,'Wrong company review');
  raise exception 'fixture_wrong_realm_allowed';
 exception when sqlstate '42501' then null;end;
 select p.id into ordinary from public.profiles p join auth.users u on u.id=p.id
  where u.deleted_at is null and not exists(select 1 from public.platform_authority_grants g
   where g.profile_id=p.id and g.permission='platform.controlplane.admin'
    and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
    and coalesce(g.effective_to,'infinity')>clock_timestamp())
  order by p.id limit 1;
 if ordinary is null then raise exception 'fixture_ordinary_actor_missing';end if;
 perform set_config('request.jwt.claim.sub',ordinary::text,true);
 begin
  perform public.learn_quickbooks_report_refresh_authorize(c.tenant_id,c.id,gen_random_uuid(),c.realm_id,c.environment,'Ordinary user denial');
  raise exception 'fixture_ordinary_allowed';
 exception when sqlstate '42501' then null;end;
 if has_function_privilege('anon','public.learn_quickbooks_report_refresh_authorize(uuid,uuid,uuid,text,text,text)','EXECUTE')
  or has_function_privilege('service_role','public.learn_quickbooks_report_refresh_authorize(uuid,uuid,uuid,text,text,text)','EXECUTE')
  or not has_function_privilege('authenticated','public.learn_quickbooks_report_refresh_authorize(uuid,uuid,uuid,text,text,text)','EXECUTE') then
  raise exception 'fixture_grant_boundary_failed';end if;
end $fixture$;
select 'new-dawn-report-refresh/1' as marker;
rollback;`;
}
export async function rehearse(fetcher = fetch, token = savedCliToken()) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`, {
    method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body:JSON.stringify({query:rehearsalSql(),read_only:false}), redirect:'error', signal:AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const code = typeof problem?.code === 'string' && /^[A-Z0-9]{5}$/.test(problem.code) ? problem.code : 'unknown';
    const message = typeof problem?.message === 'string' ? problem.message.slice(0,160).replaceAll(/[^A-Za-z0-9 _.:+-]/g,'?') : 'redacted';
    throw Error(`TEST rollback refresh authorization rehearsal HTTP ${response.status}, SQLSTATE ${code}, ${message}`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length!==1 || rows[0]?.marker!=='new-dawn-report-refresh/1')
    throw Error('TEST rollback refresh authorization receipt missing');
  return {state:'passed_rolled_back',project:TEST_PROJECT,providerRequests:0,secretsReturned:false};
}
if (process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href) {
  try { console.log(JSON.stringify(await rehearse())); }
  catch(error) { console.error(error.message); process.exitCode=1; }
}
