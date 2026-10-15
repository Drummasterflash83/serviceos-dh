/** Guarded TEST-first release of the bounded Graph missing-interaction selector. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const mode=process.argv[2];
if(!['--rehearse-test','--apply-test','--rehearse-live','--apply-live'].includes(mode)
 || process.argv.length!==3)throw Error('Exact Graph selector release mode required');
const project=mode.endsWith('test')?TEST_PROJECT:'tgbnakbxwcqjeimygroz';
const sql=await readFile('supabase/migrations/20261104060000_learn_graph_missing_bounded_hash.sql','utf8');
const packageSha256=createHash('sha256').update(sql).digest('hex');
const directory='.verification-results/learn-build01-graph-selector';
await mkdir(directory,{recursive:true,mode:0o700});
const token=savedCliToken();
async function query(statement,readOnly=true){
 const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly?'/read-only':''}`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),
  headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify({query:statement}),
 });
 const rows=await r.json().catch(()=>null);
 if(r.status!==201||!Array.isArray(rows))throw Error(`Graph selector query unconfirmed (HTTP ${r.status})`);
 return rows;
}
async function catalog(){
 const rows=await query(`select md5(pg_get_functiondef(p.oid)) digest,
 pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.proconfig::text settings,
 position('with existing as materialized' in lower(pg_get_functiondef(p.oid)))>0 hash_candidate
 from pg_proc p where p.oid='public.learn_graph_missing_interactions(uuid,integer)'::regprocedure`);
 if(rows.length!==1||!rows[0]?.digest)throw Error('Graph selector catalog unavailable');
 return rows[0];
}
async function recent(modeName){
 for(const name of await readdir(directory)){
  if(!name.startsWith(`${modeName}-`)||!name.endsWith('.json'))continue;
  const receipt=JSON.parse(await readFile(`${directory}/${name}`,'utf8'));
  if(receipt.packageSha256===packageSha256&&receipt.state===
      (modeName.startsWith('rehearse')?'rehearsed_rolled_back':'installed_verified')&&
      Date.now()-Date.parse(receipt.observedAt)<3600000)return receipt;
 }
 return null;
}
const before=await catalog();
const original='2de3ce73d4df9f94945c5968ede2e239';
const expectedAcl='{postgres=X/postgres,service_role=X/postgres}';
if(before.digest!==original||before.owner!=='postgres'||before.acl!==expectedAcl||
 before.hash_candidate!==false||before.settings!=='{search_path=pg_catalog,TimeZone=UTC}')
 throw Error('Exact Graph selector prerequisite changed');
if(mode==='--apply-test'&&!(await recent('rehearse-test')))
 throw Error('Fresh TEST rollback rehearsal required');
if(mode==='--rehearse-live'&&!(await recent('apply-test')))
 throw Error('Verified TEST installation required');
if(mode==='--apply-live'&&(!(await recent('apply-test'))||!(await recent('rehearse-live'))))
 throw Error('Verified TEST and fresh LIVE rehearsal required');

const name=`${directory}/${mode.slice(2)}-${Date.now()}.json`;
await writeFile(name,JSON.stringify({state:'prepared_not_submitted',mode,project,packageSha256,before,
 startedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx',mode:0o600});
let submitted=false;
try{
 await query(mode.startsWith('--rehearse')?sql.replace(/\ncommit;\s*$/i,'\nrollback;\n'):sql,false);
 submitted=true;
}catch{/* An uncertain acknowledgement is reconciled from the catalog, never retried blindly. */}
const after=await catalog();
const rehearsal=mode.startsWith('--rehearse');
const settings=after.settings??'';
const installed=after.digest!==original&&after.hash_candidate===true&&
 settings.includes('search_path=pg_catalog')&&settings.includes('TimeZone=UTC')&&
 settings.includes('statement_timeout=25s');
const preserved=after.owner===before.owner&&after.acl===before.acl;
const state=submitted&&preserved&&(rehearsal?after.digest===original:installed)
 ?rehearsal?'rehearsed_rolled_back':'installed_verified':'requires_inspection';
const receipt={state,mode,project,packageSha256,originalDigest:before.digest,
 installedDigest:after.digest,ownerPreserved:after.owner===before.owner,
 aclPreserved:after.acl===before.acl,settings:after.settings,
 observedAt:new Date().toISOString(),sourceDataWrites:false,providerRequests:0};
await writeFile(name,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(receipt));
if(state!=='installed_verified'&&state!=='rehearsed_rolled_back')process.exitCode=1;
