import test from 'node:test';
import assert from 'node:assert/strict';
import {threadEndpointBundle,assertThreadEndpoint,THREAD_ENDPOINT_FILES,THREAD_ENDPOINT_SHA256,deployThreads} from './learn-test-threads-deploy.mjs';
test('thread endpoint includes every local dependency and matches reviewed source',()=>{
 const b=threadEndpointBundle();assertThreadEndpoint(b);assert.equal(b.sha256,THREAD_ENDPOINT_SHA256);
 assert.equal(b.files.length,13);assert.ok(THREAD_ENDPOINT_FILES.includes('_shared/slack/slack_thread_history.ts'));
 assert.ok(b.files.every(f=>!f.source.includes("from '../worker_handlers/index")));
 assert.throws(()=>assertThreadEndpoint({...b,sha256:'changed'}),/source differs/);
});
test('thread deploy refuses wrong target before any management operation',async()=>{
 let calls=0;await assert.rejects(deployThreads({allowProjectRef:'production',token:'synthetic',fetcher:async()=>{calls++;throw Error('Unexpected network');}}));assert.equal(calls,0);
});
