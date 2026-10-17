/** Short-lived, exact-name Edge runtime seal. TEST returns synthetic values;
 * LIVE only prepares a local age ciphertext after active-digest comparison.
 * No recovery private key, plaintext file, provider call or off-site upload.
 */
import assert from 'node:assert/strict';
import { createHash, createDecipheriv, generateKeyPairSync, privateDecrypt,
  randomBytes, constants } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync }
  from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { savedCliToken, TEST_PROJECT } from '../verify/learn-test-readiness.mjs';
import { REQUIRED_NAMES, OPTIONAL_NAMES, ADDITIONAL_NAMES } from './edge-runtime-seal.mjs';

const LIVE_PROJECT='tgbnakbxwcqjeimygroz';
const SLUG=`build01-edge-recovery-${randomBytes(6).toString('hex')}`;
const CLI='/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase';
const mode=process.argv.slice(2).join(' ');
const additional=mode==='--synthetic-test-additional'||
 mode==='--prepare-reviewed-live-additional-copy';
const test=mode==='--synthetic-test'||mode==='--synthetic-test-additional';
const live=mode==='--prepare-approved-live-copy'||
 mode==='--prepare-reviewed-live-additional-copy';
if(!test&&!live)throw Error('Exact synthetic TEST or reviewed LIVE seal mode required');
const requiredNames=additional?ADDITIONAL_NAMES:REQUIRED_NAMES;
const optionalNames=additional?[]:OPTIONAL_NAMES;
const project=test?TEST_PROJECT:LIVE_PROJECT;
if(process.env[test?'LEARN_TEST_ALLOW_PROJECT_REF':'LEARN_LIVE_ALLOW_PROJECT_REF']!==project)
 throw Error('Explicit project allowlist required');
if(!existsSync(CLI))throw Error('Pinned Supabase CLI unavailable');
const sha=value=>createHash('sha256').update(value).digest('hex');
const token=savedCliToken();
const management=`https://api.supabase.com/v1/projects/${project}`;
async function inventory(){
 const response=await fetch(`${management}/functions`,{
  headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`Function inventory HTTP ${response.status}`);
 const rows=await response.json();
 if(!Array.isArray(rows)||new Set(rows.map(row=>row.slug)).size!==rows.length)
  throw Error('Function inventory changed');
 return rows;
}
async function serviceKey(){
 const response=await fetch(`${management}/api-keys?reveal=true`,{
  headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`Service key read HTTP ${response.status}`);
 const rows=await response.json();
 const matches=Array.isArray(rows)?rows.filter(row=>row.name==='service_role'):[];
 if(matches.length!==1||typeof matches[0].api_key!=='string')throw Error('Service key shape changed');
 const key=matches[0].api_key;
 const parts=key.split('.');
 if(parts.length!==3)throw Error('Service key format changed');
 const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
 if(claims.ref!==project||claims.role!=='service_role')throw Error('Service key scope changed');
 return key;
}
async function remove(){
 const response=await fetch(`${management}/functions/${SLUG}`,{
  method:'DELETE',headers:{Authorization:`Bearer ${token}`},redirect:'error',
  signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`One-time function removal HTTP ${response.status}`);
 if((await inventory()).some(row=>row.slug===SLUG))throw Error('One-time function removal unverified');
}
const before=await inventory();
if(before.some(row=>row.slug===SLUG))throw Error('One-time function already exists; inspect before changing it');
const otherFunctions=rows=>JSON.stringify(rows.filter(row=>row.slug!==SLUG)
 .map(row=>[row.slug,row.version,row.ezbr_sha256,row.status,row.verify_jwt])
 .sort((a,b)=>a[0].localeCompare(b[0])));
const baseline=otherFunctions(before);
const service=await serviceKey();
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072,publicExponent:65537});
const spki=publicKey.export({type:'spki',format:'der'});
const nonce=randomBytes(48).toString('base64url');
const expiresAtMs=Date.now()+15*60*1000;
const binding={project,serviceSha256:sha(service),nonceSha256:sha(nonce),spkiSha256:sha(spki),expiresAtMs,
 ...(additional?{scope:'full-runtime-additional/1'}:{})};
const journalPath=`.verification-results/build01-edge-recovery-${additional?'additional-':''}${test?'test':'live'}-pending.json`;
if(existsSync(journalPath))throw Error('Earlier one-time recovery requires inspection before another deployment');
const root=mkdtempSync(join(tmpdir(),'build01-edge-runtime-seal-'));
const stage=join(root,'stage'),endpoint=join(stage,'supabase/functions',SLUG);
mkdirSync(endpoint,{recursive:true,mode:0o700});
const template=readFileSync('scripts/backup/edge-runtime-once.index.template.ts','utf8');
assert(template.includes('__BUILD01_RECOVERY_BINDING__'));
let index=template.replace('__BUILD01_RECOVERY_BINDING__',JSON.stringify(binding));
if(test){
 const synthetic=Object.fromEntries([...requiredNames,...optionalNames]
  .map(name=>[name,`synthetic:${name}:never-live`]));
 index=index.replace('env: (name: string) => Deno.env.get(name),',
  `env: (name: string) => name === 'SUPABASE_URL'
    ? Deno.env.get(name) : (${JSON.stringify(synthetic)})[name],`);
}
writeFileSync(join(endpoint,'index.ts'),index,{mode:0o600});
writeFileSync(join(endpoint,'seal.mjs'),readFileSync('scripts/backup/edge-runtime-seal.mjs'),{mode:0o600});
writeFileSync(join(stage,'supabase/config.toml'),
 `project_id = "${project}"\n[functions.${SLUG}]\nverify_jwt = true\n`,{mode:0o600});
let attemptedDeploy=false,deployed=false,removed=false,prepared=null,stageError=null;
try{
 writeFileSync(journalPath,JSON.stringify({project,slug:SLUG,expiresAtUtc:new Date(expiresAtMs).toISOString(),
  state:'deployment_attempted'},null,2)+'\n',{flag:'wx',mode:0o600});
 attemptedDeploy=true;
 const result=spawnSync(CLI,['functions','deploy',SLUG,'--project-ref',project,'--use-api','--workdir',stage],{
  env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024});
 if(result.status!==0)throw Error(`One-time function deploy failed (${result.status})`);
 deployed=true;
 const installed=(await inventory()).find(row=>row.slug===SLUG);
 if(!installed||installed.status!=='ACTIVE'||installed.verify_jwt!==true||
    otherFunctions(await inventory())!==baseline)
  throw Error('One-time function deployment readback changed');
 const endpointUrl=`https://${project}.supabase.co/functions/v1/${SLUG}`;
 const invoke=async suppliedNonce=>fetch(endpointUrl,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
  headers:{authorization:`Bearer ${service}`,apikey:service,
   'x-build01-recovery-nonce':suppliedNonce,'content-type':'application/json'},
  body:JSON.stringify({spki:spki.toString('base64')})});
 const denied=await invoke(randomBytes(48).toString('base64url'));
 if(denied.status!==401)throw Error(`One-time route wrong-nonce gate changed (${denied.status})`);
 const response=await invoke(nonce);
 if(response.status!==200)throw Error(`One-time route unavailable (${response.status})`);
 const wire=await response.text();
 if(wire.length>2*1024*1024)throw Error('Sealed response too large');
 const envelope=JSON.parse(wire);
 if(envelope.format!=='serviceos-build01-edge-runtime-sealed-envelope/1'||
    envelope.project!==project||typeof envelope.wrappedKey!=='string'||
    typeof envelope.iv!=='string'||typeof envelope.ciphertext!=='string')
  throw Error('Sealed response shape changed');
 const aesKey=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,
  oaepHash:'sha256'},Buffer.from(envelope.wrappedKey,'base64'));
 let plain;
 try{
  const iv=Buffer.from(envelope.iv,'base64');
  const cipher=Buffer.from(envelope.ciphertext,'base64');
  if(iv.length!==12||cipher.length<16||cipher.length>1024*1024)
   throw Error('Sealed response length changed');
  const decipher=createDecipheriv('aes-256-gcm',aesKey,iv);
  decipher.setAuthTag(cipher.subarray(-16));
  plain=Buffer.concat([decipher.update(cipher.subarray(0,-16)),decipher.final()]);
  const recovered=JSON.parse(plain.toString('utf8'));
  const names=Object.keys(recovered.selected??{}).sort();
  if(recovered.format!=='serviceos-build01-edge-runtime-seal/1'||recovered.project!==project||
     requiredNames.some(name=>!names.includes(name))||
     names.some(name=>![...requiredNames,...optionalNames].includes(name)))
   throw Error('Recovered scope changed');
  if(test){
   for(const name of names)if(recovered.selected[name]!==`synthetic:${name}:never-live`)
    throw Error('Synthetic sealed value changed');
   prepared={state:'synthetic_hosted_seal_verified',scope:additional?'full-runtime-additional':'build01',selectedCount:names.length,
    deniedWrongNonce:true,encryptedOnWire:true,realCredentialRead:false};
  }else{
   const selected=Object.fromEntries(names.map(name=>[name,{
    value:recovered.selected[name],sourceRef:`live-edge-runtime:${project}:${SLUG}:v${installed.version}`} ]));
   const input=Buffer.from(JSON.stringify({project,selected}));
   try{
    const staged=spawnSync(process.execPath,
     ['scripts/backup/stage_build01_edge_secret_package.mjs','--prepare-approved-live-copy'],{
      input,env:process.env,encoding:'utf8',timeout:60000,maxBuffer:32768});
    if(staged.status!==0)throw Error('Active-digest comparison or age stage failed');
    prepared=JSON.parse(staged.stdout);
    if(prepared.state!=='encrypted_package_prepared_locally'||prepared.selectedCount!==names.length)
     throw Error('Age package receipt changed');
   }finally{input.fill(0);}
  }
 }finally{plain?.fill(0);aesKey.fill(0);}
}catch(error){stageError=error;}
finally{
 try{if(attemptedDeploy&&(await inventory()).some(row=>row.slug===SLUG)){
  await remove();removed=true;
 }else if(!deployed)removed=true;}catch(error){
  stageError??=error;
 }
 rmSync(root,{recursive:true,force:true});
 if(removed)try{unlinkSync(journalPath);}catch{/* May already be absent. */}
}
if(stageError)throw Error(`${stageError.message}; one-time endpoint removed=${removed}`);
assert(prepared&&removed&&otherFunctions(await inventory())===baseline,
 'One-time seal cleanup or environment changed');
  console.log(JSON.stringify({...prepared,project,scope:additional?'full-runtime-additional':'build01',endpointRemoved:true,
  otherFunctionsUnchanged:true,providerRequests:0,offsiteCopyMade:false,
  completedAt:new Date().toISOString()}));
