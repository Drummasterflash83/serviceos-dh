import {SlackHistoryTransportError} from './slack_history_errors.ts';
import {historyScopeKey,assertSlackHistoryScope} from './slack_history.ts';
import type {SlackHistoryScope} from './slack_history.ts';
import type {WorkerHandlerContext} from '../worker_contract.ts';
import type {SlackHistoryBinding} from '../worker_handlers/slack_history.ts';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
/** Credential-owning server adapter must attest real team/channel membership and
 * revalidate its lease. No token is accepted, read or returned by this module. */
import type {BindHistoryRequest} from './slack_history_request.ts';
export type {BindHistoryRequest,HistoryRequestBinding,HistoryRequestIdentity} from './slack_history_request.ts';
export async function readStoredHistoryScope(ctx:WorkerHandlerContext,clock:()=>number){
 if(!uuid(ctx.tenantId)||!uuid(ctx.jobId)||ctx.signal?.aborted||!ctx.claim?.claimedBy||!Number.isSafeInteger(ctx.claim.attemptCount)||ctx.claim.attemptCount<1)return null;
 const db=ctx.supabaseAdmin,thread=ctx.jobType==='slack.thread_sync';
 const job=await db.from('platform_jobs').select('id,tenant_id,job_type,status,payload,claimed_by,attempt_count,lease_expires_at').eq('tenant_id',ctx.tenantId).eq('id',ctx.jobId).maybeSingle();
 if(job.error||!job.data||job.data.id!==ctx.jobId||job.data.tenant_id!==ctx.tenantId||job.data.job_type!==(thread?'slack.thread_sync':'slack.history_sync')||job.data.status!=='running'||!uuid(job.data.payload?.connector_account_id))return null;
 if(job.data.claimed_by!==ctx.claim.claimedBy||job.data.attempt_count!==ctx.claim.attemptCount||!Number.isFinite(Date.parse(job.data.lease_expires_at))||Date.parse(job.data.lease_expires_at)<=clock())return null;
 const accountId=job.data.payload.connector_account_id;
 const account=await db.from('connector_accounts').select('id,tenant_id,tenant_connector_id,status,settings,sync_cursor').eq('tenant_id',ctx.tenantId).eq('id',accountId).maybeSingle();
 if(account.error||!account.data||account.data.tenant_id!==ctx.tenantId||account.data.id!==accountId||account.data.status!=='active'||!uuid(account.data.tenant_connector_id))return null;
 const connector=await db.from('tenant_connectors').select('id,tenant_id,connector_id,enabled,status').eq('tenant_id',ctx.tenantId).eq('id',account.data.tenant_connector_id).maybeSingle();
 if(connector.error||!connector.data||connector.data.tenant_id!==ctx.tenantId||connector.data.id!==account.data.tenant_connector_id||connector.data.connector_id!=='slack'||connector.data.enabled!==true||connector.data.status!=='active')return null;
 let cfg=account.data.settings?.slack_history,saved=account.data.sync_cursor;
 let threadImportId:string|undefined;
 if(thread){
  if(!uuid(job.data.payload?.thread_import_id))return null;threadImportId=job.data.payload.thread_import_id;
  const approval=await db.from('slack_thread_imports').select('id,tenant_id,account_id,scope,checkpoint,definition').eq('tenant_id',ctx.tenantId).eq('id',threadImportId).maybeSingle();
  if(approval.error||approval.data?.id!==threadImportId||approval.data?.tenant_id!==ctx.tenantId||approval.data?.account_id!==accountId)return null;
  // Ongoing thread approvals can be paused independently of a retained page.
  if(approval.data.definition && Object.hasOwn(approval.data.definition,'recurringHistoryImportId')){
   const gate=await db.rpc('learn_slack_recurring_thread_allowed',{p_tenant:ctx.tenantId,p_import:threadImportId});
   if(gate.error||gate.data!==true)return null;
  }
  cfg=approval.data.scope;saved=approval.data.checkpoint;
  if(typeof cfg?.parentTimestamp!=='string'||!/^\d{1,12}\.\d{1,6}$/.test(cfg.parentTimestamp)||Number(cfg.parentTimestamp)>Number(cfg.latest))return null;
 }
 const now=clock();
 if(!cfg||typeof cfg.consentReference!=='string'||!cfg.consentReference.trim()||cfg.consentReference.length>2000||cfg.approved!==true||!Number.isFinite(now)||typeof cfg.expiresAt!=='string'||!Number.isFinite(Date.parse(cfg.expiresAt))||Date.parse(cfg.expiresAt)<=now||!Number.isSafeInteger(cfg.maxPages)||cfg.maxPages<1||cfg.maxPages>10||typeof cfg.channelId!=='string'||typeof cfg.oldest!=='string'||typeof cfg.latest!=='string')return null;
 const scope:SlackHistoryScope={tenantId:ctx.tenantId,teamId:cfg.teamId,channelIds:[cfg.channelId],oldest:cfg.oldest,latest:cfg.latest,consentReference:cfg.consentReference,...(thread?{parentTimestamp:cfg.parentTimestamp}:{})};
 assertSlackHistoryScope(scope,ctx.tenantId,cfg.channelId,null);
 const scopeKey=historyScopeKey(scope,cfg.channelId);
 const checkpoint=saved&&Object.keys(saved).length===0?{scopeKey,cursor:null,pages:0,complete:false}:saved;
 if(!checkpoint||checkpoint.scopeKey!==scopeKey||!Number.isSafeInteger(checkpoint.pages)||checkpoint.pages<0||checkpoint.pages>cfg.maxPages||typeof checkpoint.complete!=='boolean'||checkpoint.cursor!==null&&(typeof checkpoint.cursor!=='string'||checkpoint.cursor.length===0||checkpoint.cursor.length>1024)||checkpoint.complete&&checkpoint.cursor!==null)return null;
 return {connectionId:cfg.connectionId,accountId,threadImportId,scope,channelId:cfg.channelId,checkpoint,maxPages:cfg.maxPages,expiresAt:cfg.expiresAt};
}
/** Reads authoritative durable job/config only; browser/queued payload is not
 * used as consent. The transport separately verifies the credential connection. */
export function createStoredHistoryBinding(bindRequest:BindHistoryRequest,clock:()=>number=Date.now){
 return async(ctx:WorkerHandlerContext):Promise<SlackHistoryBinding|null>=>{
  try{const stored=await readStoredHistoryScope(ctx,clock);if(!stored)return null;
   const bound=await bindRequest({tenantId:ctx.tenantId,accountId:stored.accountId,teamId:stored.scope.teamId,channelId:stored.channelId,oldest:stored.scope.oldest,latest:stored.scope.latest,consentReference:stored.scope.consentReference,expiresAt:stored.expiresAt,maxPages:stored.maxPages,...(stored.scope.parentTimestamp?{parentTimestamp:stored.scope.parentTimestamp}:{})});
   if(!bound||bound.teamId!==stored.scope.teamId||bound.channelId!==stored.channelId||bound.isPrivate!==false||bound.isShared!==false||typeof bound.isMember!=='boolean'||(bound.isMember!==true&&bound.publicUserAccess!==true))return null;
   return {captureVisibility:bound.captureVisibility,tenantId:ctx.tenantId,jobId:ctx.jobId!,...stored,scope:{...stored.scope,pageLimit:bound.pageLimit??15},request:bound.request,authorised:async()=>{try{
    const current=await readStoredHistoryScope(ctx,clock);return !!current&&current.accountId===stored.accountId&&current.maxPages===stored.maxPages&&current.expiresAt===stored.expiresAt&&historyScopeKey(current.scope,current.channelId)===historyScopeKey(stored.scope,stored.channelId)&&await bound.authorised();
   }catch(error){if(error instanceof SlackHistoryTransportError)throw error;return false;}}};
  }catch(error){if(error instanceof SlackHistoryTransportError)throw error;return null;}
 };
}
