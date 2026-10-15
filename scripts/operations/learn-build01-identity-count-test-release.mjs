/** Exact TEST release of the isolated-rehearsed identity count optimization. */
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { savedCliToken,TEST_PROJECT } from '../verify/learn-test-readiness.mjs';

if(process.argv.slice(2).join(' ')!=='--test --existing-cli-login' ||
 process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)
 throw Error('Explicit TEST identity count release required');
const token=savedCliToken();
const file='supabase/migrations/20261104030000_learn_identity_set_based_draft_count.sql';
const source=readFileSync(file,'utf8');
const digest=createHash('sha256').update(source).digest('hex');
if(digest!=='a71c9200da8b500b69b836efe74bf4504a13a25e61774bd08c6d69d9bfde6f52')
 throw Error('Reviewed identity count patch changed');
const signature="'public.learn_identity_deliver_internal(uuid,uuid,uuid,text,text,uuid)'::regprocedure";
const catalog=`select md5(pg_get_functiondef(${signature})) definition_md5,
 pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.prosecdef security_definer,
 (select count(*)::int from public.interactions) interactions,
 (select count(*)::int from public.customer_cards) cards,
 (select count(*)::int from public.learn_identity_delivery_receipts) delivery_receipts,
 (select count(*)::int from public.platform_jobs j join public.tenants t on t.id=j.tenant_id and t.status='active'
  where j.job_type='identity.resolve' and j.status in('queued','running','retrying')) active_identity_jobs,
 (select count(*)::int from public.platform_jobs j join public.tenants t on t.id=j.tenant_id and t.status='archived'
  where j.job_type='identity.resolve' and j.status in('queued','running','retrying')) archived_fixture_jobs
 from pg_catalog.pg_proc p where p.oid=${signature}`;
async function sql(query,write=false){
 const response=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${write?'':'/read-only'}`,{
  method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify({query,...(write?{read_only:false}:{})}),redirect:'error',signal:AbortSignal.timeout(45000)
 });
 if(!response.ok)throw Error(`TEST query ${write?'write':'read'} HTTP ${response.status}`);
 const rows=await response.json();if(!Array.isArray(rows))throw Error('TEST SQL response malformed');return rows;
}
const before=(await sql(catalog))[0];
console.log(JSON.stringify({testPreflight:{definitionMd5:before?.definition_md5,
 owner:before?.owner,acl:before?.acl,securityDefiner:before?.security_definer,
 activeIdentityJobs:before?.active_identity_jobs}}));
if(!before||before.definition_md5!=='60adf2eca5be0f1c0aaa97765364eeca'||
 before.owner!=='postgres'||before.acl!=='{postgres=X/postgres}'||
 before.security_definer!==true||before.active_identity_jobs!==0||
 before.archived_fixture_jobs!==1)
 throw Error('TEST identity baseline or idle queue differs');
const prefix='.verification-results/build01-identity-count-test-'+Date.now();
const journal={version:'build01-identity-count-test-release/1',project:TEST_PROJECT,
 patchSha256:digest,before,startedAt:new Date().toISOString(),writeAttempted:false};
writeFileSync(prefix+'-journal.json',JSON.stringify(journal,null,2)+'\n',{flag:'wx',mode:0o600});
let applyError=null;
try {journal.writeAttempted=true;await sql(source,true);}catch(error){applyError=error instanceof Error?error.message:'unknown';}
const after=(await sql(catalog))[0];
const preserved=after&&after.definition_md5==='5011f602b2f116993cae60d291a660bd'&&
 after.owner===before.owner&&after.acl===before.acl&&after.security_definer===before.security_definer&&
 after.interactions===before.interactions&&after.cards===before.cards&&
 after.delivery_receipts===before.delivery_receipts&&after.active_identity_jobs===0&&
 after.archived_fixture_jobs===before.archived_fixture_jobs;
const result={version:journal.version,project:TEST_PROJECT,patchSha256:digest,
 state:preserved?'test_identity_count_patch_installed':'requires_inspection',
 applyResponseUncertain:!!applyError,before,after,productionWrites:false,
 observedAt:new Date().toISOString()};
writeFileSync(prefix+'-result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({state:result.state,applyResponseUncertain:result.applyResponseUncertain,
 beforeDigest:before.definition_md5,afterDigest:after?.definition_md5,productionWrites:false}));
if(!preserved)process.exitCode=1;
