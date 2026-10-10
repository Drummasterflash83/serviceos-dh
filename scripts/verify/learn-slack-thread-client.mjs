/** Validate actual synthetic SQL responses through the application adapter.
 * Input is exported by the isolated --slack-thread-resume verification run. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadSlackThreadRecovery,resumeSlackThread} from '../../src/lib/learn-slack-thread-recovery.ts';
const file=process.argv[2];if(!file)throw Error('Supply the isolated SQL response fixture');
const raw=readFileSync(file,'utf8');if(raw.length>1000000)throw Error('SQL fixture exceeds bound');
const fixture=JSON.parse(raw);
for(const value of [fixture.original,fixture.state]){
 const parsed=await loadSlackThreadRecovery({rpc:async(name,args)=>{
  assert.equal(name,'learn_slack_thread_recovery_read');assert.deepEqual(args,{p_tenant_id:value.tenantId,p_import_id:value.importId});return {data:value,error:null};
 }},value.tenantId,value.accountId,value.importId);
 assert.deepEqual(parsed,value);
 assert.ok(!JSON.stringify(parsed).includes('retained-thread-cursor'));
 assert.ok(!('scope' in parsed)&&!('checkpoint' in parsed)&&!('jobKey' in parsed));
}
assert.equal(fixture.original.progress.pagesThisApproval,1);
assert.equal(fixture.original.canRestart,false);
assert.ok(fixture.original.supersededBy);
assert.equal(fixture.state.progress.pagesThisApproval,0);
assert.equal(fixture.state.active,true);
assert.equal(fixture.state.recoveryMode,'continue');
const r=fixture.request;
const result=await resumeSlackThread({rpc:async(name,args)=>{
 assert.equal(name,'learn_slack_resume_thread');
 assert.deepEqual(args,{p_tenant_id:r.tenantId,p_request_id:r.requestId,p_import_id:r.importId,p_expected_state_version:r.stateVersion,p_mode:r.mode,p_max_pages:r.maxPages,p_reason:r.reason});
 return {data:fixture.receipt,error:null};
}},r);
assert.deepEqual(result,fixture.receipt);assert.equal(result.reused,true);
console.log(JSON.stringify({state:'passed',actualSqlStates:2,retainedReceiptVerified:true,originalApprovalStillShowsItsOwnProgress:true,scope:'Actual isolated SQL responses through application parsing; no network or provider request.'}));
