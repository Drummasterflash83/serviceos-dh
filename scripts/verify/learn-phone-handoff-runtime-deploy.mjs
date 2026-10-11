/** Install the atomic phone handoff runtime in TEST; no provider or capture activation. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { edgeRuntimeBundle } from './learn-email-runtime-edge-bundle.mjs';
import { deployPinnedTestRuntime } from './learn-test-email-runtime-deploy.mjs';
import { readHandoffCatalog, handoffInstalledSnapshot } from './learn-phone-handoff-catalog.mjs';
import { communicationQuery } from './learn-card-communication-catalog.mjs';
import { TEST_PROJECT, savedCliToken } from './learn-test-readiness.mjs';
export const HANDOFF_ENDPOINTS = [{name:'phone-process-pipeline',verifyJwt:true}];
export const HANDOFF_SHA = '47aef9f89a44c452c02bcb829b77206914941c3401714e18f11830848a537c1b';
export const HANDOFF_RUNTIME_SCHEMA = '4246b7cc2a9984347873e0ff4ec9d92d';
export const HANDOFF_FULL_SCHEMA = '9780c9f11e60e5219a52088e53a4e6ff';
export const handoffBundle = () => edgeRuntimeBundle(HANDOFF_ENDPOINTS);
const stable = rows => JSON.stringify([...rows].sort((a,b)=>a.name.localeCompare(b.name)));
export async function deployPhoneHandoff(args, {catalog=readHandoffCatalog,query=communicationQuery,deploy=deployPinnedTestRuntime}={}) {
  if(args.allowProjectRef!==TEST_PROJECT || Object.keys(args.replaceVersions??{}).length) throw Error('Exact TEST pipeline replacement only');
  if(handoffBundle().sha256!==HANDOFF_SHA) throw Error('Phone handoff source differs');
  const before=await catalog(args.token);
  if(before.fingerprint!==HANDOFF_FULL_SCHEMA) throw Error('TEST release 061 required');
  const snapshot=handoffInstalledSnapshot(before.catalog.phone), rows=await query(args.token,snapshot);
  if(rows.length!==115 || new Set(rows.map(r=>r.name)).size!==115) throw Error('Full preservation baseline required');
  const result=await deploy({...args,replaceVersions:{'phone-process-pipeline':1},persistJournal:journal=>args.persistJournal({...journal,fullSchema:before.fingerprint,fullPreserved:rows})},{
    bundle:handoffBundle,endpoints:HANDOFF_ENDPOINTS,bundleSha:HANDOFF_SHA,databaseFingerprint:HANDOFF_RUNTIME_SCHEMA,
    version:'learn-phone-handoff-runtime/1',stagePrefix:'learn-phone-handoff-runtime-',
  });
  const [after,afterRows]=await Promise.all([catalog(args.token),query(args.token,snapshot)]);
  const preserved=after.fingerprint===before.fingerprint && stable(rows)===stable(afterRows);
  return {...result,state:preserved?result.state:'requires_inspection',fullPreservedDatasets:preserved?115:null,fullSchemaUnchanged:after.fingerprint===before.fingerprint,secretsCreated:0,schedulesActivated:0,providerRequests:0,productionChanged:false};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.slice(2).join(' ')!=='--deploy --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT) throw Error('Explicit TEST deployment required');
    const prefix='.verification-results/phone-handoff-runtime-deploy';
    const result=await deployPhoneHandoff({allowProjectRef:TEST_PROJECT,token:savedCliToken(),persistJournal:async journal=>{
      const fd=openSync(prefix+'-journal.json','wx',0o600);try{writeSync(fd,JSON.stringify(journal,null,2));fsyncSync(fd);}finally{closeSync(fd);}
    },onProgress:r=>console.log(JSON.stringify(r))});
    writeFileSync(prefix+'-result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result,null,2));
    if(result.state!=='deployed_needs_http_acceptance')process.exitCode=1;
  }catch(e){console.error('Phone handoff deployment unconfirmed; inspect journal and inventory before retry: '+e.message);process.exitCode=1;}
}
