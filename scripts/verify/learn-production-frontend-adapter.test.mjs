import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProductionFrontendAdapter,productionFrontendTransport,productionFrontendHttpTransport} from './learn-production-frontend-adapter.mjs';
import {openReleaseJournal} from './learn-production-release-journal.mjs';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const project='prj_XEuCp5gnEireW5WynUgkRp9QNiXa',team='team_PGUQWiaAZZkMTCM9nSHahIpG';
const contract={project,team,id:'dpl_Candidate',url:'https://serviceos-candidate-allkin.vercel.app',gitSha:'a'.repeat(40),target:'production',previousProductionDeployment:'dpl_Previous',domains:[{name:'app.openfolk.ai',redirect:null},{name:'openfolk.ai',redirect:'www.openfolk.ai'},{name:'serviceos-dh.vercel.app',redirect:null},{name:'www.openfolk.ai',redirect:null}]};
const operation={id:'promote-matching-frontend',kind:'frontend',contract,pinSha256:digest(contract)};
const step={id:operation.id,kind:operation.kind,pinSha256:operation.pinSha256};
const authority=async()=>({projectRef:'tgbnakbxwcqjeimygroz',stepPinSha256:step.pinSha256,approvalEvidenceSha256:'b'.repeat(64)});
function fixture(options={}) {
 const p={id:project,accountId:team,name:'serviceos-dh',targets:{production:{id:contract.previousProductionDeployment}},ssoProtection:{deploymentType:'all_except_custom_domains'},lastAliasRequest:null};
 const d={id:contract.id,projectId:project,ownerId:team,target:'production',url:contract.url.slice(8),readyState:'READY',gitSource:{sha:contract.gitSha,repoId:1285975013,type:'github'},meta:{githubCommitSha:contract.gitSha},autoAssignCustomDomains:false,aliasAssigned:false};
 const domains={domains:contract.domains.map(v=>({...v,gitBranch:null,verified:true})),pagination:{next:null}};
 const aliases=contract.domains.map(v=>({alias:v.name,redirect:v.redirect,projectId:project,deploymentId:contract.previousProductionDeployment}));
 const calls=[];
 function applied(){p.targets.production.id=d.id;d.aliasAssigned=true;p.lastAliasRequest={type:'promote',jobStatus:'succeeded',toDeploymentId:d.id};for(const a of aliases)a.deploymentId=d.id;}
 const request=async(path,opts={})=>{
  calls.push({path,...opts});
  if(opts.method==='POST'){applied();if(options.lost)throw Error('lost response');return {};}
  if(path==='/v9/projects/'+project)return structuredClone(p);
  if(path==='/v13/deployments/'+d.id)return structuredClone(d);
  if(path.endsWith('/domains'))return structuredClone(domains);
  return structuredClone(aliases.find(a=>path.endsWith('/'+a.alias)));
 };
 return {p,d,domains,aliases,calls,applied,request,adapter:createProductionFrontendAdapter({operation,request,allowWrite:options.allowWrite??true,assertApprovedRelease:options.authority??authority})};
}
test('staged production build is ready and all domain readbacks prove promotion',async()=>{
 const f=fixture();assert.equal((await f.adapter.observe(step)).state,'ready');await f.adapter.apply(step);assert.equal((await f.adapter.observe(step)).state,'applied');
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 assert.deepEqual(f.calls.find(c=>c.method==='POST'),{path:`/v10/projects/${project}/promote/${contract.id}`,method:'POST',body:{}});
});
test('cleared transient alias job is accepted only with every final deployment binding',async()=>{
 const f=fixture();f.applied();f.p.lastAliasRequest=null;
 assert.equal((await f.adapter.observe(step)).state,'applied');
 f.aliases[0].deploymentId=contract.previousProductionDeployment;
 assert.equal((await f.adapter.observe(step)).state,'inconclusive');
 f.applied();f.p.lastAliasRequest=null;f.d.aliasAssigned=false;
 assert.equal((await f.adapter.observe(step)).state,'drift');
});
test('preview, wrong SHA, protection change, pagination and unexpected domains stop promotion',async()=>{
 for(const mutate of [f=>f.d.target=null,f=>f.d.gitSource.sha='c'.repeat(40),f=>f.p.ssoProtection=null,f=>f.domains.pagination.next=1,f=>f.domains.domains.push({name:'unexpected.example'}),f=>f.d.autoAssignCustomDomains=true,f=>f.aliases[0].projectId='other',f=>f.aliases[1].redirect='other.example']){
  const f=fixture();mutate(f);assert.equal((await f.adapter.observe(step)).state,'drift');await assert.rejects(f.adapter.apply(step));assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
 }
});
test('mixed aliases, pending job and changing project are not completion',async()=>{
 const f=fixture();f.aliases[0].deploymentId=contract.id;assert.equal((await f.adapter.observe(step)).state,'inconclusive');f.applied();f.p.lastAliasRequest.jobStatus='in-progress';assert.equal((await f.adapter.observe(step)).state,'inconclusive');
 const changing=fixture();let reads=0;
 const a=createProductionFrontendAdapter({operation,request:async(path,opts)=>{if(path==='/v9/projects/'+project&&++reads===2)changing.p.targets.production.id=contract.id;return changing.request(path,opts);}});
 assert.equal((await a.observe(step)).state,'inconclusive');
});
test('default read-only adapter, stale authority and altered step cannot write',async()=>{
 for(const f of [fixture({allowWrite:false}),fixture({authority:async()=>({})})]){await assert.rejects(f.adapter.apply(step));assert.equal(f.calls.filter(c=>c.method==='POST').length,0);}
 const f=fixture();await assert.rejects(f.adapter.observe({...step,pinSha256:'f'.repeat(64)}));assert.equal(f.calls.length,0);
});
test('journal reconciles lost promotion response without another POST, including after reopening',async()=>{
 const f=fixture({lost:true}),directory=join(mkdtempSync(join(tmpdir(),'frontend-journal-')),'journal');
 const plan={version:'learn-production-release-sequence/1',projectRef:'tgbnakbxwcqjeimygroz',candidateSha256:'d'.repeat(64),steps:[step]};
 let j=openReleaseJournal(directory,plan,{create:true});const ports={observe:f.adapter.observe,apply:f.adapter.apply,authorize:async()=> 'b'.repeat(64)};
 try {assert.equal((await j.next(ports)).state,'unknown_outcome');j.close();j=openReleaseJournal(directory,plan);assert.equal((await j.next(ports)).state,'sequence_verified');assert.equal(f.calls.filter(c=>c.method==='POST').length,1);} finally {j.close();rmSync(join(directory,'..'),{recursive:true,force:true});}
});
test('transport allows only fixed reads and explicit exact promotion; errors are sanitised',async()=>{
 const calls=[],cliPath='/installed/vercel/dist/vc.js';
 const execute=(...args)=>{calls.push(args);return '{}';};
 const read=productionFrontendTransport({operation,cliPath,execute});
 await read('/v9/projects/'+project);assert.equal(calls.length,1);assert.ok(calls[0][1].includes('/v9/projects/'+project+'?teamId='+team));
 for(const [path,opts] of [['/v10/projects/'+project+'/env',{}],['/v10/projects/'+project+'/promote/'+contract.id,{method:'POST',body:{}}],['/v9/projects/'+project,{body:{}}]])await assert.rejects(read(path,opts));
 const writes=[];const write=productionFrontendHttpTransport('synthetic-token-not-a-secret',{operation,allowWrite:true,fetcher:async(...args)=>{writes.push(args);return {status:202};}});await write(`/v10/projects/${project}/promote/${contract.id}`,{method:'POST',body:{}});assert.equal(writes.length,1);assert.equal(writes[0][1].body,'{}');assert.equal(writes[0][1].redirect,'error');
 await assert.rejects(write(`/v10/projects/${project}/promote/${contract.id}`,{method:'POST',body:{force:true}}));
 const broken=productionFrontendTransport({operation,cliPath,execute(){throw Error('secret token');}});await assert.rejects(broken('/v9/projects/'+project),e=>!e.message.includes('secret')&&e.message.includes('unconfirmed'));
});

test('HTTP transport never retries an uncertain POST and is read-only by default',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error('network failed');};
 const path=`/v10/projects/${project}/promote/${contract.id}`,opts={method:'POST',body:{}};
 const reader=productionFrontendHttpTransport('synthetic-token-not-a-secret',{operation,fetcher});await assert.rejects(reader(path,opts));assert.equal(calls,0);
 const writer=productionFrontendHttpTransport('synthetic-token-not-a-secret',{operation,fetcher,allowWrite:true});await assert.rejects(writer(path,opts));assert.equal(calls,1);
});
