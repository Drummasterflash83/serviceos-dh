/** Rollback-only TEST rehearsal of the invoice-check finish contract.
 * Uses two retained TEST invoice payloads as synthetic GET responses inside SQL.
 * Never calls QuickBooks, prints invoice data, or leaves the fixture installed.
 */
import { readFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const migrationNames = [
  '20261104090000_new_dawn_owner_money.sql',
  '20261106090000_new_dawn_invoice_comparison.sql',
  '20261106100000_new_dawn_invoice_check_finish_ambiguity.sql',
];

export function migrationBody(name) {
  const source = readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
  if (!/^begin;\n/i.test(source.slice(source.indexOf('begin;'))) || !/\ncommit;\s*$/i.test(source))
    throw Error(`Migration transaction wrapper changed: ${name}`);
  return source.replace(/^([\s\S]*?)\bbegin;\n/i, '$1').replace(/\ncommit;\s*$/i, '\n');
}

export function rehearsalSql() {
  return `begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
${migrationNames.map(migrationBody).join('\n')}
do $fixture$
declare c public.learn_quickbooks_connections%rowtype;
 actor uuid; selected uuid[]; raw_responses text[];
 finished jsonb; request_id uuid:='b1c28ee9-0d52-485f-a487-c3f6551df849';
begin
 select c0.* into c from public.learn_quickbooks_connections c0
 where exists(select 1 from public.learn_quickbooks_latest l
  where l.tenant_id=c0.tenant_id and l.environment=c0.environment
   and l.realm_id=c0.realm_id and l.entity='Invoice' and not l.conflicted)
 order by c0.id limit 1;
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
 select array_agg(version_id order by version_id),array_agg(raw_response order by version_id)
 into selected,raw_responses from (
  select l.version_id,jsonb_build_object('Invoice',v.payload)::text raw_response
  from public.learn_quickbooks_latest l
  join public.learn_quickbooks_source_versions v on v.id=l.version_id
  where l.tenant_id=c.tenant_id and l.environment=c.environment and l.realm_id=c.realm_id
   and l.entity='Invoice' and not l.conflicted
   and public.learn_quickbooks_money(v.payload->'Balance') is not null
   and public.learn_quickbooks_strict_date(v.payload->>'DueDate') is not null
   and length(jsonb_build_object('Invoice',v.payload)::text)<=131072
  order by l.version_id limit 2
 ) invoices;
 if cardinality(selected)<>2 then raise exception 'fixture_invoice_pair_missing';end if;
 update public.learn_quickbooks_connections set status='paused',confirmed_at=clock_timestamp()
 where id=c.id;
 insert into public.learn_quickbooks_invoice_checks
  (id,tenant_id,connection_id,actor_id,environment,realm_id,connection_revision,
   token_generation,versions,reason,state,claimed_at)
 values(request_id,c.tenant_id,c.id,actor,c.environment,c.realm_id,c.revision,
  c.token_generation,selected,'Rollback-only TEST finish rehearsal','claimed',clock_timestamp());
 perform set_config('request.jwt.claim.role','service_role',true);
 finished:=public.learn_quickbooks_invoice_check_finish(request_id,raw_responses);
 if finished->>'version'<>'quickbooks-invoice-check/1'
  or finished->>'request_id'<>request_id::text
  or jsonb_array_length(finished->'rows')<>2
  or finished->>'audit_id' is null
  or exists(select 1 from jsonb_array_elements(finished->'rows') x
   where x->>'balance_matches'<>'true' or x->>'due_date_matches'<>'true')
  or not exists(select 1 from public.learn_quickbooks_invoice_checks
   where id=request_id and state='complete' and jsonb_array_length(result)=2)
  or not exists(select 1 from public.learn_quickbooks_finance_events
   where id=(finished->>'audit_id')::uuid and event='invoice.provider_check_completed') then
  raise exception 'fixture_finish_contract_failed';
 end if;
end $fixture$;
select 'new-dawn-invoice-check-finish/1' as marker;
rollback;`;
}

export async function rehearse(fetcher = fetch, token = savedCliToken()) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: rehearsalSql() }), redirect: 'error', signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const code = typeof problem?.code === 'string' && /^[A-Z0-9]{5}$/.test(problem.code)
      ? problem.code : 'unknown';
    throw Error(`TEST rollback rehearsal failed (HTTP ${response.status}, SQLSTATE ${code})`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.marker !== 'new-dawn-invoice-check-finish/1')
    throw Error('TEST rollback rehearsal receipt missing');
  return { state: 'passed_rolled_back', project: TEST_PROJECT, providerRequests: 0,
    fixtureInvoices: 2, privateValuesReturned: false };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try { console.log(JSON.stringify(await rehearse())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
