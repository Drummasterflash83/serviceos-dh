import {test} from 'node:test';import assert from 'node:assert/strict';
import {slackHistoryPersistence} from './slack_history_persist.ts';
import {sourceReplayPersistence} from './slack_source_replay.ts';
test('history and source replay surface only the exact actionable card-provenance hold, without leaking SQL details',async()=>{
 for(const message of ['slack_history_withheld_card_review_required','Secret provider text','slack_history_withheld_card_review_required: raw detail']){
  let calls=0;const db={rpc:async()=>{calls++;return {data:null,error:{message,details:'Never disclose fixture'}};}};
  const claim={claimedBy:'synthetic',attemptCount:1};const page={records:[]} as any;
  for(const run of [slackHistoryPersistence(db,'tenant','job','account',claim,undefined,()=>({})),sourceReplayPersistence(db as any,{claim,tenantId:'tenant',jobId:'job'} as any,()=>({}))]){
   await assert.rejects(run(page,{} as any,{pages:1,complete:true,cursor:null} as any),(e:any)=>{
    if(message==='slack_history_withheld_card_review_required'){assert.equal(e.code,message);assert.equal(e.retryable,false);}else assert.equal(e.code,undefined);
    assert.equal(e.message.includes('Never disclose'),false);assert.equal(e.message.includes('Secret provider'),false);return true;
   });
  }
  assert.equal(calls,2,'No automatic retry');
 }
});
