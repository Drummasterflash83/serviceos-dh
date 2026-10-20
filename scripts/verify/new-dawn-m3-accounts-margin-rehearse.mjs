/** Rollback-only hosted TEST check of the exact M3 accounts-margin source. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { rehearsalSql as summaryRehearsalSql } from './new-dawn-report-summary-rehearse.mjs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const VERSION='20261109100000';
const NAME='new_dawn_accounts_margin_preview';
const filename=new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`,import.meta.url);

export function rehearsalSql(){
  const migration=readFileSync(filename,'utf8');
  if(!/\nbegin;\n/i.test(migration)||!/\ncommit;\s*$/i.test(migration))
    throw Error('accounts_margin_migration_wrapper_changed');
  const body=migration.replace(/\nbegin;\n/i,'\n').replace(/\ncommit;\s*$/i,'\n');
  let sql=summaryRehearsalSql();
  const oldRows='"Rows":{"Row":[{"type":"Section","group":"GrossProfit"';
  const newRows='"Rows":{"Row":[{"type":"Section","group":"Income","Summary":{"ColData":[{"value":"Total Income"},{"value":"1000.00"}]}},{"type":"Section","group":"COGS","Summary":{"ColData":[{"value":"Total Cost of Sales"},{"value":"750.00"}]}},{"type":"Section","group":"GrossProfit"';
  if(!sql.includes(oldRows)||!sql.includes('do $fixture$')||!sql.includes("select 'new-dawn-report-summary/1' as marker;"))
    throw Error('accounts_margin_summary_fixture_changed');
  sql=sql.replace(oldRows,newRows).replace('do $fixture$',()=>`${body}\ndo $fixture$`);
  const verification=`do $margin_fixture$
declare t uuid; actor uuid; ordinary_actor uuid; got jsonb;
 c public.learn_quickbooks_connections%rowtype; profit jsonb; bad_profit jsonb;
 bad_request uuid; scenario int;
 p_id uuid:='debbbbbb-0000-4000-8000-000000000001';
 a_id uuid:='debbbbbb-0000-4000-8000-000000000002';
begin
 select tenant_id,actor_id into t,actor from public.learn_quickbooks_report_requests where id=p_id;
 if t is null or actor is null then raise exception 'margin_fixture_missing';end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin
  perform public.learn_quickbooks_accounts_margin_preview(t,p_id,a_id,'Synthetic margin flag denial');
  raise exception 'margin_flag_off_allowed';
 exception when sqlstate '42501' then
  if sqlerrm<>'accounts_margin_disabled' then raise;end if;
 end;
 insert into public.feature_flags(tenant_id,flag,value)
 values(t,'new_dawn.report_margin_preview','true'::jsonb);
 got:=public.learn_quickbooks_accounts_margin_preview(t,p_id,a_id,'Synthetic margin read');
 if got->>'audience'<>'openfolk_operator_only'
  or got->>'total_income'<>'1000.00'
  or got->>'accounts_gross_profit'<>'250.00'
  or got->>'accounts_gross_margin_pct'<>'25.00'
  or got->>'denominator'<>'QuickBooks Total Income'
  or got->>'target_comparison'<>'withheld_unconfirmed_accounts_or_field_basis'
  or got ? 'net_profit'
  or not exists(select 1 from public.learn_quickbooks_finance_events
   where id=(got->>'audit_id')::uuid and event='report.accounts_margin_preview_read')
 then raise exception 'margin_result_failed';end if;
 select * into c from public.learn_quickbooks_connections
  where tenant_id=t and id=(select connection_id from public.learn_quickbooks_report_requests where id=p_id);
 select raw_response::jsonb into profit from public.learn_quickbooks_report_receipts
  where request_id=p_id;
 for scenario in 1..3 loop
  bad_request:=gen_random_uuid();
  bad_profit:=case scenario
   when 1 then jsonb_set(profit,'{Rows,Row,0,Summary,ColData,1,value}','"0.00"'::jsonb)
   when 2 then jsonb_set(profit,'{Rows,Row,1,Summary,ColData,1,value}','"749.99"'::jsonb)
   else jsonb_set(profit,'{Rows,Row}',
    profit#>'{Rows,Row}' || jsonb_build_array(profit#>'{Rows,Row,0}')) end;
  insert into public.learn_quickbooks_report_requests(id,tenant_id,connection_id,actor_id,
    environment,realm_id,connection_revision,token_generation,report_kind,
    period_start,period_end,accounting_method,reason,state)
  values(bad_request,t,c.id,actor,c.environment,c.realm_id,c.revision,c.token_generation,
    'ProfitAndLoss','2026-09-01','2026-09-30','Accrual','Synthetic bad margin','complete');
  insert into public.learn_quickbooks_report_receipts(request_id,tenant_id,report_kind,
    raw_response,response_sha256,header,validation_state)
  values(bad_request,t,'ProfitAndLoss',bad_profit::text,repeat('c',64),
    bad_profit->'Header','verified');
  begin
   perform public.learn_quickbooks_accounts_margin_preview(t,bad_request,a_id,'Synthetic invalid margin');
   raise exception 'bad_margin_source_allowed';
  exception when sqlstate '22023' then
   if sqlerrm not in ('accounts_margin_reconciliation_held','accounts_margin_shape_held')
    then raise;end if;
  end;
 end loop;
 select p.id into ordinary_actor from public.profiles p join auth.users u on u.id=p.id
  where u.deleted_at is null and not exists(select 1 from public.platform_authority_grants g
   where g.profile_id=p.id and g.permission='platform.controlplane.admin'
    and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
    and coalesce(g.effective_to,'infinity')>clock_timestamp()) order by p.id limit 1;
 if ordinary_actor is null then raise exception 'margin_ordinary_actor_missing';end if;
 perform set_config('request.jwt.claim.sub',ordinary_actor::text,true);
 begin
  perform public.learn_quickbooks_accounts_margin_preview(t,p_id,a_id,'Synthetic ordinary denial');
  raise exception 'margin_ordinary_allowed';
 exception when sqlstate '42501' then null;end;
 if has_function_privilege('anon','public.learn_quickbooks_accounts_margin_preview(uuid,uuid,uuid,text)','EXECUTE')
  or has_function_privilege('service_role','public.learn_quickbooks_accounts_margin_preview(uuid,uuid,uuid,text)','EXECUTE')
 then raise exception 'margin_grant_boundary_failed';end if;
end $margin_fixture$;
select 'new-dawn-accounts-margin/1' as marker;`;
  return sql.replace("select 'new-dawn-report-summary/1' as marker;",verification);
}

export async function rehearse(fetcher=fetch,token=savedCliToken()){
  const response=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:rehearsalSql()}),redirect:'error',signal:AbortSignal.timeout(60000),
  });
  if(!response.ok){
    const problem=await response.json().catch(()=>null);
    const code=typeof problem?.code==='string'&&/^[A-Z0-9]{5}$/.test(problem.code)?problem.code:'unknown';
    throw Error(`TEST rollback accounts margin failed (HTTP ${response.status}, SQLSTATE ${code})`);
  }
  const rows=await response.json();
  if(!Array.isArray(rows)||rows.length!==1||rows[0]?.marker!=='new-dawn-accounts-margin/1')
    throw Error('TEST rollback accounts margin receipt missing');
  return {state:'passed_rolled_back',project:TEST_PROJECT,providerRequests:0,syntheticFigures:3};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await rehearse()));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
