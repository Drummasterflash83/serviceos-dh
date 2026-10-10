/** Synthetic package checks only. No database, provider or local customer data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyPackage,canonicalContractPayload,verifyImportOrder,REQUIRED_FILES,parseCsv} from './lib/package-contract.mjs';
import {GOVERNED_PROFILES} from './lib/prepare-canonical-core.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const digest=t=>({sha256:sha(t),rows:parseCsv(t).length-1});
function fixture({crossCustomer=false,badPhone=false}={}){
 const records={customers:[{source_system:'commusoft',external_id:'1',record_kind:'person',display_name:'SYNTHETIC PRIVATE NAME',primary_phone:badPhone?'not a phone':'',active:'true'},{source_system:'commusoft',external_id:'2',record_kind:'company_contact',company_name:'SYNTHETIC COMPANY',active:'true'}],sites:[{source_system:'commusoft',external_id:'10',customer_external_id:'1',active:'true'}],jobs:[{source_system:'commusoft',external_id:'20',job_number:'20',customer_external_id:crossCustomer?'2':'1',site_external_id:'10',status:'completed',active:'false'}]};
 const files=Object.fromEntries(Object.entries(REQUIRED_FILES).map(([name,s])=>[name,s.columns.join(',')+'\n'+records[s.entity].map(r=>s.columns.map(c=>r[c]??'').join(',')).join('\n')+'\n']));
 const provenance={sources:{customers_export:{sha256:'a'.repeat(64),provenance_class:'locally_sealed_recovered_export',register_verified:false},work_addresses_export:{sha256:'b'.repeat(64),provenance_class:'locally_sealed_recovered_export',register_verified:false}}};
 const manifest={package_name:'commusoft_canonical',package_version:4,prepared_at:'2026-08-05T00:00:00Z',output:Object.fromEntries(Object.entries(files).map(([n,t])=>[n,digest(t)])),schemas:Object.fromEntries(Object.values(REQUIRED_FILES).map(s=>[s.schemaKey,s.columns])),profiles:structuredClone(GOVERNED_PROFILES),data_quality:{contract:'synthetic',exclusions:{},total_excluded_cells:0},sources:Object.fromEntries(Object.entries(provenance.sources).map(([k,v])=>[k,{sha256:v.sha256}])),qa:{jobs:{rows:1}},gap_classification:null};
 manifest.contract_seal=sha(canonicalContractPayload(manifest));return {manifest,files,provenance};
}
const verify=f=>verifyPackage({...f,digest,manifestSeal:sha(canonicalContractPayload(f.manifest))});
test('valid current profile cells and exact same-customer site links pass',()=>{
 const r=verify(fixture());assert.equal(r.ok,true);assert.equal(r.summary.relationships.exact_site_link_customer_aligned,1);assert.equal(r.summary.provenance.customers_export.register_verified,false);
 assert.equal(verifyImportOrder(['customers','sites','jobs']).ok,true);assert.equal(verifyImportOrder(['jobs','customers','sites']).ok,false);
});
test('an existing exact site owned by another customer is refused without exposing content',()=>{
 const r=verify(fixture({crossCustomer:true}));assert.equal(r.ok,false);assert.equal(r.summary.relationships.exact_site_link_customer_mismatch,1);assert.ok(r.failures.some(f=>f.code==='exact_site_customer_mismatch'));assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC PRIVATE NAME|SYNTHETIC COMPANY/);
});
test('file drift, manifest drift, historical packages and missing files cannot pass',()=>{
 const mutations=[f=>{f.files['prepared_jobs.csv']+='changed';},f=>{f.manifest.prepared_at='2026-08-06T00:00:00Z';},f=>{f.manifest.package_version=3;},f=>{delete f.files['prepared_sites.csv'];},f=>{f.manifest.profiles.jobs.columns[0].type='number';}];
 for(const change of mutations){const f=fixture();change(f);assert.equal(verify(f).ok,false);}
});
test('real importer coercion rejects invalid optional phone values; provenance cannot upgrade silently',()=>{
 const r=verify(fixture({badPhone:true}));assert.equal(r.ok,false);assert.doesNotMatch(JSON.stringify(r),/not a phone|SYNTHETIC PRIVATE NAME/);
 const f=fixture();f.provenance.sources.customers_export.register_verified=true;assert.equal(verify(f).ok,false);
});
