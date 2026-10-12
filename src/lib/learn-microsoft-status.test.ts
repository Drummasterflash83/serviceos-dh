import test from 'node:test';
import assert from 'node:assert/strict';
import {validMicrosoftStatus,readMicrosoftStatus,microsoftCaptureState} from './learn-microsoft-status.ts';
const id='ea790000-aaaa-4000-8000-000000000001';
function fixture(){return {version:'learn-microsoft-status/1',tenant_id:id,observed_at:'2026-10-12T03:00:00Z',next_after:null,accounts:[{
 account_id:id,email_address:'synthetic@example.invalid',account_active:true,capture_allowed:true,bindings:1,enabled_bindings:1,coverage_complete:false,attachments_captured:false,
 saved_pages:2,settled_pages:1,last_saved_at:'2026-10-12T02:00:00Z',last_settled_at:'2026-10-12T02:01:00Z',published_observations:1,held_observations:1,draft_observations:0,removal_observations:0,
 physical_folders:1,search_folders:0,discovery_rounds:0,last_discovery_at:null,jobs:{queued:1},next_job_at:'2026-10-12T02:10:00Z',issue_code:null,issue_at:null,
}]};}
test('scope, pagination and unknown coverage are enforced',async()=>{
 const f=fixture();assert.equal(validMicrosoftStatus(f,id,null),true);
 const result=await readMicrosoftStatus({rpc:async(name,args)=>{assert.equal(name,'learn_operator_microsoft_status');assert.deepEqual(args,{p_tenant:id,p_after:null});return{data:f,error:null};}},id);
 assert.equal(result.accounts[0].coverage_complete,false);
 for(const change of [(v:any)=>v.tenant_id='foreign',(v:any)=>v.next_after=id,(v:any)=>v.accounts.push(v.accounts[0]),(v:any)=>v.accounts[0].coverage_complete=true,(v:any)=>v.accounts[0].attachments_captured=true,(v:any)=>v.accounts[0].settled_pages=3,(v:any)=>v.accounts[0].held_observations=null,(v:any)=>v.accounts[0].jobs={private_message:1},(v:any)=>v.accounts[0].issue_code='private_token',(v:any)=>v.accounts[0].enabled_bindings=2]){
  const v:any=fixture();change(v);assert.equal(validMicrosoftStatus(v,id,null),false);
 }
 assert.equal(validMicrosoftStatus(f,id,id),false);
 const paged:any=fixture();paged.accounts=Array.from({length:20},(_,i)=>({...paged.accounts[0],account_id:'ea790000-aaaa-4000-8000-'+String(i+1).padStart(12,'0')}));paged.next_after=paged.accounts[19].account_id;
 assert.equal(validMicrosoftStatus(paged,id,null),true);
});
test('paused and historical success never imply healthy current capture',()=>{
 const a:any=fixture().accounts[0];assert.match(microsoftCaptureState(a),/scheduled.*unverified/);
 a.capture_allowed=false;assert.equal(microsoftCaptureState(a),'Capture paused');
 a.capture_allowed=true;a.account_active=false;assert.match(microsoftCaptureState(a),/setup or access/);
 a.account_active=true;a.jobs={succeeded:10};assert.match(microsoftCaptureState(a),/freshness unverified/);
 a.issue_code='microsoft_delta_expired';assert.equal(microsoftCaptureState(a),'Capture needs attention');
 a.issue_code=null;a.saved_pages=0;assert.equal(microsoftCaptureState(a),'Awaiting first saved page');
});
test('transport and malformed status failures do not reveal database content',async()=>{
 await assert.rejects(readMicrosoftStatus({rpc:async()=>({data:null,error:{message:'PRIVATE'}})},id),e=>e instanceof Error&&!e.message.includes('PRIVATE'));
 await assert.rejects(readMicrosoftStatus({rpc:async()=>({data:{...fixture(),accounts:null},error:null})},id),/could not be verified/);
});
