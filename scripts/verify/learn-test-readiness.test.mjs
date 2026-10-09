import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessTestCatalog, readTestCatalog, TEST_PROJECT, TEST_ORGANIZATION, CATALOG_QUERY, TEST_LEDGER_QUERY } from './learn-test-readiness.mjs';
const snapshot = JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-schema-2026-10-09.json', import.meta.url)));
const token = 'sbp_' + 'a'.repeat(40);
const reply = data => new Response(JSON.stringify(data), { status: 200 });
test('observed TEST schema exposes real missing prerequisites without treating RLS as a read grant', () => {
  const r = assessTestCatalog(snapshot, []);
  assert.equal(r.publicTableCount, 26);
  assert.equal(r.rlsTableCount, 26);
  assert.equal(r.noPolicyTables.length, 21);
  assert.deepEqual(r.migrationLedgers, ['of_test_deploy.migrations']);
  assert.equal(r.launchFunctionPresent, false);
  assert.equal(r.slices.launch.find(t => t.table === 'email_accounts').state, 'blocked');
  assert.equal(r.slices.cards.find(t => t.table === 'customer_cards').state, 'missing_table');
  assert.ok(r.rpcs.every(r => r.state === 'missing_or_not_executable'));
  assert.equal(r.state, 'not_release_verified');
});
test('narrow column grants are recognized but policy names alone never prove tenant isolation', () => {
  const s = structuredClone(snapshot);
  const t = s.tables.find(t => t.name === 'phone_calls');
  t.policies = [{name:'synthetic_unreviewed_policy',command:'SELECT',roles:['some_other_role']}];
  for (const c of t.columns) c.authenticatedSelect = true;
  let row = assessTestCatalog(s, []).slices.launch.find(t => t.table === 'phone_calls');
  assert.equal(row.state, 'needs_user_rls_verification');
  assert.deepEqual(row.unreadableColumns, []);
  t.columns = t.columns.filter(c => c.name !== 'linked_id');
  row = assessTestCatalog(s, []).slices.launch.find(t => t.table === 'phone_calls');
  assert.equal(row.state, 'blocked');
  assert.deepEqual(row.missingColumns, ['linked_id']);
});
test('audit checks explicit TEST identity before the fixed read-only catalog query and reads no API keys', async () => {
  const calls=[];
  const result=await readTestCatalog({allowProjectRef:TEST_PROJECT,token,fetcher:async(url,options)=>{
    calls.push({url,options});
    if(calls.length===1)return reply({id:TEST_PROJECT,organization_id:TEST_ORGANIZATION,status:'ACTIVE_HEALTHY'});
    if(calls.length===2)return reply([{inventory:snapshot}]);
    return reply([]);
  }});
  assert.equal(result.report.publicTableCount,26);
  assert.deepEqual(calls.map(c=>c.url),[
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}`,
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/functions`,
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,
  ]);
  assert.deepEqual(calls.map(c=>c.options.method),['GET','POST','GET','POST']);
  assert.equal(JSON.parse(calls[1].options.body).query,CATALOG_QUERY);
  assert.equal(JSON.parse(calls[3].options.body).query,TEST_LEDGER_QUERY);
  assert.ok(calls.every(c=>c.options.redirect==='error'));
  assert.ok(!JSON.stringify(result).includes(token));
});
test('foreign target, changed organization, network errors and incomplete inventories cannot pass', async () => {
  let calls=0;
  const forbidden=async()=>{calls++;throw Error('network detail containing '+token);};
  await assert.rejects(()=>readTestCatalog({allowProjectRef:'tgbnakbxwcqjeimygroz',token,fetcher:forbidden}),/allowlist/);
  assert.equal(calls,0);
  await assert.rejects(()=>readTestCatalog({allowProjectRef:TEST_PROJECT,token,fetcher:forbidden}),e=>!e.message.includes(token));
  await assert.rejects(()=>readTestCatalog({allowProjectRef:TEST_PROJECT,token,fetcher:async()=>reply({id:TEST_PROJECT,organization_id:'foreign',status:'ACTIVE_HEALTHY'})}),/identity/);
  assert.throws(()=>assessTestCatalog({...snapshot,tables:[snapshot.tables[0],snapshot.tables[0]]},[]),/Invalid/);
  assert.throws(()=>assessTestCatalog({...snapshot,functions:null},[]),/Incomplete/);
});
