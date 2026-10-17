import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Render the real routing component with inert child views. Unknown dependencies
// throw, so an accidental data request in the routing layer fails this harness.
function fixture(auth) {
  const exported={};
  const source=readFileSync(new URL('../src/components/client-portal/learn/LearnWorkspace.tsx',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  runInNewContext(compiled,{exports:exported,require(name){
    if(name==='react')return {lazy:()=> 'operator-reader',Suspense:'suspense'};
    if(name==='react/jsx-runtime')return {jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};
    if(name==='@/lib/auth')return {useAuth:()=>auth};
    if(name==='./LearnLaunchPortal')return {LearnLaunchPortal:'client-learn'};
    if(name.endsWith('.css'))return {};
    throw Error('Unexpected dependency: '+name);
  }});
  return (tenantId='tenant-b',operatorAuthorised=false)=>exported.LearnWorkspace({tenantId,operatorAuthorised,company:'Synthetic client'});
}
function nodes(node){return !node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
const actor={id:'actor-a'},profile={tenant_id:'tenant-a',role:'viewer'};
test('ordinary clients cannot select a foreign company or mount an operator reader',()=>{
  const render=fixture({user:actor,profile});
  assert.match(JSON.stringify(render()),/unavailable for your account/);
  assert.ok(!nodes(render()).some(n=>['client-learn','operator-reader'].includes(n.type)));
});
test('existing company users without platform authority retain their client LEARN journey',()=>{
  const render=fixture({user:actor,profile});
  const tree=render('tenant-a',false);
  assert.equal(tree.type,'client-learn');assert.equal(tree.props.tenantId,'tenant-a');
});
test('a platform operator with an older matching tenant profile uses audited support',()=>{
  const render=fixture({user:actor,profile:{tenant_id:'tenant-a',role:'owner'}});
  const tree=render('tenant-a',true);
  assert.ok(nodes(tree).some(n=>n.type==='operator-reader'));
  assert.ok(!nodes(tree).some(n=>n.type==='client-learn'));
});
test('authorised operator uses selected tenant, real actor and audited customer collection',()=>{
  const auth={user:actor,profile},before=JSON.stringify(auth),tree=fixture(auth)('tenant-b',true);
  const reader=nodes(tree).find(n=>n.type==='operator-reader');
  assert.equal(reader.props.actorId,'actor-a');assert.equal(reader.props.tenantId,'tenant-b');
  assert.equal(reader.props.initialCollection,'customers');
  assert.equal(reader.key,'actor-a:tenant-b');assert.equal(JSON.stringify(auth),before);
  assert.ok(!nodes(tree).some(n=>n.type==='client-learn'));
  assert.deepEqual(nodes(tree).filter(n=>n.type==='a').map(n=>n.props.href),[
    '/openfolk/tenant-b?module=modules','/openfolk/tenant-b?module=information']);
});
test('client and actor switches remount private operator contents; revoked UI authority removes them',()=>{
  const auth={user:actor,profile},render=fixture(auth);
  const key=t=>nodes(t).find(n=>n.type==='operator-reader')?.key;
  assert.notEqual(key(render('tenant-b',true)),key(render('tenant-c',true)));
  auth.user={id:'actor-b'};assert.equal(key(render('tenant-b',true)),'actor-b:tenant-b');
  assert.equal(key(render('tenant-b',false)),undefined);
  auth.user=null;assert.equal(key(render('tenant-b',true)),undefined);
});
test('an operator with no company profile can use audited support; unsigned access is denied',()=>{
  assert.ok(nodes(fixture({user:actor,profile:null})('tenant-b',true)).some(n=>n.type==='operator-reader'));
  assert.match(JSON.stringify(fixture({user:null,profile})('tenant-b',true)),/Sign in to open LEARN/);
});
