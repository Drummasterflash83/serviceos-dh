import test from 'node:test';
import assert from 'node:assert/strict';
import {deployEmailDiagnosticRuntime,diagnosticRuntimeBundle,DIAGNOSTIC_RUNTIME_SHA,DIAGNOSTIC_SCHEMA} from './learn-email-diagnostic-runtime-deploy.mjs';
import {EMAIL_DIAGNOSTIC_PRESERVED} from './learn-email-diagnostic-catalog.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
const rows=EMAIL_DIAGNOSTIC_PRESERVED.map(name=>({name,count:0,fingerprint:'0'.repeat(32)}));
const args={allowProjectRef:TEST_PROJECT,token:'sbp_'+'0'.repeat(40)};
function fixture(){let writes=0;return {get writes(){return writes;},catalog:async()=>({fingerprint:DIAGNOSTIC_SCHEMA}),query:async()=>rows,deploy:async(a,s)=>{writes++;assert.deepEqual(a.replaceVersions,{'platform-worker':5});assert.equal(s.bundleSha,DIAGNOSTIC_RUNTIME_SHA);assert.deepEqual(s.endpoints,[{name:'platform-worker',verifyJwt:false}]);return{state:'deployed_needs_http_acceptance'};}};}
test('complete runtime closure is pinned; only existing TEST worker is replaced',async()=>{assert.equal(diagnosticRuntimeBundle().sha256,DIAGNOSTIC_RUNTIME_SHA);const f=fixture();const r=await deployEmailDiagnosticRuntime(args,f);assert.equal(f.writes,1);assert.equal(r.fullPreservedDataSets,101);assert.equal(r.state,'deployed_needs_http_acceptance');});
test('wrong target, version override, missing source evidence and schema drift prevent deployment',async()=>{for(const [a,d] of [[{allowProjectRef:'production'},{}],[{replaceVersions:{'platform-worker':6}},{}],[{}, {query:async()=>[]}],[{}, {catalog:async()=>({fingerprint:'0'.repeat(32)})}]]){const f=fixture();await assert.rejects(deployEmailDiagnosticRuntime({...args,...a},{...f,...d}));assert.equal(f.writes,0);}});
test('changed source state after one deployment remains unconfirmed with no retry',async()=>{const f=fixture();const r=await deployEmailDiagnosticRuntime(args,{...f,query:async()=>f.writes?rows.map((r,i)=>({...r,count:i===0?1:0})):rows});assert.equal(f.writes,1);assert.equal(r.state,'requires_inspection');assert.equal(r.fullPreservedDataSets,null);});
