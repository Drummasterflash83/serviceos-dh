import test from 'node:test';import assert from 'node:assert/strict';
import {acceptCorrections,correctionArgs} from './learn-test-corrections-acceptance.mjs';
test('acceptance rejects the wrong destination before keys, users or mutations',async()=>{
 let calls=0;await assert.rejects(()=>acceptCorrections({allowProjectRef:'production',token:'sbp_'+'a'.repeat(40),fetcher:async()=>{calls++;throw Error('unexpected access');}}));assert.equal(calls,0);
});
test('withholding and zero remain distinct in the actual RPC payload',()=>{
 assert.equal(correctionArgs('t','m','r',2,null).p_value,null);
 assert.equal(correctionArgs('t','m','r',2,0).p_value,0);
 assert.equal(correctionArgs('t','m','r',2,5).p_expected_review_revision,2);
});
