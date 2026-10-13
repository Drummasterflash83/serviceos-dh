/** Read-only reconciliation of the recorded first production runtime install. */
import{readFileSync,writeFileSync}from'node:fs';
import{createHash}from'node:crypto';
import{savedCliToken}from'./learn-test-readiness.mjs';
import{runtimeDigest,proveUniformVersionIncrement}from'./learn-quickbooks-runtime-inventory.mjs';
const root='.verification-results/quickbooks-production-runtime-v1/',plan=JSON.parse(readFileSync(root+'plan.json')),journal=JSON.parse(readFileSync(root+'journal.json')),project='tgbnakbxwcqjeimygroz';
if(plan.project!==project||journal.project!==project||journal.endpoints.length!==4)throw Error('Unexpected recorded install');
const token=savedCliToken();
async function api(path,query){const r=await fetch(`https://api.supabase.com/v1/projects/${project}${path}`,{method:query?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(query?{body:JSON.stringify({query})}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Readback unavailable');return r.json();}
const all=await api('/functions'),names=journal.endpoints.map(f=>f.name),existing=all.filter(f=>!names.includes(f.slug));
const proof=proveUniformVersionIncrement(existing,plan.existingEndpointsSha256);if(!proof.verified)throw Error('Existing inventory differs beyond the observed one-version increment');
for(const wanted of journal.endpoints){const found=all.find(f=>f.slug===wanted.name);if(!found||found.version!==wanted.version||found.ezbr_sha256!==wanted.hash||found.verify_jwt!==wanted.verifyJwt||found.status!==wanted.status)throw Error('QuickBooks runtime changed');}
const secrets=await api('/secrets'),unchanged=secrets.filter(x=>!plan.settings.some(s=>s.name===x.name)).map(({name,value})=>({name,value})).sort((a,b)=>a.name.localeCompare(b.name));
if(createHash('sha256').update(JSON.stringify(unchanged)).digest('hex')!==plan.existingSecretFingerprintsSha256)throw Error('Existing secret fingerprints changed');
for(const s of plan.settings)if(secrets.find(x=>x.name===s.name)?.value!==createHash('sha256').update(s.value).digest('hex'))throw Error('Non-secret configuration differs');
const counts=(await api('/database/query/read-only',"select (select count(*) from learn_quickbooks_apps) apps,(select count(*) from learn_quickbooks_connections) connections,(select count(*) from learn_quickbooks_imports) imports,(select count(*) from learn_quickbooks_pages) pages,(select count(*) from learn_quickbooks_source_versions) versions"))[0];
if(Object.keys(plan.counts).some(k=>counts[k]!==plan.counts[k]))throw Error('Inert counts changed');
const report={checkedAt:new Date().toISOString(),project,state:'runtime_preservation_reconciled',originalAttemptState:journal.state,proof,currentExistingDigest:runtimeDigest(existing),codeHashesJwtSettingsNamesAndStatusesUnchanged:true,existingSecretFingerprintsUnchanged:true,nonSecretSettingsMatch:true,inertCounts:counts,quickBooksRuntimeMetadataMatches:true,productionWrites:0,providerRequests:0,interpretation:'The complete original inventory fingerprint is recovered by subtracting exactly one from all 97 prior version counters. No other protected metadata differs. The increment followed adding the two runtime settings; attribution to platform configuration propagation is an inference, not a retrieved platform audit event.',limits:['Metadata/code-preservation evidence, not proof that every existing provider workflow is healthy.','No production QuickBooks company is connected.']};
writeFileSync(root+'reconciliation.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
