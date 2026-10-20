/** Rollback-only TEST flag switch with a synthetic saved pair; no provider call. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { rehearsalSql as marginRehearsalSql } from './new-dawn-m3-accounts-margin-rehearse.mjs';
import { flagSql,TENANT } from './new-dawn-m3-margin-operator-flag.mjs';
import { savedCliToken,TEST_PROJECT } from './learn-test-readiness.mjs';

const source=readFileSync(new URL('../../supabase/migrations/20261109100000_new_dawn_accounts_margin_preview.sql',import.meta.url),'utf8');
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);

async function testTenant(token,fetcher=fetch){
  const query=`select c.tenant_id,c.environment from public.learn_quickbooks_connections c
    join public.tenants t on t.id=c.tenant_id and t.status='active'
    where c.realm_id is not null order by c.id limit 1`;
  const response=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`margin_flag_test_tenant_http_${response.status}`);
  const rows=await response.json();
  if(!Array.isArray(rows)||rows.length!==1||!uuid(rows[0]?.tenant_id)||
    rows[0].tenant_id===TENANT||rows[0].environment!=='sandbox')
    throw Error('margin_flag_test_tenant_changed');
  return rows[0].tenant_id;
}

export function rehearsalSql(fixtureTenant){
  if(!uuid(fixtureTenant)||fixtureTenant===TENANT)throw Error('margin_flag_fixture_tenant_required');
  let base=marginRehearsalSql();
  const marker="select 'new-dawn-accounts-margin/1' as marker;";
  if(!base.includes(marker)||!base.endsWith('rollback;'))throw Error('margin_fixture_source_changed');
  const switchBody=on=>{
    let sql=flagSql(on);
    if(!sql.startsWith('begin;\n')||!sql.endsWith('\ncommit;'))
      throw Error('margin_flag_transaction_wrapper_changed');
    sql=sql.slice('begin;\n'.length,-'\ncommit;'.length)
      .replaceAll(TENANT,fixtureTenant);
    if(on){
      // TEST has one disconnected sandbox connection. Only this synthetic
      // rehearsal changes the environment and connection-status predicates.
      sql=sql.replaceAll("environment='production'","environment='sandbox'")
        .replaceAll('and confirmed_at is not null','')
        .replaceAll("and status in ('active','paused')",'');
    }
    return sql;
  };
  const prep=`create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text,name text,statements text[]);
do $margin_flag_prep$
declare t uuid:='${fixtureTenant}'::uuid;
begin
 if (select count(*) from public.feature_flags where tenant_id=t
   and flag='new_dawn.report_margin_preview' and value='true'::jsonb)<>1
 then raise exception 'margin_flag_fixture_missing';end if;
 update public.feature_flags set value='false'::jsonb
  where tenant_id=t and flag='new_dawn.report_margin_preview';
 update public.feature_flags set value='true'::jsonb
  where tenant_id=t and flag='new_dawn.job_home_accounts_preview';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(t,'new_dawn.job_home_accounts_preview','true'::jsonb);end if;
 if exists(select 1 from supabase_migrations.schema_migrations
  where version::text='20261109100000')
 then raise exception 'margin_flag_fixture_ledger_collision';end if;
 insert into supabase_migrations.schema_migrations(version,name,statements)
 values('20261109100000','new_dawn_accounts_margin_preview',array[${quote(source)}]);
end $margin_flag_prep$;`;
  const check=on=>`do $margin_flag_check$
begin
 if (select count(*) from public.feature_flags where tenant_id='${fixtureTenant}'::uuid
   and flag='new_dawn.report_margin_preview' and value='true'::jsonb)<>${Number(on)}
 then raise exception 'margin_flag_${on?'enable':'disable'}_readback_failed';end if;
end $margin_flag_check$;`;
  const steps=`${prep}\n${switchBody(true)}\n${check(true)}\n${switchBody(false)}\n${check(false)}\nselect 'new-dawn-margin-flag/1' as marker;`;
  return base.replace(marker,()=>steps);
}

export async function rehearse(fetcher=fetch,token=savedCliToken()){
  const fixtureTenant=await testTenant(token,fetcher);
  const response=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:rehearsalSql(fixtureTenant)}),redirect:'error',
    signal:AbortSignal.timeout(90000)});
  if(!response.ok){
    const problem=await response.json().catch(()=>null);
    const match=typeof problem?.message==='string'?problem.message.match(/ERROR:\s+([A-Z0-9]{5}):/):null;
    throw Error(`TEST rollback margin flag failed (HTTP ${response.status}, SQLSTATE ${match?.[1]??'unknown'})`);
  }
  const rows=await response.json();
  if(!Array.isArray(rows)||rows.length!==1||rows[0]?.marker!=='new-dawn-margin-flag/1')
    throw Error('TEST rollback margin flag receipt missing');
  return {state:'passed_rolled_back',project:TEST_PROJECT,
    syntheticTenant:true,providerRequests:0,enableAndDisableVerified:true};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await rehearse()));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
