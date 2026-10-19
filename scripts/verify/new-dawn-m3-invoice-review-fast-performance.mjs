/** Rollback-only LIVE performance check under the authenticated eight-second cap. */
import {pathToFileURL} from 'node:url';
import {savedCliToken} from './learn-test-readiness.mjs';
import {PROJECT,TENANT,VERSION,NAME,FUNCTION_SHA256,
  readStage,assess,reviewedSource} from './new-dawn-m3-invoice-review-fast-release.mjs';

const FLAG='new_dawn.invoice_review_candidates_preview';
const CLIENT_FLAGS=['new_dawn.owner_money','new_dawn.owner_report_review','new_dawn.owner_accounts_report'];
export function rollbackSql(){
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='8s';
lock table public.feature_flags in share row exclusive mode;
do $preflight$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations
  where version::text='${VERSION}' and name='${NAME}' and array_length(statements,1)=1
   and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${reviewedSource().hash}')
  or encode(sha256(convert_to(pg_get_functiondef(
   'public.new_dawn_invoice_review_candidates(uuid,text)'::regprocedure),'UTF8')),'hex')
    is distinct from '${FUNCTION_SHA256}'
  or (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid
   and flag='${FLAG}' and value='false'::jsonb)<>1
  or exists(select 1 from public.feature_flags where flag='${FLAG}'
   and tenant_id is distinct from '${TENANT}'::uuid)
  or exists(select 1 from public.feature_flags where flag in
   (${CLIENT_FLAGS.map(flag=>`'${flag}'`).join(',')}) and value='true'::jsonb)
  or (select count(*) from auth.users where lower(email)='chris@openfolk.ai'
   and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()))<>1
 then raise exception 'm3_fast_performance_preflight_changed';end if;
end $preflight$;
select set_config('request.jwt.claim.sub',id::text,true)
 from auth.users where lower(email)='chris@openfolk.ai';
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('m3.invoice_performance_started_at',clock_timestamp()::text,true);
update public.feature_flags set value='true'::jsonb
 where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='false'::jsonb;
set local role authenticated;
do $read$
declare got jsonb;
begin
 got:=public.new_dawn_invoice_review_candidates('${TENANT}'::uuid,
  'Rollback-only eight-second invoice source performance check');
 if got->>'version'<>'quickbooks-invoice-review-candidates/1'
  or got->>'audience'<>'openfolk_operator_only'
  or got->>'tenant_id'<>'${TENANT}'
  or got->>'actor_id'<>auth.uid()::text
  or jsonb_typeof(got->'candidates')<>'array'
  or jsonb_array_length(got->'candidates')>20
 then raise exception 'm3_fast_performance_result_invalid';end if;
end $read$;
reset role;
select 'm3-fast-authenticated-rollback/1' as marker,
 round(extract(epoch from clock_timestamp()-
  current_setting('m3.invoice_performance_started_at')::timestamptz)*1000)::int as elapsed_ms;
rollback;`;
}

export async function rehearse({fetcher=fetch,token=savedCliToken()}={}){
  assess(await readStage(PROJECT,token,fetcher),true);
  const response=await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:rollbackSql(),read_only:false})});
  if(!response.ok){
    const problem=await response.json().catch(()=>null);
    const code=typeof problem?.code==='string'&&/^[A-Z0-9]{5}$/.test(problem.code)?problem.code:'unknown';
    throw Error(`m3_fast_performance_rollback_failed_http_${response.status}_sqlstate_${code}`);
  }
  const rows=await response.json();
  const row=rows?.[0];
  if(!Array.isArray(rows)||rows.length!==1||row?.marker!=='m3-fast-authenticated-rollback/1'||
    !Number.isSafeInteger(row.elapsed_ms)||row.elapsed_ms<0)
    throw Error('m3_fast_performance_rollback_marker_missing');
  assess(await readStage(PROJECT,token,fetcher),true);
  return {state:'authenticated_read_passed_rolled_back',elapsedMs:row.elapsed_ms,
    operatorFlagEnabled:false,clientMoneyFlagsEnabled:false,providerRequests:0,
    retainedInvoiceValuesLogged:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.env.NEW_DAWN_M3_ALLOW_PROJECT!==PROJECT||
      process.env.NEW_DAWN_M3_ALLOW_PERFORMANCE_ROLLBACK!==VERSION||
      process.argv.slice(2).join(' ')!=='--live-rollback-authenticated-performance')
      throw Error('explicit_exact_live_rollback_performance_required');
    console.log(JSON.stringify(await rehearse()));
  }catch(error){console.error(JSON.stringify({state:'m3_fast_performance_stopped',
    code:error instanceof Error?error.message:'unknown',retryAllowed:false,
    providerRequests:0,retainedInvoiceValuesLogged:0}));process.exitCode=1;}
}
