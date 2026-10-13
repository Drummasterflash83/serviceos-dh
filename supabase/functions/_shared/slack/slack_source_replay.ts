import {assertSlackHistoryScope,historyScopeKey} from './slack_history.ts';
import type {SlackHistoryScope} from './slack_history.ts';
import type {WorkerHandlerContext} from '../worker_contract.ts';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
/** Only the fenced service RPC supplies scope. Job payload is an identity hint,
 * never an approval, timestamp, public-channel assertion, or new request budget. */
export async function readStoredSourceReplay(ctx:WorkerHandlerContext,accountId:string,replayId:unknown,clock:()=>number){
 if(!uuid(replayId)||!uuid(accountId)||!ctx.claim)return null;
 const {data:r,error}=await ctx.supabaseAdmin.rpc('learn_slack_source_replay_scope',{p_tenant:ctx.tenantId,p_job:ctx.jobId,p_claimed_by:ctx.claim.claimedBy,p_attempt:ctx.claim.attemptCount});
 if(error||!r||r.replayId!==replayId||r.accountId!==accountId||!uuid(r.sourceId)||typeof r.sourceVersion!=='string'||!/^[a-f0-9]{64}$/.test(r.sourceVersion))return null;
 const c=r.scope;
 if(!c||c.approved!==true||!uuid(c.connectionId)||!uuid(c.campaignId)||c.maxPages!==1||typeof c.expiresAt!=='string'||!Number.isFinite(Date.parse(c.expiresAt))||Date.parse(c.expiresAt)<=clock()||c.consentReference!==`learn-slack-source-replay:${replayId}`||typeof r.timestamp!=='string'||!/^\d{1,12}\.\d{1,6}$/.test(r.timestamp))return null;
 const scope:SlackHistoryScope={tenantId:ctx.tenantId,teamId:c.teamId,channelIds:[c.channelId],oldest:c.oldest,latest:c.latest,consentReference:c.consentReference,...(c.parentTimestamp?{parentTimestamp:c.parentTimestamp}:{})};
 try{assertSlackHistoryScope(scope,ctx.tenantId,c.channelId,null);}catch{return null;}
 const micros=(v:string)=>{const[s,f]=v.split('.');return BigInt(s)*1000000n+BigInt(f.padEnd(6,'0'));};
 if(micros(scope.oldest)!==micros(r.timestamp)-1n||micros(scope.latest)!==micros(r.timestamp)+1n)return null;
 if(scope.parentTimestamp&&(!/^\d{1,12}\.\d{1,6}$/.test(scope.parentTimestamp)||micros(scope.parentTimestamp)>=micros(r.timestamp)))return null;
 return {connectionId:c.connectionId,accountId,threadImportId:undefined,sourceReplayId:replayId,scope,channelId:c.channelId,maxPages:1,expiresAt:c.expiresAt,checkpoint:{scopeKey:historyScopeKey(scope,c.channelId),cursor:null,pages:0,complete:false}};
}
/** One fetched page only, exact retained-source comparison happens in SQL.
 * Missing/changed source gets a held receipt; no guessed proof or cursor reset. */
export function sourceReplayPersistence(db:WorkerHandlerContext['supabaseAdmin'],ctx:WorkerHandlerContext,captureVisibility?:()=>Readonly<Record<string,unknown>>|null){
 return async(page:{records:unknown[]},_expected:unknown,next:{pages:number;complete:boolean;cursor:string|null})=>{
  if(!ctx.claim||next.pages!==1||!next.complete||next.cursor!==null||page.records.length>1)throw Error('slack_history_replay_window_incomplete');
  const visibility=captureVisibility?.();if(!visibility)throw Error('slack_history_replay_visibility_unavailable');
  const {data,error}=await db.rpc('learn_slack_commit_source_replay',{p_tenant:ctx.tenantId,p_job:ctx.jobId,p_claimed_by:ctx.claim.claimedBy,p_attempt:ctx.claim.attemptCount,p_records:page.records,p_visibility:visibility});
  if(error||data!==true)throw Error('slack_history_replay_commit_unconfirmed');
 };
}
