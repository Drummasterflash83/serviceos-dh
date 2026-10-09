import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkedFoundation } from './learn-foundation-bundle.mjs';
import { foundationRehearsalSql,rehearseFoundation,MARKER,SOURCE_SHA256 } from './learn-test-foundation-rehearsal.mjs';
import { TEST_PROJECT,TEST_ORGANIZATION } from './learn-test-readiness.mjs';
const load=n=>JSON.parse(readFileSync(new URL('../../docs/operations/evidence/'+n,import.meta.url)));
const snapshot=load('learn-test-launch-installed-catalog-2026-10-09.json');
const foundation=load('learn-test-foundation-schema-2026-10-09.json');
const token='sbp_'+'a'.repeat(40);
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status});
function mock({org=TEST_ORGANIZATION,installed=false,drift=false,viewDrift=false,missingHelper=false,missingReceipt=false,failed=false,unknown=false,postUnavailable=false}={}){
 const calls=[];let wrote=false;
 const fetcher=async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/database/query')){
   wrote=true;
   if(unknown)throw Error('private transport detail '+token);
   if(failed)return reply({code:'23514',message:'private diagnostic '+token},400);
   return reply([{rehearsal:MARKER,tables_absent:true,guard_absent:true,receipt_absent:true}],201);
  }
  if(wrote&&postUnavailable)return reply({message:'private diagnostic'},503);
  if(url.endsWith('/'+TEST_PROJECT))return reply({id:TEST_PROJECT,organization_id:org,status:'ACTIVE_HEALTHY'});
  if(url.endsWith('/functions'))return reply(snapshot.functions);
  const query=JSON.parse(options.body).query;
  if(query.includes('as inventory')){
   const c=structuredClone(snapshot.inventory);
   if(wrote){c.observedAt='2026-10-09T22:00:00Z';if(viewDrift)c.launchMetadata.relations.find(r=>r.kind==='v').definition+=' changed';}
   return reply([{inventory:c}]);
  }
  if(query.includes('as catalog')){
   const c=structuredClone(foundation);
   delete c.readiness;delete c.readinessCatalogSha256;delete c.projectRef;
   if(installed)c.tables.push({name:'companies'});
   if(missingHelper)c.helpers=c.helpers.filter(f=>f.name!=='current_tenant_id');
   if(wrote){c.observedAt='2026-10-09T22:00:00Z';if(drift)c.tables[0].columns[0].default='changed';}
   return reply([{catalog:c}]);
  }
  return reply(missingReceipt?snapshot.report.customMigrationEntries.slice(0,1):snapshot.report.customMigrationEntries);
 };
 return {calls,fetcher};
}
test('reviewed recovered sources produce exactly 33 new tables with no source or storage mutations',()=>{
 const b=checkedFoundation();assert.equal(b.manifest.sha256,SOURCE_SHA256);assert.equal(b.manifest.tables.length,33);assert.equal(b.manifest.sources.length,9);
 assert.doesNotMatch(b.sql,/^insert into storage\.buckets|^update domain_entity_types/gm);
 const sql=foundationRehearsalSql();assert.equal((sql.match(/^commit;$/gm)??[]).length,0);assert.equal((sql.match(/^rollback;$/gm)??[]).length,1);
 assert.ok(sql.indexOf('lock table of_test_deploy.migrations')<sql.indexOf('Foundation receipt exists'));
 assert.match(sql,/lock_timeout='3s'/);assert.match(sql,/statement_timeout='30s'/);assert.match(sql,/guard_absent/);
});
test('valid TEST rehearsal sends one fixed rollback request and confirms both catalog scopes unchanged',async()=>{
 const m=mock();const r=await rehearseFoundation({allowProjectRef:TEST_PROJECT,token,fetcher:m.fetcher});
 assert.equal(r.state,'rehearsed_and_rolled_back');assert.equal(r.catalogUnchanged,true);
 const writes=m.calls.filter(c=>c.url.endsWith('/database/query'));
 assert.equal(writes.length,1);assert.equal(JSON.parse(writes[0].options.body).query,foundationRehearsalSql());
 assert.ok(m.calls.every(c=>c.url.includes('/'+TEST_PROJECT)&&c.options.redirect==='error'));
 assert.equal(JSON.stringify(r).includes(token),false);
});
test('foreign target or organization, installed foundation and missing dependencies refuse before DDL',async()=>{
 const m=mock();await assert.rejects(()=>rehearseFoundation({allowProjectRef:'production',token,fetcher:m.fetcher}));assert.equal(m.calls.length,0);
 for(const config of [{org:'foreign'},{installed:true},{missingHelper:true},{missingReceipt:true}]){
  const m=mock(config);await assert.rejects(()=>rehearseFoundation({allowProjectRef:TEST_PROJECT,token,fetcher:m.fetcher}));
  assert.equal(m.calls.some(c=>c.url.endsWith('/database/query')),false);
 }
});
test('SQL failures, uncertain transport, source or view drift and unavailable post-state never pass or retry',async()=>{
 for(const config of [{failed:true},{unknown:true},{drift:true},{viewDrift:true},{postUnavailable:true}]){
  const m=mock(config);const r=await rehearseFoundation({allowProjectRef:TEST_PROJECT,token,fetcher:m.fetcher});
  assert.equal(r.state,'rehearsal_not_verified',JSON.stringify(config));
  assert.equal(m.calls.filter(c=>c.url.endsWith('/database/query')).length,1);
  assert.equal(JSON.stringify(r).includes(token),false);
  if(config.failed)assert.equal(r.databaseCode,'23514');
 }
});
