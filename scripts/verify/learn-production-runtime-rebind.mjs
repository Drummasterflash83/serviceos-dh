/** Carry exact retained executable evidence across an additive SQL-only revision.
 * Offline only. Original reports are preserved; this does not rerun a boot test. */
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const [priorManifest,bundleDir,bootPath,rehearsalPath,destination]=process.argv.slice(2);
const privateRoot=resolve('.verification-results')+'/';
if(process.argv.length!==7||[priorManifest,bundleDir,bootPath,rehearsalPath,destination].some(p=>!p||!resolve(p).startsWith(privateRoot)))throw Error('Private evidence paths and fresh output required');
const sha=v=>createHash('sha256').update(v).digest('hex'),parse=p=>JSON.parse(readFileSync(p));
const currentBytes=readFileSync('supabase/release/learn-production/runtime-candidate.manifest.json');
const current=JSON.parse(currentBytes),oldBytes=readFileSync(priorManifest),old=JSON.parse(oldBytes);
const {database:priorDb,...priorRuntime}=old,{database:currentDb,...currentRuntime}=current;
if(JSON.stringify(priorRuntime)!==JSON.stringify(currentRuntime)||currentDb.length!==priorDb.length+1||
 JSON.stringify(currentDb.slice(0,-1))!==JSON.stringify(priorDb))throw Error('Only one additive SQL package may differ');
const rehearsal=parse(rehearsalPath);
if(rehearsal.state!=='production_commusoft_recurring_rehearsed_offline'||!rehearsal.containerRemoved||
 !rehearsal.journey?.passed||JSON.stringify(rehearsal.packages)!==JSON.stringify(currentDb.map(p=>p.sha256))||
 rehearsal.originalArchivePreservation?.state!=='all_archived_copy_rows_and_sequences_match'||
 rehearsal.preservation?.state!=='all_archived_copy_rows_and_sequences_match')throw Error('Matching successful SQL rehearsal required');
for(const p of currentDb)if(sha(readFileSync(p.path))!==p.sha256||sha(readFileSync(p.path.replace('.sql','.manifest.json')))!==p.manifestSha256)throw Error('SQL package changed');
const bundleBytes=readFileSync(join(bundleDir,'report.json')),bundle=JSON.parse(bundleBytes);
const bootBytes=readFileSync(bootPath),boot=JSON.parse(bootBytes);
if(bundle.state!=='all_candidate_endpoints_bundled'||!bundle.withinConservativeLocalBundleLimit||
 boot.state!=='all_endpoints_booted_and_rejected_missing_auth'||!boot.containerRemoved||
 bundle.manifestSha256!==sha(oldBytes)||boot.manifestSha256!==sha(oldBytes)||
 bundle.sourceClosureSha256!==current.sourceClosureSha256||boot.sourceClosureSha256!==current.sourceClosureSha256||
 bundle.endpoints.length!==current.endpoints.length||boot.artifacts.length!==current.endpoints.length||boot.checks.length!==current.endpoints.length||
 new Set(bundle.endpoints.map(e=>e.name)).size!==current.endpoints.length||
 new Set(boot.artifacts.map(e=>e.name)).size!==current.endpoints.length||
 new Set(boot.checks.map(e=>e.name)).size!==current.endpoints.length)throw Error('Original exact executable acceptance required');
for(const file of current.files){
 if(sha(readFileSync('supabase/functions/'+file.path))!==file.sha256||
  sha(readFileSync(join(bundleDir,'stage/supabase/functions',file.path)))!==file.sha256)throw Error('Runtime source changed');
}
for(const e of current.endpoints){
 const a=bundle.endpoints.find(a=>a.name===e.name),b=boot.artifacts.find(b=>b.name===e.name),c=boot.checks.find(c=>c.name===e.name);
 const bytes=readFileSync(join(bundleDir,'artifacts',e.name+'.eszip'));
 if(!a||a.verifyJwt!==e.verifyJwt||bytes.length!==a.bytes||sha(bytes)!==a.eszipSha256||b?.eszipSha256!==a.eszipSha256||!c?.denied||![401,403].includes(c.status))throw Error('Exact runtime evidence changed');
}
mkdirSync(destination,{mode:0o700});mkdirSync(join(destination,'artifacts'),{mode:0o700});mkdirSync(join(destination,'boot-carried-forward'),{mode:0o700});
const derivation={state:'unchanged_runtime_evidence_carried_forward',observedAt:new Date().toISOString(),
 priorManifestSha256:sha(oldBytes),currentManifestSha256:sha(currentBytes),
 originalBundleReportSha256:sha(bundleBytes),originalBootReportSha256:sha(bootBytes),
 sqlRehearsalReportSha256:sha(readFileSync(rehearsalPath)),
 runtimeInputsUnchanged:true,artifactBytesUnchanged:true,newBootExecution:false,productionChanged:false,
 explanation:'Only the ordered SQL package set changed. All endpoint metadata, source bytes, entrypoints and JWT settings remain identical. These exact retained executable bytes passed the original offline boot; package 020 passed a separate full-schema recurring capture rehearsal.'};
for(const file of current.files){const path=join(destination,'stage/supabase/functions',file.path);mkdirSync(dirname(path),{recursive:true,mode:0o700});copyFileSync(join(bundleDir,'stage/supabase/functions',file.path),path);}
for(const e of current.endpoints)copyFileSync(join(bundleDir,'artifacts',e.name+'.eszip'),join(destination,'artifacts',e.name+'.eszip'));
const save=(name,value)=>writeFileSync(join(destination,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
save('report.json',{...bundle,manifestSha256:sha(currentBytes),derivation});
save('boot-carried-forward/report.json',{...boot,manifestSha256:sha(currentBytes),derivation});
save('derivation.json',derivation);
console.log(JSON.stringify({state:derivation.state,endpoints:current.endpoints.length,newBootExecution:false,productionChanged:false}));
