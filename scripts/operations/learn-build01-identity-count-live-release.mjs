/** Release the exact TEST-proven identity count fix between ordinary LIVE retries. */
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { savedCliToken } from '../verify/learn-test-readiness.mjs';

if(process.argv.slice(2).join(' ')!=='--live --existing-cli-login' ||
 process.env.LEARN_PRODUCTION_READ_ONLY_PROJECT!=='tgbnakbxwcqjeimygroz')
 throw Error('Explicit LIVE identity count release required');
const project='tgbnakbxwcqjeimygroz';
const tenant='00000000-0000-0000-0000-000000000001';
const token=savedCliToken();
const file='supabase/migrations/20261104030000_learn_identity_set_based_draft_count.sql';
const source=readFileSync(file,'utf8');
const sha=createHash('sha256').update(source).digest('hex');
if(sha!=='a71c9200da8b500b69b836efe74bf4504a13a25e61774bd08c6d69d9bfde6f52')
 throw Error('TEST-proven patch changed');
const signature="'public.learn_identity_deliver_internal(uuid,uuid,uuid,text,text,uuid)'::regprocedure";
async function sql(query,write=false){
 const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${write?'':'/read-only'}`,{
  method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify({query,...(write?{read_only:false}:{})}),redirect:'error',signal:AbortSignal.timeout(45000)
 });
 if(!r.ok)throw Error(`LIVE query ${write?'write':'read'} HTTP ${r.status}`);
 const rows=await r.json();if(!Array.isArray(rows))throw Error('LIVE SQL response malformed');return rows;
}
const catalog=`select pg_get_functiondef(p.oid) definition,
 md5(pg_get_functiondef(p.oid)) definition_md5,
 pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.prosecdef security_definer,
 (select count(*)::int from public.interactions where tenant_id='${tenant}'::uuid) interactions,
 (select count(*)::int from public.customer_cards where tenant_id='${tenant}'::uuid) cards,
 (select count(*)::int from public.learn_identity_delivery_receipts where tenant_id='${tenant}'::uuid) delivery_receipts,
 (select count(*)::int from public.platform_jobs where job_type='identity.resolve' and status='running') running_identity_jobs,
 (select count(*)::int from public.platform_jobs where tenant_id='${tenant}'::uuid and job_type='identity.resolve' and status='retrying') retrying_tenant_jobs,
 (select min(next_run_at) from public.platform_jobs where tenant_id='${tenant}'::uuid and job_type='identity.resolve' and status='retrying') next_retry_at
 from pg_catalog.pg_proc p where p.oid=${signature}`;
const before=(await sql(catalog))[0];
if(!before||before.definition_md5!=='60adf2eca5be0f1c0aaa97765364eeca'||
 before.owner!=='postgres'||before.acl!=='{postgres=X/postgres}'||
 before.security_definer!==true||before.running_identity_jobs!==0||
 before.retrying_tenant_jobs!==1||Date.parse(before.next_retry_at)<Date.now()+45000)
 throw Error('LIVE baseline, idle window or ordinary retry changed');
const prefix='.verification-results/build01-identity-count-live-'+Date.now();
writeFileSync(prefix+'-rollback.sql',before.definition+'\n',{flag:'wx',mode:0o600});
writeFileSync(prefix+'-journal.json',JSON.stringify({version:'build01-identity-count-live-release/1',
 project,patchSha256:sha,startedAt:new Date().toISOString(),before:{...before,definition:undefined},
 rollbackFile:prefix+'-rollback.sql',writeAttempted:false},null,2)+'\n',{flag:'wx',mode:0o600});
let applyError=null;
try{await sql(source,true);}catch(error){applyError=error instanceof Error?error.message:'unknown';}
const after=(await sql(catalog))[0];
const valid=after&&after.definition_md5==='5011f602b2f116993cae60d291a660bd'&&
 after.owner===before.owner&&after.acl===before.acl&&after.security_definer===before.security_definer&&
 after.interactions>=before.interactions&&after.cards>=before.cards&&
 after.delivery_receipts>=before.delivery_receipts;
const result={version:'build01-identity-count-live-release/1',project,patchSha256:sha,
 state:valid?'live_identity_count_patch_installed':'requires_inspection',
 applyResponseUncertain:!!applyError,
 before:{...before,definition:undefined},after:{...after,definition:undefined},
 sourceRowsDeleted:after?Math.max(0,before.interactions-after.interactions):null,
 cardsDeleted:after?Math.max(0,before.cards-after.cards):null,
 deliveryReceiptsDeleted:after?Math.max(0,before.delivery_receipts-after.delivery_receipts):null,
 observedAt:new Date().toISOString()};
writeFileSync(prefix+'-result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({state:result.state,applyResponseUncertain:result.applyResponseUncertain,
 beforeDigest:before.definition_md5,afterDigest:after?.definition_md5,
 sourceRowsDeleted:result.sourceRowsDeleted,cardsDeleted:result.cardsDeleted,
 deliveryReceiptsDeleted:result.deliveryReceiptsDeleted}));
if(!valid)process.exitCode=1;
