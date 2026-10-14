/** Exact additive LIVE schema/worker promotion. Never enqueue or call providers.
 * An uncertain journal is inspected with --readback; never blindly rerun --deploy.
 */
import {readFileSync,writeFileSync,mkdirSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';
import {savedCliToken} from './learn-test-readiness.mjs';
import {SOURCE_TABLES,sourceFingerprintQuery,validateSourcePage,assertSourcesPreserved} from './learn-release-source-preservation.mjs';
const [mode,runtimePath,scalePath,output]=process.argv.slice(2);
if(process.argv.length!==6||!['--prepare','--deploy','--readback'].includes(mode)||
 [runtimePath,scalePath,output].some(p=>!p||!resolve(p).startsWith(resolve('.verification-results')+'/')))
 throw Error('Explicit mode and private runtime/rehearsal/release paths required');
const sha=b=>createHash('sha256').update(b).digest('hex'),read=p=>JSON.parse(readFileSync(p));
const manifestPath='supabase/release/learn-public-slack-observation/manifest.json';
const manifestBytes=readFileSync(manifestPath),m=JSON.parse(manifestBytes),project='tgbnakbxwcqjeimygroz';
const build=read(join(runtimePath,'build.json')),probe=read(join(runtimePath,'source-probe.json')),
 ordinary=read(join(runtimePath,'probe.json')),scale=read(join(scalePath,'report.json'));
if(m.project!==project||build.project!==project||build.state!=='compiled_with_public_dependency_resolution'||
 [probe,ordinary].some(p=>p.state!=='passed'||!p.containerRemoved||p.artifact.eszipSha256!==build.endpoints[0].eszipSha256)||
 scale.state!=='public_slack_observation_full_schema_rehearsed'||!scale.containerRemoved||
 scale.sourceFingerprintProtocol?.state!=='source_keyset_protocol_rehearsed'||
 scale.sourceFingerprintProtocol.sourceSha256!==sha(readFileSync('scripts/verify/learn-release-source-preservation.mjs'))||
 scale.syntheticSelection?.sourceRows<15000||scale.syntheticSelection.elapsed_ms>=10000||
 scale.migrationSha256!==m.source.sha256||sha(readFileSync(m.source.path))!==m.source.sha256||
 Object.entries(m.files).some(([name,h])=>sha(readFileSync('supabase/release/learn-public-slack-observation/'+name))!==h))
 throw Error('Exact reviewed schema, runtime and scale evidence required');
const candidate=readFileSync(join(runtimePath,'artifacts/platform-worker.eszip')),
 rollback=readFileSync(join(runtimePath,'artifacts/platform-worker.rollback.eszip'));
if(sha(candidate)!==build.endpoints[0].eszipSha256||sha(rollback)!==build.rollback.eszipSha256||!build.rollback.exactHostedArtifact)
 throw Error('Candidate or exact hosted rollback artifact changed');
const wire=b=>Buffer.concat([Buffer.from('EZBR'),brotliCompressSync(b,{params:{[constants.BROTLI_PARAM_QUALITY]:4}})]);
const candidateWire=wire(candidate),rollbackWire=wire(rollback);
if(!brotliDecompressSync(candidateWire.subarray(4)).equals(candidate)||!brotliDecompressSync(rollbackWire.subarray(4)).equals(rollback))throw Error('Wire round trip differs');
const token=savedCliToken(),tenant='00000000-0000-0000-0000-000000000001';
async function request(path,options={}){
 const r=await fetch(`https://api.supabase.com/v1/projects/${project}${path}`,{
  headers:{Authorization:`Bearer ${token}`,...(options.headers??{})},...options,redirect:'error',signal:AbortSignal.timeout(45000)});
 if(!r.ok){
  const errorText=await r.text();
  writeFileSync(resolve('.verification-results','learn-public-slack-management-error-'+randomUUID()+'.json'),
   JSON.stringify({path,status:r.status,error:errorText},null,2),{mode:0o600,flag:'wx'});
  const reason=/statement timeout/i.test(errorText)?'statement_timeout':
   /does not exist/i.test(errorText)?'missing_schema_dependency':
   /syntax error/i.test(errorText)?'sql_syntax':'unclassified';
  throw Error('Management request HTTP '+r.status+' ('+reason+'); response withheld');
 }
 const b=Buffer.from(await r.arrayBuffer());if(b.length>32*1024*1024)throw Error('Response exceeds bound');return b;
}
async function query(sql,readOnly=true){return JSON.parse(await request('/database/query'+(readOnly?'/read-only':''),{
 method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
 body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})})}));}
const inventory=async()=>JSON.parse(await request('/functions'));
const functions=async()=>query(`select oid::regprocedure::text signature,md5(pg_get_functiondef(oid)) definition_md5,
 md5(prosrc) body_md5,pg_get_userbyid(proowner) owner,proacl::text acl,prosecdef security_definer,proconfig config
 from pg_proc where oid in (${[...m.before.map(f=>'public.'+f.signature),'public.learn_public_slack_observation_context(uuid,uuid)']
 .map(s=>`to_regprocedure('${s}')`).join(',')})`);
const tableNames=SOURCE_TABLES;
let sourceColumns;
const snapshot=async cutoff=>{
 if(!sourceColumns){
  const columns=await query(`select c.relname name,jsonb_agg(a.attname::text order by a.attnum) columns
   from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
   where n.nspname='public' and c.relname in(${tableNames.map(t=>`'${t}'`).join(',')})
   and a.attnum>0 and not a.attisdropped group by c.relname`);
  if(columns.some(r=>!Array.isArray(r.columns)||r.columns.some(c=>typeof c!=='string')))
   throw Error('Source column catalog must contain explicit arrays');
  sourceColumns=new Map(columns.map(r=>[r.name,r.columns]));
  if(tableNames.some(t=>!sourceColumns.has(t)||!sourceColumns.get(t).includes('id')||!sourceColumns.get(t).includes('tenant_id')))
   throw Error('Source preservation catalog incomplete');
 }
 const sources=[];
 for(const t of tableNames){
  const retained=[];let cursor=null,complete=false;
  for(let page=0;page<150;page++){
   let rows;try{rows=await query(sourceFingerprintQuery({table:t,tenant,cutoff,cursor,columns:sourceColumns.get(t)}));}
   catch(error){throw Error('Preservation '+t+': '+error.message);}
   validateSourcePage(rows,cursor);
   if(rows.length===0){complete=true;break;}
   retained.push(...rows);cursor=rows.at(-1).id;
  }
  if(!complete)throw Error('Source keyset coverage exceeds bound');
  sources.push({name:t,count:retained.length,rows:retained});
  console.log(JSON.stringify({state:'source_fingerprint_verified',dataset:t,records:retained.length}));
 }
 return [{cutoff,sources:sources.sort((a,b)=>a.name.localeCompare(b.name))}];
};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function assertBefore(fs,inv){
 if(fs.length!==m.before.length||m.before.some(b=>{
  const a=fs.find(x=>x.signature.replace(/^public\./,'')===b.signature);
  return !a||['definition_md5','body_md5','owner','acl','security_definer','config'].some(k=>!equal(a[k],b[k]));
 }))throw Error('Exact LIVE SQL baseline differs');
 const w=inv.find(x=>x.slug==='platform-worker');
 if(w?.version!==build.before.version||w.ezbr_sha256!==build.before.wireSha256||w.verify_jwt!==false||w.status!=='ACTIVE')
  throw Error('Exact LIVE runtime baseline differs');
}
function assertAfter(fs){
 if(m.after.some(b=>{
  const a=fs.find(x=>x.signature===b.signature||'public.'+x.signature===b.signature);
  return !a||a.body_md5!==b.bodyMd5||a.owner!==b.owner||a.acl!==b.acl||a.security_definer!==b.securityDefiner||!equal(a.config,b.config);
 }))throw Error('Installed function or authority differs');
 for(const b of m.before.filter(x=>!m.after.some(a=>a.signature.replace(/^public\./,'')===x.signature))){
  const a=fs.find(x=>x.signature.replace(/^public\./,'')===b.signature);
  if(!a||a.definition_md5!==b.definition_md5||a.acl!==b.acl)throw Error('Untargeted guard changed');
 }
}
const journalPath=join(output,'journal.json'),preparedPath=join(output,'prepared.json');
const persist=value=>writeFileSync(journalPath,JSON.stringify(value,null,2)+'\n',{mode:0o600});
if(mode==='--prepare'){
 const inv=await inventory(),fs=await functions();assertBefore(fs,inv);
 if(sha(await request('/functions/platform-worker/body'))!==build.rollback.eszipSha256)throw Error('Rollback executable readback differs');
 const cutoff=(await query('select clock_timestamp() cutoff'))[0].cutoff;
 if(!Number.isFinite(Date.parse(cutoff)))throw Error('Invalid database cutoff');
 const preserved=await snapshot(cutoff);mkdirSync(output,{mode:0o700});
 const prepared={state:'prepared_not_deployed',preparedAt:new Date().toISOString(),project,manifestSha256:sha(manifestBytes),
  schemaSha256:m.source.sha256,sourceClosureSha256:build.sourceClosureSha256,candidateEszipSha256:sha(candidate),
  candidateWireSha256:sha(candidateWire),rollbackEszipSha256:sha(rollback),rollbackWireSha256:sha(rollbackWire),
  cutoff,preserved,inventoryBefore:inv,functionsBefore:fs,scale:scale.syntheticSelection};
 writeFileSync(preparedPath,JSON.stringify(prepared,null,2)+'\n',{mode:0o600,flag:'wx'});
 writeFileSync(join(output,'candidate.ezbr'),candidateWire,{mode:0o600,flag:'wx'});
 writeFileSync(join(output,'rollback.ezbr'),rollbackWire,{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({state:prepared.state,sourceDatasets:tableNames.length,scaleRows:scale.syntheticSelection.sourceRows,productionChanged:false}));
}else{
 const p=read(preparedPath);
 const priorJournal=mode==='--readback'?read(journalPath):null;
 const verifyingRollback=priorJournal?.state==='schema_rolled_back_worker_unchanged';
 const verifyingReleased=priorJournal?.state==='deployed_artifact_and_preservation_verified'&&
  p.schemaSha256===m.source.sha256&&p.sourceClosureSha256===build.sourceClosureSha256;
 if(p.project!==project||(!verifyingRollback&&!verifyingReleased&&p.manifestSha256!==sha(manifestBytes))||p.candidateWireSha256!==sha(candidateWire)||p.rollbackEszipSha256!==sha(rollback))
  throw Error('Prepared release changed');
 let journal;
 if(mode==='--deploy'){
  const inv=await inventory(),fs=await functions();assertBefore(fs,inv);
  // Refresh the preservation baseline immediately before release; captures may
  // have legitimately added records since preparation.
  const preserved=await snapshot(p.cutoff);
  journal={state:'started',startedAt:new Date().toISOString(),project,manifestSha256:sha(manifestBytes),
   cutoff:p.cutoff,preserved,inventoryBefore:inv,functionsBefore:fs};
  const fd=openSync(journalPath,'wx',0o600);try{writeSync(fd,JSON.stringify(journal,null,2));fsyncSync(fd);}finally{closeSync(fd);}
  journal.state='schema_request_started';persist(journal);
  await query(`set serviceos.release_target='${project}';set serviceos.release_sha256='${m.source.sha256}';`+
   readFileSync('supabase/release/learn-public-slack-observation/apply.sql','utf8'),false);
  assertAfter(await functions());journal.state='schema_installed';persist(journal);
  const start=Date.now();let selected;
  // Supabase's /read-only diagnostic login lacks EXECUTE on service-only RPCs.
  // Use the existing admin connection, fenced inside a read-only transaction.
  try{selected=await query(`begin read only;set local statement_timeout='10s';select interaction_id from public.intelligence_select_uningested('${tenant}','obs-ingest/2',25);commit;`,false);}
  catch(error){
   journal.selectionFailure=String(error.message);
   journal.state='selection_unconfirmed_rollback_started';persist(journal);
   await query(`set serviceos.release_target='${project}';set serviceos.release_sha256='${m.source.sha256}';`+
    readFileSync('supabase/release/learn-public-slack-observation/rollback.sql','utf8'),false);
   assertBefore(await functions(),await inventory());
   journal.state='schema_rolled_back_worker_unchanged';journal.finishedAt=new Date().toISOString();persist(journal);
   throw Error('LIVE selection failed its budget; exact schema rollback verified and worker unchanged');
  }
  journal.liveSelection={selected:selected.length,elapsedMs:Date.now()-start};journal.selectedInteractions=selected;
  if(selected.length>25)throw Error('Selection bound exceeded');persist(journal);
  journal.state='worker_request_started';persist(journal);
  const params=new URLSearchParams({verify_jwt:'false',entrypoint_path:'file:///work/supabase/functions/platform-worker/index.ts',ezbr_sha256:sha(candidateWire)});
  await request('/functions/platform-worker?'+params,{method:'PATCH',
   headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/vnd.denoland.eszip'},body:candidateWire});
 }else journal=priorJournal;
 // This readback is also the safe recovery route after any uncertain mutation.
 if(verifyingRollback){
  assertBefore(await functions(),await inventory());
  if(sha(await request('/functions/platform-worker/body'))!==sha(rollback))throw Error('Original worker readback differs');
  const restoredSources=await snapshot(journal.cutoff);
  writeFileSync(join(output,'rollback-source-comparison.json'),JSON.stringify({before:journal.preserved,after:restoredSources},null,2),{mode:0o600});
  assertSourcesPreserved(journal.preserved,restoredSources);
  journal.state='schema_rollback_and_source_preservation_verified';journal.verifiedAt=new Date().toISOString();
  journal.preservedDatasets=tableNames.length;persist(journal);
  console.log(JSON.stringify({state:journal.state,workerVersion:build.before.version,preservedDatasets:tableNames.length}));
  process.exit(0);
 }
 const inv=await inventory(),fs=await functions();assertAfter(fs);
 const worker=inv.find(x=>x.slug==='platform-worker');
 if(worker?.version!==build.before.version+1||worker.ezbr_sha256!==sha(candidateWire)||worker.verify_jwt!==false||worker.status!=='ACTIVE'||
  sha(await request('/functions/platform-worker/body'))!==sha(candidate))throw Error('Published worker acceptance differs; inspect journal, never rerun deployment blindly');
 if(journal.inventoryBefore.some(b=>b.slug!=='platform-worker'&&!equal(b,inv.find(a=>a.slug===b.slug))))
  throw Error('Unrelated runtime changed; inspect concurrent work');
 const preserved=await snapshot(journal.cutoff);
 assertSourcesPreserved(journal.preserved,preserved);
 const denied=await fetch(`https://${project}.supabase.co/functions/v1/platform-worker`,{method:'POST',
  headers:{'Content-Type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(15000)});
 await denied.body?.cancel();if(denied.status!==403)throw Error('Missing-auth denial differs');
 journal.state='deployed_artifact_and_preservation_verified';journal.verifiedAt=new Date().toISOString();
 journal.workerVersion=worker.version;journal.artifactReadbackMatched=true;journal.missingAuthStatus=denied.status;
 journal.preservedDatasets=tableNames.length;journal.providerCalls=0;journal.realObservationAcceptance='pending';persist(journal);
 console.log(JSON.stringify({state:journal.state,workerVersion:worker.version,liveSelection:journal.liveSelection,
  preservedDatasets:tableNames.length,providerCalls:0,realObservationAcceptance:'pending'}));
}
