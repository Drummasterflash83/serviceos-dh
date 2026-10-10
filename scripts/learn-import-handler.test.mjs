import test from 'node:test';import assert from 'node:assert/strict';
import {harness,definition,csv,importId,profileId,tenant} from './learn-import-handler-harness.mjs';
const apply={action:'apply',import_id:importId,csv_text:csv};
const privatePattern=/SYNTHETIC PRIVATE DATABASE DETAIL/;
test('LEARN requires real user/company authority and refuses View As writes before any mutation',async()=>{
 for(const [options,status,code] of [[{auth:false},401,'missing_auth'],[{service:true},403,'forbidden'],[{role:'viewer'},403,'forbidden'],[{role:'ops'},403,'forbidden'],[{companyStatus:'suspended'},403,'forbidden'],[{viewAs:true},403,'preview_read_only'],[{failTable:'view_as_context'},503,'unavailable'],[{failTable:'tenants'},503,'unavailable']]){
  const h=harness(options),r=await h.request();assert.equal(r.status,status);assert.equal(r.body.error.code,code);assert.deepEqual(h.writes,[]);assert.doesNotMatch(JSON.stringify(r),privatePattern);
 }
 const h=harness();assert.equal((await h.request({...apply,tenant_id:'foreign'})).status,403);assert.deepEqual(h.writes,[]);
});
test('LEARN cannot fall into legacy profiles, entities or saved runs',async()=>{
 for(const entity of ['contacts','staff','assets','surprise']){const h=harness();assert.equal((await h.request({action:'preview',entity_type:entity,profile_id:profileId,csv_text:csv})).status,400);assert.deepEqual(h.writes,[]);}
 const absent=harness();assert.equal((await absent.request({action:'preview',entity_type:'customers',csv_text:csv})).body.error.code,'profile_selection_required');
 const legacy=harness({definition:{columns:definition.columns}});assert.equal((await legacy.request()).body.error.code,'profile_mismatch');assert.deepEqual(legacy.writes,[]);
 for(const action of ['apply','status','row_results']){const h=harness({import:{preview:{},entity_type:'customers'}}),r=await h.request(action==='apply'?apply:{action,import_id:importId});assert.ok([404,409].includes(r.status));assert.deepEqual(h.writes,[]);}
});
test('unavailable reads and matchers cannot become empty lists, invalid rows or a successful preview',async()=>{
 for(const [options,body] of [[{failTable:'import_profiles'},undefined],[{failTable:'import_profiles'},{action:'profiles'}],[{failTable:'data_imports'},{action:'imports'}],[{failTable:'data_imports'},{action:'status',import_id:importId}],[{failTable:'import_row_provenance'},{action:'status',import_id:importId}],[{failTable:'data_imports'},undefined],[{failRpc:'import_match_customer'},undefined],[{matcher:{action:'unexpected'}},undefined]]){
  const h=harness(options),r=await h.request(body);assert.equal(r.status,503);assert.deepEqual(h.writes,[]);assert.doesNotMatch(JSON.stringify(r),privatePattern);
 }
 const h=harness({failTable:'data_imports',failOperation:'insert'}),r=await h.request();assert.equal(r.status,503);assert.equal(r.body.success,false);assert.equal(h.writes.length,1);assert.equal(h.writes[0].table,'data_imports');
});
test('preview seals explicit configuration and a masked sample without canonical writes',async()=>{
 const h=harness(),r=await h.request();assert.equal(r.status,200);assert.equal(r.body.preview.will_create,1);assert.equal(r.body.preview.invalid,0);assert.equal(r.body.preview.sealed.profile.id,profileId);assert.doesNotMatch(JSON.stringify(r.body.preview.sample),/SYNTHETIC PRIVATE NAME/);
 assert.ok(h.writes.every(w=>['data_imports','audit_logs'].includes(w.table)));assert.equal(h.writes[0].value.uploaded_by,'22222222-2222-4222-8222-222222222222');
});
test('apply halts honestly on failed state/ledger reads, lost outcomes and changed authority',async()=>{
 for(const [options,code] of [[{failTable:'data_imports',failOperation:'update'},'unavailable'],[{failTable:'import_row_results'},'unavailable'],[{failRpc:'import_customer_row',rpcCode:'42501'},'forbidden'],[{rowResult:{action:'unexpected'}},'unavailable'],[{failRpcs:['import_customer_row','import_row_outcome']},'unavailable']]){
  const h=harness(options),r=await h.request(apply);assert.equal(r.body.success,false);assert.equal(r.body.error.code,code);assert.ok(!h.calls.some(c=>c.rpc==='import_run_finalize'));assert.doesNotMatch(JSON.stringify(r),privatePattern);
 }
 const h=harness({status:'completed'}),r=await h.request({...apply,csv_text:'changed'});assert.equal(r.status,409);assert.deepEqual(h.writes,[]);
});
test('successful governed apply uses only the bound tenant and saved row contract',async()=>{
 const h=harness(),r=await h.request(apply);assert.equal(r.status,200);assert.equal(r.body.import.status,'completed');const row=h.calls.find(c=>c.rpc==='import_customer_row');assert.equal(row.args.p_tenant,tenant);assert.equal(row.args.p_import,importId);assert.equal(row.args.p_options.source,'commusoft');
});
