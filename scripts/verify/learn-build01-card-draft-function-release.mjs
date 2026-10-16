/** Exact card-input function release; TEST and rollback rehearsal before LIVE. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const mode=process.argv.slice(2).join(' ');
const project=mode==='--test'?TEST_PROJECT:mode==='--live'?'tgbnakbxwcqjeimygroz':null;
if(!project||(project===TEST_PROJECT?process.env.LEARN_TEST_ALLOW_PROJECT_REF:
 process.env.LEARN_LIVE_ALLOW_PROJECT_REF)!==project)
 throw Error('Exact TEST or LIVE project allowlist required');
const label=project===TEST_PROJECT?'test':'live';
const prefix=`.verification-results/build01-card-draft-function-${label}`;
if(existsSync(prefix+'-result.json')||existsSync(prefix+'-journal.json'))
 throw Error('Prior card function release needs inspection');
const sha256=value=>createHash('sha256').update(value).digest('hex');
const migration=readFileSync('supabase/migrations/20261104210000_learn_card_draft_prefilter.sql','utf8');
const migrationSha256=sha256(migration);
const token=savedCliToken(),headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
async function query(sql,readOnly){
 const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly?'/read-only':''}`,{
  method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(45000),
  body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})})});
 if(!response.ok){const detail=await response.json().catch(()=>({}));
  throw Error(`Card function query HTTP ${response.status} (${typeof detail.code==='string'?detail.code:'unknown'})`);}
 return response.json();
}
const catalog=`select pg_get_functiondef(p.oid) definition,r.rolname owner,
 p.prosecdef security_definer,p.proconfig settings,
 has_function_privilege('service_role',p.oid,'EXECUTE') service_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
 (select i.indisvalid and i.indisready from pg_index i join pg_class x on x.oid=i.indexrelid
  where x.relname='learn_card_email_draft_idx'
  and x.relnamespace='public'::regnamespace) draft_index_ready
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 join pg_roles r on r.oid=p.proowner
 where n.nspname='public' and p.proname='learn_card_projection_inputs'
 and pg_get_function_identity_arguments(p.oid)='p_tenant uuid, p_card uuid'`;
async function state(){
 const rows=await query(catalog,true);
 if(!Array.isArray(rows)||rows.length!==1||typeof rows[0].definition!=='string')
  throw Error('Card function catalog invalid');
 return rows[0];
}
const before=await state();
const baselineSha='d47624d89dbb01e7f493c25c1a7f074c3730ed3bf4bf48e51025385e6d39ccfc';
if(sha256(before.definition)!==baselineSha||before.owner!=='postgres'||
 before.security_definer!==true||before.service_execute!==true||
 before.authenticated_execute!==false||before.draft_index_ready!==true)
 throw Error('Exact card function or index baseline changed');
let test=null;
if(label==='live'){
 test=JSON.parse(readFileSync('.verification-results/build01-card-draft-function-test-result.json','utf8'));
 if(test.state!=='card_function_released'||test.migrationSha256!==migrationSha256)
  throw Error('Exact TEST card function acceptance changed');
}
writeFileSync(prefix+'-rollback.sql',before.definition,{flag:'wx',mode:0o600});
writeFileSync(prefix+'-journal.json',JSON.stringify({state:'prepared',project,
 baselineSha256:baselineSha,migrationSha256,rollbackSourceSaved:true},null,2)+'\n',
 {flag:'wx',mode:0o600});
await query(`begin; ${migration} rollback;`,false);
const rehearsed=await state();
if(sha256(rehearsed.definition)!==baselineSha||rehearsed.draft_index_ready!==true)
 throw Error('Card function rollback rehearsal did not preserve baseline');
await query(migration,false);
const after=await state();
const afterSha=sha256(after.definition);
const passed=afterSha!==baselineSha&&after.definition.includes('with drafts as materialized')&&
 !after.definition.includes('from public.interactions i left join public.email_messages m')&&
 after.owner===before.owner&&after.security_definer===before.security_definer&&
 JSON.stringify(after.settings)===JSON.stringify(before.settings)&&
 after.service_execute===before.service_execute&&
 after.authenticated_execute===before.authenticated_execute&&
 after.draft_index_ready===true&&(!test||afterSha===test.afterSha256);
const result={state:passed?'card_function_released':'requires_inspection',project,
 baselineSha256:baselineSha,afterSha256:afterSha,migrationSha256,
 rollbackRehearsed:true,indexReady:after.draft_index_ready,
 grantsAndOwnerPreserved:after.owner===before.owner&&
  after.service_execute===before.service_execute&&
  after.authenticated_execute===before.authenticated_execute,
 sourceRowsChanged:false};
writeFileSync(prefix+'-result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(result));
if(!passed)process.exitCode=1;
