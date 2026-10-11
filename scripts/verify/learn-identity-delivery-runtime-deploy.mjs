/** Install the atomic identity/card worker in TEST; no provider or capture activation. */
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { edgeRuntimeBundle } from './learn-email-runtime-edge-bundle.mjs';
import { deployPinnedTestRuntime } from './learn-test-email-runtime-deploy.mjs';
import { readIdentityCatalog, identityInstalledSnapshot } from './learn-identity-delivery-catalog.mjs';
import { communicationQuery } from './learn-card-communication-catalog.mjs';
import { TEST_PROJECT, savedCliToken } from './learn-test-readiness.mjs';
export const IDENTITY_ENDPOINTS = [{name:'platform-worker',verifyJwt:false}];
export const IDENTITY_SHA = 'a8f639ff57f282bf51b074672c73b7bf72fad168cb4aa5d01ea4d47a20dc33c7';
export const IDENTITY_RUNTIME_SCHEMA = 'a4873239b21870196119b953c51adeca';
export const IDENTITY_FULL_SCHEMA = '851ab50d52a8d36ea1ee728c0a3f3ecf';
export const identityBundle = () => edgeRuntimeBundle(IDENTITY_ENDPOINTS);
const stable = rows => JSON.stringify([...rows].sort((a,b)=>a.name.localeCompare(b.name)));
export async function deployIdentityDelivery(args, {catalog=readIdentityCatalog,query=communicationQuery,deploy=deployPinnedTestRuntime}={}) {
  if(args.allowProjectRef!==TEST_PROJECT || Object.keys(args.replaceVersions??{}).length) throw Error('Exact TEST worker replacement only');
  if(identityBundle().sha256!==IDENTITY_SHA) throw Error('Identity delivery source differs');
  const before=await catalog(args.token);
  if(before.fingerprint!==IDENTITY_FULL_SCHEMA) throw Error('TEST release 062 required');
  const snapshot=identityInstalledSnapshot(before.catalog.phone), rows=await query(args.token,snapshot);
  if(rows.length!==116 || new Set(rows.map(r=>r.name)).size!==116) throw Error('Full preservation baseline required');
  const result=await deploy({...args,replaceVersions:{'platform-worker':8},persistJournal:journal=>args.persistJournal({...journal,fullSchema:before.fingerprint,fullPreserved:rows})},{
    bundle:identityBundle,endpoints:IDENTITY_ENDPOINTS,bundleSha:IDENTITY_SHA,databaseFingerprint:IDENTITY_RUNTIME_SCHEMA,
    version:'learn-identity-delivery-runtime/1',stagePrefix:'learn-identity-delivery-runtime-',
  });
  const [after,afterRows]=await Promise.all([catalog(args.token),query(args.token,snapshot)]);
  const preserved=after.fingerprint===before.fingerprint && stable(rows)===stable(afterRows);
  return {...result,state:preserved?result.state:'requires_inspection',fullPreservedDatasets:preserved?116:null,fullSchemaUnchanged:after.fingerprint===before.fingerprint,secretsCreated:0,schedulesActivated:0,providerRequests:0,productionChanged:false};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.slice(2).join(' ')!=='--deploy --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT) throw Error('Explicit TEST deployment required');
    const prefix='.verification-results/identity-delivery-runtime-deploy';
    const result=await deployIdentityDelivery({allowProjectRef:TEST_PROJECT,token:savedCliToken(),persistJournal:async journal=>{
      const fd=openSync(prefix+'-journal.json','wx',0o600);try{writeSync(fd,JSON.stringify(journal,null,2));fsyncSync(fd);}finally{closeSync(fd);}
    },onProgress:r=>console.log(JSON.stringify(r))});
    writeFileSync(prefix+'-result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result,null,2));
    if(result.state!=='deployed_needs_http_acceptance')process.exitCode=1;
  }catch(e){console.error('Identity delivery deployment unconfirmed; inspect journal and inventory before retry: '+e.message);process.exitCode=1;}
}
