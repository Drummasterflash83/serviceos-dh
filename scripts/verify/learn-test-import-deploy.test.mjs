// The historical v1 deployer must reject the newer source tree, never silently repin it.
import test from 'node:test';import assert from 'node:assert/strict';
import {deployImportEndpoint} from './learn-test-import-deploy.mjs';
import {TEST_PROJECT} from './learn-test-readiness.mjs';
test('historical endpoint v1 refuses changed source before any CLI submission',async()=>{let calls=0;await assert.rejects(()=>deployImportEndpoint({allowProjectRef:TEST_PROJECT,token:'sbp_'+'a'.repeat(40),runCli:()=>{calls++;return {status:0};}}),/dependency omitted|source differs/);assert.equal(calls,0);});
