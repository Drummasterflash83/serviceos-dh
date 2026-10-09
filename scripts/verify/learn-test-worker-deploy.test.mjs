import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRelease010Endpoint,deployWorker,workerEndpointBundle} from './learn-test-worker-deploy.mjs';
test('release 010 deployment accepts only its retained verified source bundle',()=>{
 assert.doesNotThrow(()=>assertRelease010Endpoint({sha256:'100c2720fbae1e678b0a310c7c5081d21ac05defeed22ea07f0afc46e165f337'}));
 assert.throws(()=>assertRelease010Endpoint(workerEndpointBundle()),/advanced beyond release 010/);
});
test('thread code cannot reach release 010 deployment or management API',async()=>{
 let calls=0;
 await assert.rejects(deployWorker({fetcher:async()=>{calls++;throw Error('Unexpected network');}}),/matching reviewed schema/);
 assert.equal(calls,0);
});
