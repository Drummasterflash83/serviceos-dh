/** Rollback-only TEST rehearsal of the bounded saved-invoice RPC. */
import {readFileSync} from 'node:fs';
import {savedCliToken,TEST_PROJECT} from './learn-test-readiness.mjs';
import {rehearsalSql as baseRehearsal} from './new-dawn-invoice-review-rehearse.mjs';

export function rehearsalSql(){
  const migration=readFileSync(new URL('../../supabase/migrations/20261108120000_new_dawn_invoice_review_candidates_fast.sql',import.meta.url),'utf8');
  if(!/\nbegin;\n/i.test(migration)||!/\ncommit;\s*$/i.test(migration))
    throw Error('Fast migration wrapper changed');
  const body=migration.replace(/\nbegin;\n/i,'\n').replace(/\ncommit;\s*$/i,'\n');
  const base=baseRehearsal();
  const verify='do $verify$';
  if(base.indexOf(verify)<0||base.indexOf(verify)!==base.lastIndexOf(verify))
    throw Error('Base synthetic verifier changed');
  const marker="select 'new-dawn-invoice-review/1' as marker;\nrollback;";
  if(!base.endsWith(marker))throw Error('Base rollback marker changed');
  const withFast=base.replace(verify,()=>`${body}\n${verify}`);
  const mixedCurrency=`do $currency_guard$
declare t uuid; v uuid:=gen_random_uuid(); updated timestamptz:=clock_timestamp();
begin
 select tenant_id into t from public.learn_quickbooks_connections
  where realm_id='9876543210123456789' and status='paused';
 if t is null then raise exception 'synthetic_realm_missing';end if;
 insert into public.learn_quickbooks_source_versions(id,tenant_id,environment,realm_id,
  entity,external_id,content_hash,payload,sync_token,source_updated_at)
 values(v,t,'production','9876543210123456789','Invoice','900008',repeat('d',64),
  jsonb_build_object('Id','900008','Balance',10.25::numeric,
   'CurrencyRef',jsonb_build_object('value','USD'),
   'DueDate',((clock_timestamp() at time zone 'UTC')::date-5)::text),1,updated);
 insert into public.learn_quickbooks_latest(tenant_id,environment,realm_id,entity,
  external_id,version_id,sync_token,source_updated_at,conflicted,last_observed_at)
 values(t,'production','9876543210123456789','Invoice','900008',v,1,updated,false,updated);
 begin
  perform public.new_dawn_invoice_review_candidates(t,'Synthetic mixed current currency');
  raise exception 'mixed_currency_allowed';
 exception when sqlstate '42501' then
  if sqlerrm<>'invoice_review_currency_unconfirmed' then raise;end if;
 end;
end $currency_guard$;\n`;
  return withFast.slice(0,-marker.length)+mixedCurrency+`select
 encode(sha256(convert_to(pg_get_functiondef(
  'public.new_dawn_invoice_review_candidates(uuid,text)'::regprocedure),'UTF8')),'hex') as function_hash,
 encode(sha256(convert_to(pg_get_indexdef(
  'public.learn_quickbooks_latest_invoice_recent_review'::regclass),'UTF8')),'hex') as index_hash,
 to_regclass('public.learn_quickbooks_latest_invoice_recent_review') is not null as index_installed,
 'new-dawn-invoice-review-fast/1' as marker;
rollback;`;
}

export async function rehearse(fetcher=fetch,token=savedCliToken()){
  const response=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:rehearsalSql()}),redirect:'error',signal:AbortSignal.timeout(60_000),
  });
  if(!response.ok){
    const problem=await response.json().catch(()=>null);
    const code=typeof problem?.code==='string'&&/^[A-Z0-9]{5}$/.test(problem.code)?problem.code:'unknown';
    const detail=typeof problem?.message==='string'?problem.message.replace(/[^A-Za-z0-9_ .:-]/g,'').slice(0,160):'no public diagnostic';
    throw Error(`TEST rollback fast invoice review failed (HTTP ${response.status}, SQLSTATE ${code}: ${detail})`);
  }
  const rows=await response.json();
  const row=rows?.[0];
  if(!Array.isArray(rows)||rows.length!==1||row?.marker!=='new-dawn-invoice-review-fast/1'||
    row?.index_installed!==true||typeof row?.function_hash!=='string'||
    !/^[0-9a-f]{64}$/.test(row.function_hash)||
    typeof row?.index_hash!=='string'||!/^[0-9a-f]{64}$/.test(row.index_hash))
    throw Error('TEST rollback fast invoice marker missing');
  return {state:'passed_rolled_back',project:TEST_PROJECT,
    functionSha256:row.function_hash,indexSha256:row.index_hash,providerRequests:0};
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){
  try{console.log(JSON.stringify(await rehearse()));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
