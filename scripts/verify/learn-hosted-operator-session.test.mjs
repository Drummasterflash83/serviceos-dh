import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newSessionPlan, validatePlan, preservationSql, publicSummary, runSession, HEALTH_FINGERPRINT} from './learn-hosted-operator-session.mjs';
import {expectedActions} from './learn-test-actions-release.mjs';
import {actionAuthContractMatches} from './learn-test-actions-acceptance.mjs';

function authContract() {
  const auth = JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-auth-fixture-contract-2026-10-09.json',import.meta.url)));
  const expected = expectedActions();
  for (const name of ['tenants','profiles']) for(const trigger of ['learn_work_authority_input_lock','learn_work_authority_truncate_lock']) {
    const t = expected.tables.find(t=>t.name===name).triggers.find(t=>t.name===trigger);
    auth.tables.find(t=>t.name===name).triggers.push({name:trigger,definition:t.definition,function:expected.functions.find(f=>f.name===t.function).definition});
  }
  assert.equal(actionAuthContractMatches(auth),true);
  return auth;
}
function fixture() {
  let plan = newSessionPlan(); plan.before = [{name:'public.email_messages',count:12,fingerprint:'retained'}];
  const writes = [], remote = [];
  let collision = false, refuseJournal = false;
  const args = {
    token:'synthetic-management', approved:true,
    read: async()=>structuredClone(plan),
    save: async(p,exclusive)=>{if(refuseJournal && p.state==='activation_started')throw Error('disk unavailable'); writes.push({state:p.state,exclusive});plan=structuredClone(p);},
    catalog:async()=>({fingerprint:HEALTH_FINGERPRINT}),
    sql:async(query,readOnly=true)=>{
      remote.push({kind:'sql',query,readOnly});
      if(query.includes('authTriggers'))return [{contract:authContract()}];
      if(query.includes('as users'))return [{users:collision?1:0,profiles:0,tenants:0,grants:0}];
      if(query.includes(' as fingerprint from '))return structuredClone(plan.before);
      if(query.includes('select effective_to as expires_at'))return [{expires_at:'2026-10-10T18:00:00Z'}];
      if(query.includes('as active_grants'))return [{active_grants:1,banned_logins:0,active_jobs:0,connections:0}];
      return [];
    },
    fetcher:async(url,options)=>{
      remote.push({kind:'http',url,options});
      if(url.endsWith('/api-keys?reveal=true'))return Response.json([{name:'service_role',api_key:'x.'+Buffer.from(JSON.stringify({ref:plan.projectRef,role:'service_role'})).toString('base64url')+'.y'}]);
      if(url.endsWith('/auth/v1/admin/users')) {
        assert.equal(writes.at(-1).state,'activation_started');
        return Response.json({id:plan.user});
      }
      throw Error('Unexpected HTTP request');
    },
  };
  return {args,writes,remote,get plan(){return plan;},collision:()=>collision=true,refuseJournal:()=>refuseJournal=true};
}
test('plan pins TEST identity and duration; public output cannot expose password or row fingerprints',()=>{
  const p=newSessionPlan();p.password='PRIVATE';p.before=[{fingerprint:'PRIVATE'}];
  assert.ok(!JSON.stringify(publicSummary(p)).includes('PRIVATE'));
  for(const change of [{projectRef:'production'},{email:'somebody@example.invalid'},{durationMinutes:60},{grant:"x';drop table tenants;--"}]) assert.throws(()=>validatePlan({...p,...change}));
  const sql=preservationSql(p);
  assert.equal(sql.split(' union all ').length,64);
  assert.ok(sql.includes(`public.platform_authority_grants s where id<>'${p.grant}'`));
  assert.ok(sql.includes('vault.secrets s where true'));
});
test('prepare reads only and saves exclusive reviewable plan without credential acquisition',async()=>{
  const f=fixture();const result=await runSession('prepare',f.args);
  assert.equal(result.state,'prepared');assert.deepEqual(f.writes,[{state:'prepared',exclusive:true}]);
  assert.ok(f.remote.every(r=>r.kind==='sql'&&r.readOnly));
});
test('approval, current schema and existing identity checks precede every mutation',async()=>{
  for(const kind of ['approval','schema','identity']){
    const f=fixture();
    if(kind==='approval')f.args.approved=false;
    if(kind==='schema')f.args.catalog=async()=>({fingerprint:'changed'});
    if(kind==='identity')f.collision();
    await assert.rejects(runSession('activate',f.args));
    assert.equal(f.writes.length,0);assert.ok(f.remote.every(r=>r.kind==='sql'&&r.readOnly));
  }
});
test('durable journal failure prevents Auth creation; an attempted activation cannot be replayed',async()=>{
  const f=fixture();f.refuseJournal();await assert.rejects(runSession('activate',f.args),/disk/);
  assert.ok(!f.remote.some(r=>r.kind==='http'&&r.options.method==='POST'));
  f.args.read=async()=>({...f.plan,state:'activation_started'});
  await assert.rejects(runSession('activate',f.args),/unused plan/);
});
test('approved activation creates one marked account and time-bounded grant, retaining source fingerprints',async()=>{
  const f=fixture();const result=await runSession('activate',f.args);
  assert.equal(result.state,'active');assert.equal(result.preserved,true);
  const create=f.remote.filter(r=>r.kind==='http'&&r.url.endsWith('/auth/v1/admin/users'));
  assert.equal(create.length,1);
  const body=JSON.parse(create[0].options.body);assert.equal(body.email,'chris@openfolk.ai');
  assert.equal(body.app_metadata.learn_hosted_operator_session,f.plan.runId);
  const mutation=f.remote.filter(r=>r.kind==='sql'&&!r.readOnly);assert.equal(mutation.length,1);
  assert.match(mutation[0].query,/interval '30 minutes'/);assert.match(mutation[0].query,/'archived'/);
  assert.ok(!mutation[0].query.includes('vault.'));
});
test('retirement removes database authority even if the Auth service then fails',async()=>{
  const f=fixture();f.args.read=async()=>({...f.plan,state:'active'});
  f.args.fetcher=async()=>{throw Error('Auth unavailable');};
  await assert.rejects(runSession('retire',f.args),/Auth unavailable/);
  assert.equal(f.writes.at(-1).state,'grant_retired');
  assert.match(f.remote.find(r=>r.kind==='sql'&&!r.readOnly).query,/set effective_to=least/);
  assert.equal(f.plan.state,'grant_retired');
});
