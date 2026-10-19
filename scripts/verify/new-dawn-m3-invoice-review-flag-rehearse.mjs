/** Rollback-only hosted TEST check of the exact flag SQL shape and audit path. */
import {savedCliToken,TEST_PROJECT} from './learn-test-readiness.mjs';
import {rehearsalSql as invoiceRehearsal} from './new-dawn-invoice-review-rehearse.mjs';
import {FLAG,flagSql} from './new-dawn-m3-invoice-review-flag.mjs';
import {TENANT,VERSION,NAME,reviewedSource} from './new-dawn-m3-invoice-review-release.mjs';

const enableAudit='decccccc-0000-4000-8000-000000000101';
const disableAudit='decccccc-0000-4000-8000-000000000102';
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function body(sql,tenant){
  const scoped=sql.replaceAll(TENANT,tenant);
  if(scoped===sql&&tenant!==TENANT)throw Error('TEST tenant substitution missing');
  return scoped.replace(/^begin;\n/,'').replace(/select 'm3-invoice-review-(?:enabled|disabled)\/1' as marker;\n/,'')
    .replace(/\ncommit;$/,'');
}

export function rehearsalSql(tenant){
  if(!uuid(tenant))throw Error('TEST tenant unavailable');
  const base=invoiceRehearsal();
  const marker="select 'new-dawn-invoice-review/1' as marker;\nrollback;";
  if(!base.endsWith(marker))throw Error('Invoice rollback fixture marker changed');
  const source=reviewedSource();
  const append=`update public.feature_flags set value='false'::jsonb
 where tenant_id='${tenant}'::uuid and flag='${FLAG}';
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations(
 version text primary key,name text,statements text[]);
-- TEST has a different append-only trigger pair. Add the LIVE-named pair only
-- inside this rollback transaction so the exact release guard can be rehearsed.
create trigger controlplane_change_log_no_update before update on public.controlplane_change_log
 for each row execute function public.learn_operator_input_immutable();
create trigger controlplane_change_log_no_delete before delete on public.controlplane_change_log
 for each row execute function public.learn_operator_input_immutable();
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(source.source)}]);
${body(flagSql(true,enableAudit),tenant)}
${body(flagSql(false,disableAudit),tenant)}
do $assert$
begin
 if (select count(*) from public.feature_flags where tenant_id='${tenant}'::uuid
   and flag='${FLAG}' and value='false'::jsonb)<>1
  or (select count(*) from public.controlplane_change_log where id in
   ('${enableAudit}'::uuid,'${disableAudit}'::uuid))<>2
  or not exists(select 1 from public.controlplane_change_log where id='${enableAudit}'::uuid
   and action='new_dawn.invoice_review_candidates_preview.enable'
   and before->>'enabled'='false' and after->>'enabled'='true')
  or not exists(select 1 from public.controlplane_change_log where id='${disableAudit}'::uuid
   and action='new_dawn.invoice_review_candidates_preview.disable'
   and before->>'enabled'='true' and after->>'enabled'='false')
 then raise exception 'invoice_flag_rollback_assert_failed';end if;
end $assert$;
select 'new-dawn-invoice-flag-rollback/1' as marker;
rollback;`;
  return base.slice(0,-marker.length)+append;
}

export async function rehearse(fetcher=fetch,token=savedCliToken()){
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const tenantResponse=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,{
    method:'POST',headers,body:JSON.stringify({query:
      "select id::text from public.tenants where status='active' order by id limit 1"}),
    redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!tenantResponse.ok)throw Error('TEST active tenant metadata unavailable');
  const tenantRows=await tenantResponse.json();
  const tenant=tenantRows?.[0]?.id;
  if(!uuid(tenant))throw Error('TEST active tenant metadata invalid');
  const response=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{
    method:'POST',headers,body:JSON.stringify({query:rehearsalSql(tenant)}),
    redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok){
    const problem=await response.json().catch(()=>null);
    const detail=typeof problem?.message==='string'?problem.message.replace(/[^A-Za-z0-9_ .:-]/g,'').slice(0,160):'no public diagnostic';
    throw Error(`TEST rollback invoice flag failed (HTTP ${response.status}: ${detail})`);
  }
  const rows=await response.json();
  if(!Array.isArray(rows)||rows.length!==1||rows[0]?.marker!=='new-dawn-invoice-flag-rollback/1')
    throw Error('TEST rollback invoice flag marker missing');
  return {state:'passed_rolled_back',project:TEST_PROJECT,providerRequests:0,invoiceValuesRead:0};
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){
  try{console.log(JSON.stringify(await rehearse()));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
