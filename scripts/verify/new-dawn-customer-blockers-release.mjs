/** Exact, audited customer-held-jobs reader rehearsal and release. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';

const project='tgbnakbxwcqjeimygroz';
const version='20261112220000';
const name='new_dawn_customer_blockers_home';
const sourceHash='bc99225550f87cc2f585312aa7a1b533bb821f06a1262ce5a0a8071f10074c24';
const signature='public.new_dawn_customer_blockers(uuid,text)';
const sourcePath=new URL(`../../supabase/migrations/${version}_${name}.sql`,import.meta.url);
const sha=value=>createHash('sha256').update(value).digest('hex');
const literal=value=>`'${value.replaceAll("'","''")}'`;
function exactSource(){
 const source=readFileSync(sourcePath,'utf8');
 if(sha(source)!==sourceHash||!/\nbegin;\s*\n/i.test(source)||!/\ncommit;\s*$/i.test(source))
  throw Error('customer_blockers_source_changed');
 return {source,body:source.slice(source.indexOf('\nbegin;')+8,source.lastIndexOf('\ncommit;'))};
}
async function query(sql,readOnly=false){
 const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly?'/read-only':''}`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),
  headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
  body:JSON.stringify({query:sql,read_only:readOnly})});
 if(!response.ok)throw Error(`customer_blockers_http_${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length>100000)throw Error('customer_blockers_response_too_large');
 return JSON.parse(bytes.toString('utf8'));
}
const catalog=`select
 (select count(*)::int from supabase_migrations.schema_migrations where version::text='${version}') ledger_count,
 (select name from supabase_migrations.schema_migrations where version::text='${version}') ledger_name,
 (select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version::text='${version}') ledger_hash,
 to_regprocedure('${signature}') is not null installed,
 has_function_privilege('authenticated',to_regprocedure('${signature}'),'EXECUTE') auth_execute,
 has_function_privilege('anon',to_regprocedure('${signature}'),'EXECUTE') anon_execute,
 has_function_privilege('service_role',to_regprocedure('${signature}'),'EXECUTE') service_execute`;
async function stage(){
 const rows=await query(catalog,true);
 if(!Array.isArray(rows)||rows.length!==1)throw Error('customer_blockers_catalog_unconfirmed');
 const row=rows[0];
 if(row.ledger_count===0&&row.installed===false&&row.ledger_name===null&&row.ledger_hash===null)
  return {state:'ready',project,version,sourceHash};
 if(row.ledger_count===1&&row.installed===true&&row.ledger_name===name&&
  row.ledger_hash===sourceHash&&row.auth_execute===true&&
  row.anon_execute===false&&row.service_execute===false)
  return {state:'installed',project,version,sourceHash};
 throw Error('customer_blockers_stage_changed');
}
async function rehearse(){
 if((await stage()).state!=='ready')throw Error('customer_blockers_already_installed');
 const {body}=exactSource();
 const sql=`begin;set local lock_timeout='3s';set local statement_timeout='35s';
${body}
do $check$ begin
 if to_regprocedure('${signature}') is null
  or not has_function_privilege('authenticated','${signature}','EXECUTE')
  or has_function_privilege('anon','${signature}','EXECUTE')
  or has_function_privilege('service_role','${signature}','EXECUTE')
 then raise exception 'customer_blockers_grant_check_failed';end if;
end $check$;
rollback;select 'rehearsed' state;`;
 const rows=await query(sql);
 if(!Array.isArray(rows)||!rows.some(row=>row?.state==='rehearsed'))
  throw Error('customer_blockers_rehearsal_unconfirmed');
 if((await stage()).state!=='ready')throw Error('customer_blockers_rollback_unconfirmed');
 return {state:'rehearsed',project,version,sourceHash};
}
async function install(){
 if((await stage()).state!=='ready')throw Error('customer_blockers_already_installed');
 const {source,body}=exactSource();
 const sql=`begin;set local lock_timeout='3s';set local statement_timeout='35s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin if exists(select 1 from supabase_migrations.schema_migrations where version::text='${version}')
 or to_regprocedure('${signature}') is not null
 then raise exception 'customer_blockers_release_state_changed';end if;end $gate$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${version}','${name}',array[${literal(source)}]);
select '${version}' installed_version;commit;`;
 try{await query(sql);}catch{ /* Read the ledger after an uncertain response. */ }
 const result=await stage();
 if(result.state!=='installed')throw Error('customer_blockers_install_unconfirmed');
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--live-read-only')console.log(JSON.stringify(await stage()));
  else if(args.length===1&&args[0]==='--live-rollback-rehearsal')console.log(JSON.stringify(await rehearse()));
  else if(args.length===3&&args[0]==='--live-install-exact'&&args[1]==='--sha'&&
    args[2]===sourceHash&&process.env.NEW_DAWN_CUSTOMER_BLOCKERS_PROJECT===project)
    console.log(JSON.stringify(await install()));
  else throw Error('customer_blockers_exact_scope_required');
 }catch(error){console.error(JSON.stringify({state:'stopped',reason:error instanceof Error?error.message:'unknown'}));process.exitCode=1;}
}
