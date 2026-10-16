/** Guarded TEST-first rollback rehearsals and exact older Email selector release. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const mode=process.argv.slice(2).join(' ');
if(!['--rehearse-test','--apply-test','--rehearse-live','--apply-live'].includes(mode))
  throw Error('Exact Email selector release mode required');
const project=mode.endsWith('test')?TEST_PROJECT:'tgbnakbxwcqjeimygroz';
if(project==='tgbnakbxwcqjeimygroz'&&process.env.LEARN_LIVE_ALLOW_PROJECT_REF!==project)
  throw Error('Exact LIVE project guard required');
const sql=await readFile('supabase/migrations/20261104200000_learn_email_bounded_revision_window.sql','utf8');
const packageSha256=createHash('sha256').update(sql).digest('hex');
const directory='.verification-results/learn-build01-email-selector-window';
await mkdir(directory,{recursive:true,mode:0o700});
const token=savedCliToken();
async function query(statement,readOnly=true){
  const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly?'/read-only':''}`,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:statement})});
  const rows=await response.json().catch(()=>null);
  if(response.status!==201||!Array.isArray(rows))
    throw Error(`Email selector release query unconfirmed (HTTP ${response.status})`);
  return rows;
}
async function catalog(){
  const rows=await query(`select md5(pg_get_functiondef(p.oid)) digest,
    pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.proconfig::text settings,
    position('limit least(2000,greatest(32,bound+22))' in pg_get_functiondef(p.oid))>0 window_32,
    position('and m.created_at>=clock_timestamp()-interval ''30 days''' in pg_get_functiondef(p.oid))>0 recent_30_day,
    position('return query select * from public.learn_projection_pending_full(p_tenant,p_source,bound);' in pg_get_functiondef(p.oid))>0 full_fallback
    from pg_proc p where p.oid='public.learn_projection_pending(uuid,text,integer)'::regprocedure`);
  if(rows.length!==1||!rows[0]?.digest) throw Error('Email selector catalog unavailable');
  return rows[0];
}
async function recent(prefix){
  for(const name of await readdir(directory)){
    if(!name.startsWith(`${prefix}-`)||!name.endsWith('.json'))continue;
    const receipt=JSON.parse(await readFile(`${directory}/${name}`,'utf8'));
    if(receipt.packageSha256===packageSha256&&receipt.state===
      (prefix.startsWith('rehearse')?'rehearsed_rolled_back':'installed_verified')&&
      Date.now()-Date.parse(receipt.observedAt)<3600000)return receipt;
  }
  return null;
}
const before=await catalog();
const baseline=project===TEST_PROJECT?'c2ca034cf37189240e8a07b30aedd368':
  '0ffedc2f069d2d594bfb282fdf629985';
if(before.digest!==baseline||before.owner!=='postgres'||
  before.acl!=='{postgres=X/postgres,service_role=X/postgres}'||
  before.settings!=='{search_path=pg_catalog,TimeZone=UTC}'||
  before.window_32!==false||before.recent_30_day!==true||before.full_fallback!==true)
  throw Error('Exact Email selector prerequisite changed');
if(mode==='--apply-test'&&!(await recent('rehearse-test')))
  throw Error('Fresh TEST rollback rehearsal required');
if(mode==='--rehearse-live'&&!(await recent('apply-test')))
  throw Error('Verified TEST installation required');
if(mode==='--apply-live'&&(!(await recent('apply-test'))||!(await recent('rehearse-live'))))
  throw Error('Verified TEST and fresh LIVE rollback rehearsal required');

const name=`${directory}/${mode.slice(2)}-${Date.now()}.json`;
await writeFile(name,JSON.stringify({state:'prepared_not_submitted',mode,project,
  packageSha256,before,startedAt:new Date().toISOString()},null,2)+'\n',
  {flag:'wx',mode:0o600});
let submitted=false;
try{
  await query(mode.startsWith('--rehearse')
    ? sql.replace(/\ncommit;\s*$/i,'\nrollback;\n') : sql,false);
  submitted=true;
}catch{/* Reconcile uncertain acknowledgement from the catalog. */}
const after=await catalog();
const rehearsed=mode.startsWith('--rehearse');
const preserved=after.owner===before.owner&&after.acl===before.acl;
const installed=after.digest!==baseline&&after.window_32===true&&
  after.recent_30_day===true&&after.full_fallback===true&&
  String(after.settings).includes('search_path=pg_catalog')&&
  String(after.settings).includes('TimeZone=UTC')&&
  String(after.settings).includes('statement_timeout=25s');
const state=submitted&&preserved&&(rehearsed?after.digest===baseline:installed)
  ?rehearsed?'rehearsed_rolled_back':'installed_verified':'requires_inspection';
const receipt={state,mode,project,packageSha256,originalDigest:before.digest,
  installedDigest:after.digest,ownerPreserved:after.owner===before.owner,
  aclPreserved:after.acl===before.acl,settings:after.settings,
  observedAt:new Date().toISOString(),productionSourceWrites:false,
  providerRequests:0};
await writeFile(name,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(receipt));
if(state==='requires_inspection')process.exitCode=1;
