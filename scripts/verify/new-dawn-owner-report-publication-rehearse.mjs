/** Rollback-only TEST owner/report boundary. Synthetic money; no provider call. */
import { readFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
import { rehearsalSql as priorReportRehearsal } from './new-dawn-report-summary-rehearse.mjs';

export function rehearsalSql() {
  const prior=priorReportRehearsal();
  const ending="select 'new-dawn-report-summary/1' as marker;\nrollback;";
  if (!prior.endsWith(ending)) throw Error('Prior rollback fixture changed');
  const source=readFileSync(new URL('../../supabase/migrations/20261106190000_new_dawn_owner_report_publication.sql',import.meta.url),'utf8');
  if (!/\nbegin;\n/i.test(source) || !/\ncommit;\s*$/i.test(source))
    throw Error('Owner report migration wrapper changed');
  const body=source.replace(/\nbegin;\n/i,'\n').replace(/\ncommit;\s*$/i,'\n');
  return prior.slice(0,-ending.length).replace("set local statement_timeout='45s';","set local statement_timeout='90s';")+`
${body}
do $owner_fixture$
declare c public.learn_quickbooks_connections%rowtype;actor uuid;client uuid;
 original_actor public.profiles%rowtype;
 got jsonb;read_result jsonb;
 p_id uuid:='debbbbbb-0000-4000-8000-000000000001';
 a_id uuid:='debbbbbb-0000-4000-8000-000000000002';
begin
 select c0.* into c from public.learn_quickbooks_connections c0
  join public.learn_quickbooks_report_requests r on r.connection_id=c0.id
  where r.id=p_id;
 if c.id is null then raise exception 'fixture_connection_missing';end if;
 select actor_id into actor from public.learn_quickbooks_report_requests where id=p_id;
 select p.id into client from public.profiles p join auth.users u on u.id=p.id
  where u.deleted_at is null and p.id<>actor
   and not exists(select 1 from public.platform_authority_grants g
    where g.profile_id=p.id and g.permission='platform.controlplane.admin'
     and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
     and coalesce(g.effective_to,'infinity')>clock_timestamp())
  order by p.id limit 1;
 if actor is null or client is null then raise exception 'fixture_actors_missing';end if;
 -- TEST has no eligible ordinary login; clear only this fixture account's ban
 -- inside the same rollback transaction, then restore it automatically.
 update auth.users set banned_until=null where id=client;
 -- TEST has only a sandbox connection. Change only the rolled-back synthetic
 -- fixture scope; no provider endpoint is contacted or credential is read.
 update public.learn_quickbooks_connections set environment='production' where id=c.id;
 update public.learn_quickbooks_report_requests set environment='production'
  where id in(p_id,a_id);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin
  perform public.learn_quickbooks_owner_report_review(c.tenant_id,'approve',p_id,a_id,
   repeat('a',64),repeat('b',64),0,'Synthetic accounting review','Synthetic flag denial');
  raise exception 'fixture_review_flag_off_allowed';
 exception when sqlstate '42501' then
  if sqlerrm<>'owner_report_review_disabled' then raise;end if;end;
 update public.feature_flags set value='true'::jsonb where tenant_id=c.tenant_id
  and flag='new_dawn.owner_report_review';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(c.tenant_id,'new_dawn.owner_report_review','true'::jsonb);end if;
 got:=public.learn_quickbooks_owner_report_review(c.tenant_id,'approve',p_id,a_id,
  repeat('a',64),repeat('b',64),0,'Synthetic accounting review','Synthetic reviewed pair');
 if got->>'decision'<>'approve' or got->>'revision'<>'1'
  or got ?| array['summary','net_profit','accounts_gross_profit','aged_receivables']
  or not exists(select 1 from public.learn_quickbooks_finance_events
   where id=(got->>'audit_id')::uuid and event='owner_report.approve'
    and not detail ? 'net_profit') then
  raise exception 'fixture_review_contract_failed';end if;
 begin
  perform public.learn_quickbooks_owner_report_review(c.tenant_id,'approve',p_id,a_id,
   repeat('a',64),repeat('b',64),0,'Synthetic accounting review','Synthetic stale revision');
  raise exception 'fixture_stale_revision_allowed';
 exception when sqlstate '40001' then
  if sqlerrm<>'owner_report_review_changed' then raise;end if;end;
 begin
  perform public.learn_quickbooks_owner_report_review(c.tenant_id,'approve',p_id,a_id,
   repeat('c',64),repeat('b',64),1,'Synthetic accounting review','Synthetic hash mismatch');
  raise exception 'fixture_wrong_hash_allowed';
 exception when sqlstate '40001' then
  if sqlerrm<>'owner_report_review_source_changed' then raise;end if;end;
 if has_table_privilege('authenticated','public.learn_quickbooks_owner_report_publications','select')
  or has_table_privilege('anon','public.learn_quickbooks_owner_report_publications','select')
  or has_table_privilege('service_role','public.learn_quickbooks_owner_report_publications','select')
  or has_function_privilege('anon','public.learn_quickbooks_owner_accounts_report(uuid)','execute')
  or has_function_privilege('service_role','public.learn_quickbooks_owner_accounts_report(uuid)','execute') then
  raise exception 'fixture_direct_grant_failed';end if;
 update public.profiles set tenant_id=c.tenant_id,role='owner' where id=client;
 update public.feature_flags set value='true'::jsonb where tenant_id=c.tenant_id
  and flag='learn.enabled';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(c.tenant_id,'learn.enabled','true'::jsonb);end if;
 perform set_config('request.jwt.claim.sub',client::text,true);
 begin
  perform public.learn_quickbooks_owner_accounts_report(c.tenant_id);
  raise exception 'fixture_owner_flag_off_allowed';
 exception when sqlstate '42501' then
  if sqlerrm<>'owner_report_disabled' then raise;end if;end;
 update public.feature_flags set value='true'::jsonb where tenant_id=c.tenant_id
  and flag='new_dawn.owner_accounts_report';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(c.tenant_id,'new_dawn.owner_accounts_report','true'::jsonb);end if;
 read_result:=public.learn_quickbooks_owner_accounts_report(c.tenant_id);
 if read_result->>'audience'<>'client_owner_only'
  or read_result->>'accounts_gross_profit'<>'250.00'
  or read_result->>'net_profit'<>'100.00'
  or read_result#>>'{aged_receivables,total}'<>'100.00'
  or read_result#>>'{field_gross_profit,status}'<>'held'
  or read_result#>>'{arr,status}'<>'held'
  or not exists(select 1 from public.learn_quickbooks_finance_events
   where id=(read_result->>'audit_id')::uuid and event='owner_report.read'
    and not detail ? 'net_profit') then
  raise exception 'fixture_owner_read_failed';end if;
 update public.profiles set role='admin' where id=client;
 begin
  perform public.learn_quickbooks_owner_accounts_report(c.tenant_id);
  raise exception 'fixture_admin_net_profit_allowed';
 exception when sqlstate '42501' then
  if sqlerrm<>'owner_report_forbidden' then raise;end if;end;
 update public.profiles set role='viewer' where id=client;
 begin
  perform public.learn_quickbooks_owner_accounts_report(c.tenant_id);
  raise exception 'fixture_team_net_profit_allowed';
 exception when sqlstate '42501' then
  if sqlerrm<>'owner_report_forbidden' then raise;end if;end;
 update public.profiles set role='owner' where id=client;
 begin
  perform public.learn_quickbooks_owner_accounts_report(gen_random_uuid());
  raise exception 'fixture_wrong_tenant_allowed';
 exception when sqlstate '42501' then
  if sqlerrm<>'owner_report_forbidden' then raise;end if;end;
 update public.learn_quickbooks_report_requests set period_end='2026-09-29'
  where id=p_id;
 begin
  perform public.learn_quickbooks_owner_accounts_report(c.tenant_id);
  raise exception 'fixture_changed_source_allowed';
 exception when sqlstate '40001' then
  if sqlerrm<>'owner_report_source_changed' then raise;end if;end;
 update public.learn_quickbooks_report_requests set period_end='2026-09-30'
  where id=p_id;
 update public.learn_quickbooks_report_requests set accounting_method='Cash'
  where id=p_id;
 begin
  perform public.learn_quickbooks_owner_accounts_report(c.tenant_id);
  raise exception 'fixture_changed_basis_allowed';
 exception when sqlstate '40001' then
  if sqlerrm<>'owner_report_source_changed' then raise;end if;end;
 update public.learn_quickbooks_report_requests set accounting_method='Accrual'
  where id=p_id;
 update public.learn_quickbooks_report_requests set realm_id='99999999999999999999'
  where id=p_id;
 begin
  perform public.learn_quickbooks_owner_accounts_report(c.tenant_id);
  raise exception 'fixture_changed_realm_allowed';
 exception when sqlstate '40001' then
  if sqlerrm<>'owner_report_source_changed' then raise;end if;end;
 update public.learn_quickbooks_report_requests set realm_id=c.realm_id
  where id=p_id;
 update public.learn_quickbooks_report_requests set state='failed'
  where id=p_id;
 begin
  perform public.learn_quickbooks_owner_accounts_report(c.tenant_id);
  raise exception 'fixture_held_request_allowed';
 exception when sqlstate '40001' then
  if sqlerrm<>'owner_report_source_changed' then raise;end if;end;
 update public.learn_quickbooks_report_requests set state='complete'
  where id=p_id;
 select * into original_actor from public.profiles where id=actor;
 update public.profiles set role='owner',tenant_id=c.tenant_id where id=actor;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin
  perform public.learn_quickbooks_owner_accounts_report(c.tenant_id);
  raise exception 'fixture_operator_impersonation_allowed';
 exception when sqlstate '42501' then
  if sqlerrm<>'owner_report_forbidden' then raise;end if;end;
 update public.profiles set role=original_actor.role,tenant_id=original_actor.tenant_id
  where id=actor;
 got:=public.learn_quickbooks_owner_report_review(c.tenant_id,'revoke',null,null,
  null,null,1,'Synthetic accounting review','Synthetic publication revoke');
 if got->>'decision'<>'revoke' or got->>'revision'<>'2' then
  raise exception 'fixture_revoke_failed';end if;
 perform set_config('request.jwt.claim.sub',client::text,true);
 begin
  perform public.learn_quickbooks_owner_accounts_report(c.tenant_id);
  raise exception 'fixture_revoked_owner_read_allowed';
 exception when sqlstate '42501' then
  if sqlerrm<>'owner_report_unpublished' then raise;end if;end;
end $owner_fixture$;
select 'new-dawn-owner-report-publication/1' marker;
rollback;`;
}

export async function rehearse(fetcher=fetch, token=savedCliToken()) {
  const response=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:rehearsalSql(),read_only:false}),
    redirect:'error',signal:AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    const problem=await response.json().catch(()=>null);
    const code=typeof problem?.code==='string' && /^[A-Z0-9]{5}$/.test(problem.code)
      ? problem.code : 'unknown';
    throw Error(`TEST rollback owner report failed (HTTP ${response.status}, SQLSTATE ${code})`);
  }
  const rows=await response.json();
  if (!Array.isArray(rows) || rows.length!==1 || rows[0]?.marker!=='new-dawn-owner-report-publication/1')
    throw Error('TEST rollback owner report receipt missing');
  return {state:'passed_rolled_back',project:TEST_PROJECT,providerRequests:0,
    publicationRowsAfter:0,clientFlagEnabledAfter:false};
}

if (process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href) {
  try {console.log(JSON.stringify(await rehearse()));}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
