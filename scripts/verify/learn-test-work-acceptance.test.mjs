import test from 'node:test';
import assert from 'node:assert/strict';
import { workFixturePlan,workDefinition,workSeedSql,acceptWork } from './learn-test-work-acceptance.mjs';
test('retained plans identify synthetic evidence and never store passwords or sessions',()=>{
 const p=workFixturePlan(),other=workFixturePlan();assert.notEqual(p.runId,other.runId);assert.equal(p.tenants.length,2);assert.equal(p.users.length,4);
 assert.match(p.retention,/Retain/);assert.ok(p.users.every(u=>u.email.endsWith('@example.invalid')&&p.tenants.some(t=>t.id===u.tenant)));
 const ids=p.tenants.flatMap(t=>[t.id,t.team,t.member,t.preview,...t.publications]).concat(p.users.map(u=>u.id));assert.equal(new Set(ids).size,16);
 assert.doesNotMatch(JSON.stringify(p),/password|access_token|refresh_token/);
 const sql=workSeedSql(p);assert.match(sql,/learn_work_acceptance_run/);assert.match(sql,/retained_test_evidence/);assert.doesNotMatch(sql,/delete from|truncate|disable trigger|session_replication_role|email_messages|phone_calls/i);
});
test('synthetic scoring definitions only configure rules, without source data or payroll action',()=>{
 assert.equal(workDefinition(50).scaleMax,50);assert.equal(workDefinition(100).scaleMax,100);assert.equal(workDefinition().metrics[0].minCoverage,1);
 assert.match(workDefinition().name,/SYNTHETIC/);assert.equal(workDefinition().metrics[0].sourceSystems[0],'serviceos.work.handoffs@1');
});
test('production or unknown target fails before retrieving keys or creating retained fixtures',async()=>{
 let calls=0;await assert.rejects(()=>acceptWork({allowProjectRef:'production',token:'sbp_'+'a'.repeat(40),fetcher:async()=>{calls++;throw Error();}}));assert.equal(calls,0);
});
