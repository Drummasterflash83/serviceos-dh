/** Rollback-only TEST contract; counts source metadata, never values or provider data. */
import { readFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

export function rehearsalSql() {
  const migration = readFileSync(new URL('../../supabase/migrations/20261106170000_new_dawn_money_source_readiness.sql', import.meta.url),'utf8');
  if (!/\nbegin;\n/i.test(migration) || !/\ncommit;\s*$/i.test(migration)) throw Error('Migration wrapper changed');
  const body = migration.replace(/\nbegin;\n/i,'\n').replace(/\ncommit;\s*$/i,'\n');
  return `begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
${body}
do $fixture$
declare c public.learn_quickbooks_connections%rowtype;actor uuid;ordinary_actor uuid;r jsonb;
begin
 select c0.* into c from public.learn_quickbooks_connections c0
  join public.tenants t on t.id=c0.tenant_id and t.status='active'
  where c0.realm_id is not null order by c0.id limit 1;
 if c.id is null then raise exception 'fixture_connection_missing';end if;
 update public.learn_quickbooks_connections set status='paused',confirmed_at=clock_timestamp()
  where id=c.id;
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
 update public.feature_flags set value='false'::jsonb where tenant_id=c.tenant_id and flag='new_dawn.money_source_readiness';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(c.tenant_id,'new_dawn.money_source_readiness','false'::jsonb);end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin
  perform public.learn_quickbooks_money_source_readiness(c.tenant_id,c.id,'Synthetic flag denial');
  raise exception 'fixture_flag_off_allowed';
 exception when sqlstate '42501' then if sqlerrm<>'money_readiness_disabled' then raise;end if;end;
 update public.feature_flags set value='true'::jsonb where tenant_id=c.tenant_id and flag='new_dawn.money_source_readiness';
 r:=public.learn_quickbooks_money_source_readiness(c.tenant_id,c.id,'Synthetic metadata read');
 if r->>'version'<>'quickbooks-money-source-readiness/1'
  or r->>'audience'<>'openfolk_operator_only' or r->>'realm_id' is distinct from c.realm_id
  or r#>>'{field_gp,status}'<>'held' or r#>>'{arr,status}'<>'held'
  or r->'retained' ?| array['amount','balance','profit','revenue','cost_value']
  or not exists(select 1 from public.learn_quickbooks_finance_events
   where id=(r->>'audit_id')::uuid and event='money.source_readiness_read') then
  raise exception 'fixture_readiness_contract_failed';end if;
 begin
  perform public.learn_quickbooks_money_source_readiness(c.tenant_id,gen_random_uuid(),'Synthetic wrong connection');
  raise exception 'fixture_wrong_connection_allowed';
 exception when sqlstate '42501' then if sqlerrm<>'money_readiness_connection_unavailable' then raise;end if;end;
 select p.id into ordinary_actor from public.profiles p join auth.users u on u.id=p.id
  where u.deleted_at is null and not exists(select 1 from public.platform_authority_grants g
   where g.profile_id=p.id and g.permission='platform.controlplane.admin'
    and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
    and coalesce(g.effective_to,'infinity')>clock_timestamp()) order by p.id limit 1;
 if ordinary_actor is null then raise exception 'fixture_ordinary_actor_missing';end if;
 perform set_config('request.jwt.claim.sub',ordinary_actor::text,true);
 begin
  perform public.learn_quickbooks_money_source_readiness(c.tenant_id,c.id,'Synthetic ordinary denial');
  raise exception 'fixture_ordinary_allowed';
 exception when sqlstate '42501' then null;end;
 if has_function_privilege('anon','public.learn_quickbooks_money_source_readiness(uuid,uuid,text)','EXECUTE') then
  raise exception 'fixture_anon_grant_allowed';end if;
end $fixture$;
select 'new-dawn-money-source-readiness/1' marker;
rollback;`;
}

export async function rehearse(fetcher = fetch, token = savedCliToken()) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:rehearsalSql()}),redirect:'error',signal:AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const code = typeof problem?.code === 'string' && /^[A-Z0-9]{5}$/.test(problem.code) ? problem.code : 'unknown';
    throw Error(`TEST rollback source-readiness rehearsal failed (HTTP ${response.status}, SQLSTATE ${code})`);
  }
  const rows=await response.json();
  if (!Array.isArray(rows) || rows.length!==1 || rows[0]?.marker!=='new-dawn-money-source-readiness/1')
    throw Error('TEST rollback source-readiness receipt missing');
  return {state:'passed_rolled_back',project:TEST_PROJECT,providerRequests:0,financialValuesReturned:false};
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {console.log(JSON.stringify(await rehearse()));}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
