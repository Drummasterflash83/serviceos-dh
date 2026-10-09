import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { decideWorkTransition } from '../supabase/functions/_shared/work_transition.ts';
import { projectWork } from '../supabase/functions/_shared/work_projection.ts';

const uid='20000000-0000-4000-8000-000000000001';
const mid='30000000-0000-4000-8000-000000000001';
const oid='40000000-0000-4000-8000-000000000001';
const actor={ userRef:uid,isSuperadmin:false,canAssign:false,canApprove:false,canConfirmOwnership:false,isAssignee:false };
const work={ id:oid,domain:'serviceos',object_type:'Action',status:'ready',version:4,
  responsible_ref:{kind:'user',ref:uid},attributes:{done_when:'Source evidence recorded'} };
const legal=[{from_state:'ready',to_state:'in_progress'},{from_state:'in_progress',to_state:'complete'}];
const decide=(verb,extra={}) => decideWorkTransition({ object:work,actor,verb,legalTransitions:legal,...extra });

test('recovered authority gate rejects moving or claiming another person’s work',()=>{
  for(const verb of ['start','dismiss','accept']) assert.equal(decide(verb,{reason:'test'}).code,'forbidden');
  assert.equal(decide('start',{actor:{...actor,isAssignee:true}}).ok,true);
  assert.equal(decide('accept',{actor:{...actor,canAssign:true}}).ok,true);
  const r=decide('accept',{object:{...work,responsible_ref:null}});
  assert.equal(r.ok,true);
  assert.deepEqual(r.objectPatch.responsible_ref,{kind:'user',ref:uid});
});
test('completion still requires defined proof or an authorized exception',()=>{
  const object={...work,status:'in_progress'};
  const owner={...actor,isAssignee:true};
  assert.equal(decide('complete',{object,actor:owner}).code,'evidence_required');
  assert.equal(decide('complete',{object,actor:owner,evidence:'Source record verified'}).ok,true);
  assert.equal(decide('complete',{object:{...object,attributes:{}},actor:owner,approvedException:true}).code,'done_when_required');
  assert.equal(decide('complete',{object:{...object,attributes:{}},actor:{...owner,canApprove:true},approvedException:true}).ok,true);
});
test('work projection carries the actual object version, never an invented revision',()=>{
  const ctx={objective:null,objectiveHealth:null,metric:null,team:null,evidenceRecs:[],relatedIntents:[],possibleDuplicateOf:[]};
  assert.equal(projectWork(work,ctx,Date.now()).objectVersion,4);
  assert.equal(projectWork({...work,version:undefined},ctx,Date.now()).objectVersion,undefined);
});

const compiled=ts.transpileModule(readFileSync(new URL('../supabase/functions/work-transition/index.ts',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true,
});
assert.deepEqual(compiled.diagnostics,[]);
async function call(options={}) {
  let handler;
  const calls=[];
  const tables={
    view_as_context:{data:null}, intelligence_objects:{data:work},
    team_members:{data:{id:mid}}, authority_grants:{data:[]}, state_transitions:{data:legal},
    ...options.tables,
  };
  const db={from(table){
    const q={};
    for(const method of ['select','eq','is','gt','limit','not','lte','or']) q[method]=(...args)=>{calls.push({table,method,args});return q;};
    q.maybeSingle=async()=>tables[table];
    q.then=(resolve,reject)=>Promise.resolve(tables[table]).then(resolve,reject);
    q.insert=q.update=()=>{throw Error('Direct writes would break atomic persistence');};
    return q;
  },rpc:async(name,args)=>{calls.push({rpc:name,args});return options.rpcResult??{data:{version:5,history_id:'synthetic-history'}};}};
  runInContext(compiled.outputText,createContext({exports:{},Request,Response,
    Deno:{env:{get:()=> 'local-test-only'},serve:fn=>{handler=fn;}},
    require:path=> {
      if(path.includes('@supabase/')) return {createClient:()=>db};
      if(path.endsWith('/authz.ts')) return {requireTenantUser:async()=>({ok:true,ctx:{tenantId:'tenant',userId:uid,email:'synthetic@example.test'}})};
      if(path.endsWith('/audit.ts')) return {writeAudit:async()=>{}};
      if(path.endsWith('/work_transition.ts')) return {decideWorkTransition};
      throw Error('Unexpected dependency '+path);
    },
  }));
  const response=await handler(new Request('http://localhost/work-transition',{method:'POST',
    headers:{'content-type':'application/json'},body:JSON.stringify({object_id:oid,verb:'start',expected_version:4,...options.body})}));
  return {status:response.status,body:await response.json(),calls};
}
test('actual Edge handler persists once through the atomic RPC with stable actor and expected version',async()=>{
  const r=await call();assert.equal(r.status,200);
  const writes=r.calls.filter(c=>c.rpc);assert.equal(writes.length,1);
  assert.equal(writes[0].rpc,'work_transition_apply');
  assert.equal(writes[0].args.p_expected_version,4);
  assert.equal(writes[0].args.p_history.actor.user_id,uid);
  assert.equal(writes[0].args.p_history.verb,'start');
  assert.equal(r.body.version,5);
});
test('missing/stale card version, view-as lookup failure and authority read failure prevent writes',async()=>{
  for(const options of [
    {body:{expected_version:undefined}}, {body:{expected_version:3}},
    {tables:{view_as_context:{data:null,error:{message:'offline'}}}},
    {tables:{view_as_context:{data:{id:'viewing'}}}},
    {tables:{authority_grants:{data:null,error:{message:'offline'}}}},
    {tables:{team_members:{data:null,error:{message:'ambiguous'}}}},
  ]) {
    const r=await call(options);assert.notEqual(r.status,200);
    assert.equal(r.calls.filter(c=>c.rpc).length,0);
  }
});
test('waiting-on and note references never grant ownership; elevated grants must be confirmed company grants',async()=>{
  const r=await call({tables:{intelligence_objects:{data:{...work,
    responsible_ref:{kind:'note',ref:uid},waiting_on_ref:{kind:'user',ref:uid}}}}});
  assert.equal(r.status,403);assert.equal(r.calls.filter(c=>c.rpc).length,0);
  assert.ok(r.calls.some(c=>c.table==='authority_grants'&&c.method==='eq'&&c.args[0]==='confirmed'&&c.args[1]===true));
  assert.ok(r.calls.some(c=>c.table==='authority_grants'&&c.method==='eq'&&c.args[0]==='scope'&&c.args[1]==='company'));
});
test('database concurrency conflict is returned as a refresh requirement',async()=>{
  const r=await call({rpcResult:{error:{code:'P0409'}}});
  assert.equal(r.status,409);assert.equal(r.body.error.code,'version_conflict');
});
