import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rehearsalSql, rehearseLaunch } from './learn-test-launch-rehearsal.mjs';
import { TEST_PROJECT, TEST_ORGANIZATION } from './learn-test-readiness.mjs';
const snapshot=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-schema-2026-10-09.json',import.meta.url)));
const ledger=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-readiness-2026-10-09.json',import.meta.url))).customMigrationEntries;
const token='sbp_'+'a'.repeat(40);
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status});
function mock({org=TEST_ORGANIZATION,writeStatus=201,drift=false,postUnavailable=false,installed=false}={}){
  const calls=[];let wrote=false;
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/database/query')){
      wrote=true;
      if(writeStatus!==201)return reply({code:'42501',message:'private response '+token},writeStatus);
      return reply([{rehearsal:'learn-test-launch-rehearsal/1',reader_absent:true,views_absent:true}],201);
    }
    if(wrote&&postUnavailable)return reply({message:'private failure'},503);
    if(url.endsWith('/'+TEST_PROJECT))return reply({id:TEST_PROJECT,organization_id:org,status:'ACTIVE_HEALTHY'});
    if(url.endsWith('/functions'))return reply([]);
    const query=JSON.parse(options.body).query;
    if(query.includes('as inventory')){
      const inventory=structuredClone(snapshot);
      inventory.launchMetadata={reader:null,relations:[]};
      if(installed)inventory.launchMetadata.reader={name:'learn_launch_metadata_reader'};
      if(wrote){
        inventory.observedAt='2026-10-09T20:00:00Z';
        if(drift)inventory.tables[0].rls=!inventory.tables[0].rls;
      }
      return reply([{inventory}]);
    }
    return reply(ledger);
  };
  return {calls,fetcher};
}
test('only the reviewed source can be transformed into a bounded rollback rehearsal',()=>{
  const sql=rehearsalSql();
  assert.match(sql,/set local lock_timeout='3s'/);
  assert.match(sql,/set local statement_timeout='30s'/);
  assert.equal((sql.match(/^rollback;$/gm)??[]).length,1);
  assert.equal((sql.match(/^commit;$/gm)??[]).length,0);
  assert.match(sql,/reader_absent/);
  assert.throws(()=>rehearsalSql('begin; drop schema public cascade; commit;'),/checksum/);
});
test('rehearsal verifies TEST identity, sends one rollback-only request and compares post-state',async()=>{
  const m=mock();const r=await rehearseLaunch({allowProjectRef:TEST_PROJECT,token,fetcher:m.fetcher});
  assert.equal(r.state,'rehearsed_and_rolled_back');assert.equal(r.catalogUnchanged,true);
  assert.equal(r.beforeCatalogSha256,r.afterCatalogSha256);
  assert.equal(m.calls.length,9);
  const writes=m.calls.filter(c=>c.url.endsWith('/database/query'));
  assert.equal(writes.length,1);
  assert.equal(JSON.parse(writes[0].options.body).query,rehearsalSql());
  assert.ok(m.calls.every(c=>c.url.includes('/'+TEST_PROJECT)&&c.options.redirect==='error'));
  assert.equal(JSON.stringify(r).includes(token),false);
});
test('foreign target, changed organization and already installed role never run DDL',async()=>{
  const m=mock();await assert.rejects(()=>rehearseLaunch({allowProjectRef:'production',token,fetcher:m.fetcher}),/allowlist/);
  assert.equal(m.calls.length,0);
  for(const config of [{org:'foreign'},{installed:true}]){
    const other=mock(config);
    await assert.rejects(()=>rehearseLaunch({allowProjectRef:TEST_PROJECT,token,fetcher:other.fetcher}));
    assert.equal(other.calls.some(c=>c.url.endsWith('/database/query')),false);
  }
});
test('DDL failure, post-state drift or unavailable post-state never passes or retries',async()=>{
  for(const config of [{writeStatus:400},{drift:true},{postUnavailable:true}]){
    const m=mock(config);const r=await rehearseLaunch({allowProjectRef:TEST_PROJECT,token,fetcher:m.fetcher});
    assert.equal(r.state,'rehearsal_not_verified');
    assert.equal(m.calls.filter(c=>c.url.endsWith('/database/query')).length,1);
    assert.equal(JSON.stringify(r).includes(token),false);
    if(config.writeStatus)assert.equal(r.databaseCode,'42501');
  }
});
