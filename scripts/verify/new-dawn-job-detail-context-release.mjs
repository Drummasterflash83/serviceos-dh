/** Exact LIVE job-detail release: one concurrent index and one read-only RPC. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';

const project='tgbnakbxwcqjeimygroz';
const indexVersion='20261112205900', indexName='new_dawn_job_contact_index';
const functionVersion='20261112210000', functionName='new_dawn_client_job_context';
const indexHash='bc96ffd75d7adfdecc375f9503fc8ae8836ebcde67a95fe32ea31106a9239e0b';
const functionHash='d7d998eb4c5f4e061713bfc8e62ad4f923e4628a906261d549e04955c6d02e6d';
const rollbackHash='c3e776128593c890d59610758999b67df0730266b94bd3ec128d61cbe7a8c73a';
const baselineHash='cf474becae2e830ab66bd3fdea0c327c1575687604ca0eb72058c4e30192fa29';
const signature='public.new_dawn_client_job_record(uuid,uuid,text,uuid,text)';
const index='public.interactions_tenant_job_contact_idx';
const sha=value=>createHash('sha256').update(value).digest('hex');
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
const file=(path,expected)=>{const source=readFileSync(new URL(path,import.meta.url),'utf8');
 if(sha(source)!==expected)throw Error('job_detail_source_changed');return source;};
const indexSource=()=>file(`../../supabase/migrations/${indexVersion}_${indexName}.sql`,indexHash);
const functionSource=()=>file(`../../supabase/migrations/${functionVersion}_${functionName}.sql`,functionHash);
const rollbackSource=()=>file('../../supabase/release/new-dawn-client-job-context/rollback.sql',rollbackHash);
const body=source=>{if(!/\nbegin;\s*\n/i.test(source)||!/\ncommit;\s*$/i.test(source))throw Error('job_detail_transaction_shape');
 return source.slice(source.indexOf('\nbegin;')+8,source.lastIndexOf('\ncommit;'));};

async function query(sql,readOnly=false){const response=await fetch(
 `https://api.supabase.com/v1/projects/${project}/database/query${readOnly?'/read-only':''}`,{
 method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),
 headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
 body:JSON.stringify({query:sql,read_only:readOnly})});
 if(!response.ok)throw Error(`job_detail_http_${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length>100000)throw Error('job_detail_response_too_large');
 return JSON.parse(bytes.toString('utf8'));}

const catalog=`select
 (select count(*)::int from supabase_migrations.schema_migrations where version::text='${indexVersion}') index_ledger,
 (select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version::text='${indexVersion}') index_ledger_hash,
 (select count(*)::int from supabase_migrations.schema_migrations where version::text='${functionVersion}') function_ledger,
 (select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version::text='${functionVersion}') function_ledger_hash,
 encode(sha256(convert_to(pg_get_functiondef('${signature}'::regprocedure),'UTF8')),'hex') function_catalog_hash,
 has_function_privilege('authenticated','${signature}','EXECUTE') authenticated_execute,
 has_function_privilege('anon','${signature}','EXECUTE') anon_execute,
 has_function_privilege('service_role','${signature}','EXECUTE') service_execute,
 (select jsonb_build_object('valid',i.indisvalid,'ready',i.indisready,
  'table_ok',i.indrelid='public.interactions'::regclass,'definition',pg_get_indexdef(i.indexrelid))
  from pg_index i where i.indexrelid=to_regclass('${index}')) index_state`;
const stage=async()=>{const rows=await query(catalog,true);if(!Array.isArray(rows)||rows.length!==1)
 throw Error('job_detail_catalog_unconfirmed');return rows[0];};
function assess(row,phase){
 const absent=phase==='ready';const indexed=phase==='indexed';
 if(row.index_ledger!==(absent||indexed?0:1)||row.index_ledger_hash!==(absent||indexed?null:indexHash)||
    row.function_ledger!==(phase==='installed'?1:0)||
    row.function_ledger_hash!==(phase==='installed'?functionHash:null)||
    row.function_catalog_hash!==(phase==='installed'?row.function_catalog_hash:baselineHash)||
    !/^[a-f0-9]{64}$/.test(row.function_catalog_hash)||
    row.authenticated_execute!==true||row.anon_execute!==false||row.service_execute!==false||
    (absent?row.index_state!==null:row.index_state?.valid!==true||row.index_state?.ready!==true||
      row.index_state?.table_ok!==true||
      !['tenant_id','related_job_id','source_type','status ='].every(part=>
        String(row.index_state?.definition).includes(part))))
   throw Error('job_detail_live_stage_changed');
 if(phase==='installed'&&row.function_catalog_hash===baselineHash)throw Error('job_detail_function_unchanged');
 return {state:phase,project,indexVersion,functionVersion,functionCatalogHash:row.function_catalog_hash};
}

async function rehearse(){
 const source=functionSource(),rollback=rollbackSource();indexSource();
 assess(await stage(),'ready');
 const sql=`begin;set local lock_timeout='3s';set local statement_timeout='35s';
${body(source)}
do $check$ begin if encode(sha256(convert_to(pg_get_functiondef('${signature}'::regprocedure),'UTF8')),'hex')='${baselineHash}'
 then raise exception 'job_detail_candidate_unchanged';end if;end $check$;
${body(rollback)}
do $check$ begin if encode(sha256(convert_to(pg_get_functiondef('${signature}'::regprocedure),'UTF8')),'hex')<>'${baselineHash}'
 then raise exception 'job_detail_rollback_failed';end if;end $check$;
rollback;select 'rehearsed' state;`;
 const rows=await query(sql);if(!Array.isArray(rows)||!rows.some(row=>row?.state==='rehearsed'))
  throw Error('job_detail_rehearsal_unconfirmed');
 assess(await stage(),'ready');return {state:'rehearsed',project,functionHash,rollbackHash,indexHash};
}

async function install(){
 const indexSql=indexSource(),source=functionSource();rollbackSource();
 assess(await stage(),'ready');
 // CREATE INDEX CONCURRENTLY is its own top-level statement. An uncertain
 // outcome is read back and stopped; it is never replayed blindly.
 try{await query(indexSql);}catch{}
 assess(await stage(),'indexed');
 const register=`begin;lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin if exists(select 1 from supabase_migrations.schema_migrations where version::text='${indexVersion}')
 or to_regclass('${index}') is null then raise exception 'job_detail_index_gate';end if;end $gate$;
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${indexVersion}','${indexName}',array[${literal(indexSql)}]);commit;`;
 try{await query(register);}catch{}
 const indexed=await stage();
 if(indexed.index_ledger!==1||indexed.index_ledger_hash!==indexHash||indexed.function_ledger!==0||
    indexed.function_catalog_hash!==baselineHash)throw Error('job_detail_index_ledger_unconfirmed');
 const functionSql=`begin;set local lock_timeout='3s';set local statement_timeout='35s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin if exists(select 1 from supabase_migrations.schema_migrations where version::text='${functionVersion}')
 or encode(sha256(convert_to(pg_get_functiondef('${signature}'::regprocedure),'UTF8')),'hex')<>'${baselineHash}'
 then raise exception 'job_detail_function_gate';end if;end $gate$;
${body(source)}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${functionVersion}','${functionName}',array[${literal(source)}]);commit;`;
 try{await query(functionSql);}catch{}
 return assess(await stage(),'installed');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--live-read-only')console.log(JSON.stringify(assess(await stage(),'ready')));
  else if(args.length===1&&args[0]==='--live-rollback-rehearsal')console.log(JSON.stringify(await rehearse()));
  else if(args.length===3&&args[0]==='--live-install-exact'&&args[1]==='--sha'&&
   args[2]===functionHash&&process.env.NEW_DAWN_JOB_DETAIL_PROJECT===project)
   console.log(JSON.stringify(await install()));
  else throw Error('job_detail_exact_scope_required');
 }catch(error){console.error(JSON.stringify({state:'stopped',reason:error instanceof Error?error.message:'unknown'}));process.exitCode=1;}
}
