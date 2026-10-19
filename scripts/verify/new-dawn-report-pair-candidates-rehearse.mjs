/** Rollback-only hosted TEST check of the operator report-pair selector. */
import { readFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
import { rehearsalSql as reportSummarySql } from './new-dawn-report-summary-rehearse.mjs';

export function rehearsalSql() {
  const migration=readFileSync(new URL('../../supabase/migrations/20261108100000_new_dawn_report_pair_candidates.sql',import.meta.url),'utf8');
  if(!/\nbegin;\n/i.test(migration)||!/\ncommit;\s*$/i.test(migration))throw Error('Migration wrapper changed');
  const body=migration.replace(/\nbegin;\n/i,'\n').replace(/\ncommit;\s*$/i,'\n');
  const base=reportSummarySql().replace('do $fixture$',()=>`${body}\ndo $fixture$`);
  if(base===reportSummarySql())throw Error('Summary fixture marker changed');
  const probe=`do $candidate$
declare p_id uuid:='debbbbbb-0000-4000-8000-000000000001';
 a_id uuid:='debbbbbb-0000-4000-8000-000000000002';
 tenant uuid;actor uuid;ordinary uuid;got jsonb;
begin
 select tenant_id,actor_id into tenant,actor from public.learn_quickbooks_report_requests where id=p_id;
 if tenant is null or actor is null then raise exception 'candidate_fixture_missing';end if;
 update public.learn_quickbooks_report_requests set environment='production' where id in(p_id,a_id);
 update public.feature_flags set value='false'::jsonb
  where tenant_id=tenant and flag='new_dawn.report_summary_preview';
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin
  perform public.learn_quickbooks_report_pair_candidates(tenant,'Synthetic flag denial');
  raise exception 'candidate_flag_off_allowed';
 exception when sqlstate '42501' then
  if sqlerrm<>'report_pair_candidates_disabled' then raise;end if;
 end;
 update public.feature_flags set value='true'::jsonb
  where tenant_id=tenant and flag='new_dawn.report_summary_preview';
 if has_function_privilege('anon','public.learn_quickbooks_report_pair_candidates(uuid,text)','EXECUTE')
  or has_function_privilege('service_role','public.learn_quickbooks_report_pair_candidates(uuid,text)','EXECUTE') then
  raise exception 'candidate_grant_boundary_failed';end if;
 got:=public.learn_quickbooks_report_pair_candidates(tenant,'Synthetic operator choices');
 if got->>'audience'<>'openfolk_operator_only' or got->>'actor_id'<>actor::text
  or jsonb_array_length(got->'candidates')>12
  or not exists(select 1 from jsonb_array_elements(got->'candidates') x
   where x->>'profit_request'=p_id::text and x->>'receivables_request'=a_id::text
    and x->>'period_end'='2026-09-30' and x->>'currency'='GBP')
  or got::text like '%250.00%' or got::text like '%100.00%'
  or not exists(select 1 from public.learn_quickbooks_finance_events
   where id=(got->>'audit_id')::uuid and event='report.pair_candidates_read'
    and actor_id=actor and detail->>'candidate_count'='1') then
  raise exception 'candidate_operator_read_failed';end if;
 select p.id into ordinary from public.profiles p join auth.users u on u.id=p.id
  where u.deleted_at is null and not exists(select 1 from public.platform_authority_grants g
   where g.profile_id=p.id and g.permission='platform.controlplane.admin'
    and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
    and coalesce(g.effective_to,'infinity')>clock_timestamp()) order by p.id limit 1;
 if ordinary is null then raise exception 'candidate_ordinary_missing';end if;
 perform set_config('request.jwt.claim.sub',ordinary::text,true);
 begin
  perform public.learn_quickbooks_report_pair_candidates(tenant,'Synthetic ordinary denial');
  raise exception 'candidate_ordinary_allowed';
 exception when sqlstate '42501' then null;end;
end $candidate$;`;
  return base.replace("select 'new-dawn-report-summary/1' as marker;",()=>`${probe}\nselect 'new-dawn-report-pair-candidates/1' as marker;`);
}

export async function rehearse(fetcher=fetch,token=savedCliToken()){
  const response=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:rehearsalSql()}),redirect:'error',signal:AbortSignal.timeout(60000),
  });
  if(!response.ok){
    const problem=await response.json().catch(()=>null);
    const code=typeof problem?.code==='string'&&/^[A-Z0-9]{5}$/.test(problem.code)?problem.code:'unknown';
    const detail=typeof problem?.message==='string' ? problem.message.replace(/[^A-Za-z0-9_ .:-]/g,'').slice(0,160) : 'no public diagnostic';
    throw Error(`TEST rollback report pairs failed (HTTP ${response.status}, SQLSTATE ${code}: ${detail})`);
  }
  const rows=await response.json();
  if(!Array.isArray(rows)||rows.length!==1||rows[0]?.marker!=='new-dawn-report-pair-candidates/1')
    throw Error('TEST rollback report pair marker missing');
  return {state:'passed_rolled_back',project:TEST_PROJECT,providerRequests:0};
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){
  try{console.log(JSON.stringify(await rehearse()));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
