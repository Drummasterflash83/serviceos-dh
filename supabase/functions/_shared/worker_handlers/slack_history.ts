import {createStoredHistoryBinding} from '../slack/slack_history_binding.ts';
import {createSlackHistoryServerPorts} from '../slack/slack_history_server.ts';
import {createHistoryRequestAdapter} from '../slack/slack_history_request.ts';
import {SlackHistoryTransportError} from '../slack/slack_history_errors.ts';
import {readSlackHistoryBatch} from '../slack/slack_history_batch.ts';
import {slackHistoryPersistence} from '../slack/slack_history_persist.ts';
import type {SlackHistoryScope} from '../slack/slack_history.ts';
import type {WorkerHandlerContext,WorkerHandlerResult} from './index.ts';
export type SlackHistoryBinding={tenantId:string;jobId:string;accountId:string;channelId:string;scope:SlackHistoryScope;checkpoint:Parameters<typeof readSlackHistoryBatch>[3];maxPages:number;authorised:()=>Promise<boolean>;request:Parameters<typeof readSlackHistoryBatch>[5]['request']};
/** Trusted server binding must verify claimed job, account/team/token, consent,
 * window and checkpoint. Browser/job payload is never itself a binding. */
export function createSlackHistoryHandler(bind:(ctx:WorkerHandlerContext)=>Promise<SlackHistoryBinding|null>,clock:()=>number=Date.now){
 return async(ctx:WorkerHandlerContext):Promise<WorkerHandlerResult>=>{
  if(!ctx.jobId||ctx.signal?.aborted)return {success:false,error:{code:'slack_history_job_required',message:'A running durable job is required.',retryable:false}};
  try{const binding=await bind(ctx);
   if(!binding||binding.tenantId!==ctx.tenantId||binding.jobId!==ctx.jobId)return {success:false,error:{code:'slack_history_binding_unavailable',message:'Approved server-side history binding is unavailable.',retryable:false}};
   const checkpoint=await readSlackHistoryBatch(binding.scope,ctx.tenantId,binding.channelId,binding.checkpoint,binding.maxPages,{authorised:async()=>!ctx.signal?.aborted&&await binding.authorised(),request:binding.request,persist:slackHistoryPersistence(ctx.supabaseAdmin,ctx.tenantId,ctx.jobId,binding.accountId)},1);
   return {success:true,result:{...checkpoint,coverage:'bounded_channel_history',ingestion_complete:false},...(checkpoint.stopReason==='run_page_limit'?{continuation:{jobType:'slack.history_sync',jobKey:`slack.history:${binding.accountId}`,connectorId:'slack',payload:{connector_account_id:binding.accountId},availableAt:new Date(clock()+60000).toISOString()}}:{})};
  }catch(error){if(error instanceof SlackHistoryTransportError)return {success:false,error:{code:error.code,message:error.message,retryable:error.retryable,retryAfterSeconds:error.retryAfterSeconds}};return {success:false,error:{code:'slack_history_failed',message:'History scope, provider page or durable checkpoint could not be verified.',retryable:false}};}
 };
}
// Missing storage, connection, approved scope or claimed job prevents any fetch.
export const handleSlackHistorySync=createSlackHistoryHandler(ctx=>
 createStoredHistoryBinding(createHistoryRequestAdapter(createSlackHistoryServerPorts(ctx)))(ctx));
