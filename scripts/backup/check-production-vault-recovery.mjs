/** Read-only source key/aggregate, private stdin transport to an offline restore. */
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {openSync,closeSync,readFileSync,writeFileSync} from 'node:fs';
import {savedCliToken} from '../verify/learn-test-readiness.mjs';
const checkpoint=process.argv[2]==='--verify-release-checkpoint'&&process.argv.length===4&&/^\.verification-results\/production-release-checkpoint-[0-9]{8}-[a-z0-9-]+$/.test(process.argv[3]);
if(!checkpoint&&process.argv.slice(2).join(' ')!=='--verify-existing-production-archive')throw Error('Explicit isolated recovery required');
const root=checkpoint?process.argv[3]:'.verification-results/production-database-complete-capture-small-full-2026-10-12';
const exported=JSON.parse(readFileSync(root+'/report.json'));
const snapshotAt=exported?.snapshot?.observedAt;
if(typeof snapshotAt!=='string'||!/^20\d\d-\d\d-\d\dT[\d:.]+(?:Z|\+00:00)$/.test(snapshotAt))throw Error('Recovery snapshot time unavailable');
const restored=JSON.parse(readFileSync(root+'/restore-native-comparison-report.json'));
if(!restored.containerRemoved||!restored.allInventoriedPhysicalTablesCaptured)throw Error('Completed isolated restore required');
const attempt=randomUUID();
closeSync(openSync(root+'/vault-recovery-started-'+attempt,'wx',0o600));
let stage='source_comparison',http=null,category=null;
const token=savedCliToken(),ref='tgbnakbxwcqjeimygroz',challenge=randomBytes(32).toString('hex');
async function api(path,body){const r=await fetch('https://api.supabase.com/v1/projects/'+ref+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});http=r.status;if(!r.ok){const raw=await r.text();category=/invalid ciphertext/i.test(raw)?'invalid_ciphertext':/permission denied/i.test(raw)?'permission_denied':/does not exist/i.test(raw)?'missing_function_or_object':'request_rejected';throw Error('Source recovery request rejected');}return r.json();}
try{
 const query=`select json_build_object('count',count(*),'digest',md5(string_agg(id::text||':'||encode(extensions.hmac(convert_to(decrypted_secret,'UTF8'),decode('${challenge}','hex'),'sha256'),'hex'),',' order by id))) expected,(select md5(jsonb_agg(to_jsonb(s) order by id)::text) from vault.secrets s) ciphertext,(select count(*)::int from vault.secrets s where s.updated_at > '${snapshotAt}'::timestamptz) changed_after_snapshot from vault.decrypted_secrets;`;
 // Vault denies the API's restricted read-only role. Existing administrator
 // access executes a transaction explicitly marked READ ONLY; no grants change.
 const rows=await api('/database/query',{query:"begin read only;set local timezone='UTC';"+query+'commit;'});
 if(rows.length!==1||rows[0].expected.count<1||!/^[a-f0-9]{32}$/.test(rows[0].ciphertext))throw Error('Vault source comparison unavailable');
 stage='root_key_read';const config=await api('/pgsodium');
 if(typeof config.root_key!=='string'||!/^[a-f0-9]{64}$/i.test(config.root_key))throw Error('Unexpected root key format');
 stage='offline_restore';const child=spawn('python3',['-B','scripts/backup/verify_production_vault_recovery.py'],{stdio:['pipe','inherit','ignore']});
 child.stdin.on('error',()=>{});
 child.stdin.end(JSON.stringify({source:root,rootKey:config.root_key,challenge,expected:rows[0].expected,ciphertextDigest:rows[0].ciphertext,changedAfterSnapshot:rows[0].changed_after_snapshot,snapshotAt}));
 config.root_key='';
 const code=await new Promise((resolve,reject)=>{child.once('close',resolve);child.once('error',()=>reject(Error('Offline recovery runner unavailable')));});
 process.exitCode=code===0?0:1;
}catch{writeFileSync(root+'/vault-recovery-source-failure-'+attempt+'.json',JSON.stringify({state:'source_or_runner_unavailable',stage,http,category,secretsPrinted:false})+'\n',{flag:'wx',mode:0o600});console.error(JSON.stringify({state:'vault_recovery_not_verified',stage,http,category,secretsPrinted:false}));process.exitCode=1;}
