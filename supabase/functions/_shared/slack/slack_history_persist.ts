import type {readSlackHistoryPage} from './slack_history.ts';
import type {readSlackHistoryBatch} from './slack_history_batch.ts';
type Checkpoint=Parameters<typeof readSlackHistoryBatch>[3];
/** Uses one transactional RPC; never falls back to non-atomic writes.
 * Requires the fenced Slack worker migration on the target database. */
export function slackHistoryPersistence(db:{rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:any;error:any}>},tenantId:string,jobId:string,accountId:string,claim:{claimedBy:string;attemptCount:number}){
 return async(page:Awaited<ReturnType<typeof readSlackHistoryPage>>,expected:Checkpoint,next:Checkpoint)=>{
  const {data,error}=await db.rpc('slack_history_commit_page',{p_tenant_id:tenantId,p_job_id:jobId,p_account_id:accountId,p_claimed_by:claim.claimedBy,p_attempt_count:claim.attemptCount,p_expected:expected,p_next:next,p_records:page.records});
  if(error||data!==true)throw Error('history_checkpoint_persist_failed');
 };
}
