import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {actionAuthContractMatches,actionFixturePlan,acceptActions,serviceActorDenied} from './learn-test-actions-acceptance.mjs';
import {expectedActions} from './learn-test-actions-release.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
const original=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-auth-fixture-contract-2026-10-09.json',import.meta.url)));
function updatedAuth(){const c=structuredClone(original),e=expectedActions();for(const name of ['profiles','tenants'])for(const t of e.tables.find(t=>t.name===name).triggers.filter(t=>t.name.startsWith('learn_work_authority_')))c.tables.find(t=>t.name===name).triggers.push({name:t.name,definition:t.definition,function:e.functions.find(f=>f.name===t.function).definition});return c;}
test('Auth fixture preflight permits only the two exact installed authority guards',()=>{assert.equal(actionAuthContractMatches(updatedAuth()),true);const c=updatedAuth();c.tables.find(t=>t.name==='profiles').triggers.at(-1).function+=' changed';assert.equal(actionAuthContractMatches(c),false);assert.equal(actionAuthContractMatches(original),false);});
test('action fixtures are isolated, marked and unique with ended-membership cleanup intent',()=>{const a=actionFixturePlan(),b=actionFixturePlan();assert.equal(a.projectRef,TEST_PROJECT);assert.notEqual(a.runId,b.runId);assert.equal(a.users.length,6);assert.equal(a.members.length,5);assert.equal(a.objects.length,5);assert.ok(a.users.every(u=>u.email.endsWith('@example.invalid')));assert.match(a.retention,/end synthetic membership/);assert.equal(new Set([...a.users,...a.members,...a.tenants].map(r=>r.id)).size,13);});
test('wrong TEST target cannot reach any endpoint or create actors',async()=>{let calls=0;await assert.rejects(()=>acceptActions({allowProjectRef:'production',token:'sbp_'+'a'.repeat(40),fetcher:async()=>{calls++;throw Error('Must not fetch');}}));assert.equal(calls,0);});

test('only explicit internal-service denial responses pass, never a server failure or successful action',()=>{for(const [status,code] of [[401,'internal_auth_mismatch'],[403,'forbidden']])assert.equal(serviceActorDenied({ok:false,status,data:{ok:false,error:{code}}}),true);for(const r of [{ok:true,status:200,data:{ok:true}},{ok:false,status:503,data:{ok:false,error:{code:'forbidden'}}},{ok:false,status:401,data:{ok:false,error:{code:'invalid_auth'}}}])assert.equal(serviceActorDenied(r),false);});
