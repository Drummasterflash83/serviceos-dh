import {SlackHistoryTransportError} from './slack_history_errors.ts';
import type {readSlackHistoryPage} from './slack_history.ts';
import type {readSlackThreadPage} from './slack_thread_history.ts';
import type {readSlackHistoryBatch} from './slack_history_batch.ts';
type Checkpoint=Parameters<typeof readSlackHistoryBatch>[3];
/** Uses one transactional RPC; never falls back to non-atomic writes.
 * Requires the fenced Slack worker migration on the target database. */
export function slackHistoryPersistence(db:{rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:any;error:any}>},tenantId:string,jobId:string,accountId:string,claim:{claimedBy:string;attemptCount:number},threadImportId?:string,captureVisibility?:()=>Readonly<Record<string,unknown>>|null){
 return async(page:Awaited<ReturnType<typeof readSlackHistoryPage|typeof readSlackThreadPage>>,expected:Checkpoint,next:Checkpoint)=>{
  const visibility=captureVisibility?.();if(!visibility)throw Error('history_visibility_unavailable');
  const {data,error}=await db.rpc('slack_commit_attested_page',{p_tenant_id:tenantId,p_job_id:jobId,p_account_id:accountId,p_import_id:threadImportId??null,p_claimed_by:claim.claimedBy,p_attempt_count:claim.attemptCount,p_expected:expected,p_next:next,p_records:page.records,p_visibility:visibility});
  if(error?.message==='slack_history_withheld_card_review_required')throw new SlackHistoryTransportError('slack_history_withheld_card_review_required',false);
  if(error||data!==true)throw Error('history_checkpoint_persist_failed');
 };
}
