import {slackMessageKind} from './slack_message_kind.ts';
import {assertSlackHistoryScope} from './slack_history.ts';
import type {SlackHistoryScope} from './slack_history.ts';

const timestamp=(value:unknown):value is string=>typeof value==='string'&&/^\d{1,12}\.\d{1,6}$/.test(value);
const micros=(value:string)=>{const [seconds,fraction]=value.split('.');return BigInt(seconds)*1000000n+BigInt(fraction.padEnd(6,'0'));};
export type SlackThreadScope=SlackHistoryScope&{parentTimestamp:string};
/** A thread is an additional bounded read within the approved channel/window.
 * Root discovery must come from stored provider evidence, never guessed IDs.
 * Completion applies only to this observed thread and this time window. */
export async function readSlackThreadPage(scope:SlackThreadScope,tenantId:string,channelId:string,cursor:string|null,
 request:(method:string,args:Record<string,unknown>)=>Promise<any>){
 assertSlackHistoryScope(scope,tenantId,channelId,cursor);
 if(!timestamp(scope.parentTimestamp)||micros(scope.parentTimestamp)>micros(scope.latest))throw Error('thread_scope_unavailable');
 const page=await request('conversations.replies',{channel:channelId,ts:scope.parentTimestamp,oldest:scope.oldest,latest:scope.latest,limit:scope.pageLimit??15,...(cursor?{cursor}:{})});
 if(page?.ok!==true||!Array.isArray(page.messages)||page.messages.length>(scope.pageLimit??15)||typeof page.has_more!=='boolean')throw Error('thread_page_unavailable');
 const seen=new Set<bigint>();
 const records=page.messages.map((m:any)=>{
  if(!m||!timestamp(m.ts)||typeof m.text!=='string'||m.text.length>40000||seen.has(micros(m.ts))
   ||micros(m.ts)<micros(scope.oldest)||micros(m.ts)>micros(scope.latest)||micros(m.ts)<micros(scope.parentTimestamp)
   ||m.ts===scope.parentTimestamp&&(m.thread_ts!==undefined&&m.thread_ts!==scope.parentTimestamp)
   ||m.ts!==scope.parentTimestamp&&m.thread_ts!==scope.parentTimestamp)throw Error('thread_page_integrity');
  slackMessageKind(m);
  if(m.subtype==='thread_broadcast' && m.ts===scope.parentTimestamp)throw Error('thread_page_integrity');
  const encoded=JSON.stringify(m);if(new TextEncoder().encode(encoded).length>262144)throw Error('thread_message_too_large');
  seen.add(micros(m.ts));return {tenant_id:tenantId,source_external_id:`${scope.teamId}:${channelId}:${m.ts}`,source_connector_id:'slack',channel_id:channelId,provider_timestamp:m.ts,thread_timestamp:typeof m.thread_ts==='string'?m.thread_ts:null,text:m.text,provider_payload:JSON.parse(encoded)};
 });
 const next=page.response_metadata?.next_cursor;
 if(next!==undefined&&(typeof next!=='string'||next.length>1024)||page.has_more&&!(typeof next==='string'&&next.length)||!page.has_more&&!!next||next&&next===cursor)throw Error('thread_cursor_unavailable');
 return {records,nextCursor:next||null,threadComplete:!page.has_more,coverage:'observed_thread_window' as const,parentTimestamp:scope.parentTimestamp};
}

/** Candidate IDs preserve provider evidence and do not infer absent threads.
 * Replies/broadcasts can identify a parent older than this history window. */
export function observedThreadParents(records:ReadonlyArray<{provider_timestamp:string;thread_timestamp:string|null;provider_payload:Record<string,unknown>}>){
 const parents=new Set<string>();
 for(const r of records){
  const count=r.provider_payload.reply_count;
  if(count!==undefined&&(!Number.isSafeInteger(count)||Number(count)<0))throw Error('thread_discovery_invalid');
  if(r.thread_timestamp!==null){
   if(!timestamp(r.thread_timestamp)||!timestamp(r.provider_timestamp)||micros(r.thread_timestamp)>micros(r.provider_timestamp))throw Error('thread_discovery_invalid');
   if(r.thread_timestamp!==r.provider_timestamp||Number(count)>0)parents.add(r.thread_timestamp);
  }else if(Number(count)>0){if(!timestamp(r.provider_timestamp))throw Error('thread_discovery_invalid');parents.add(r.provider_timestamp);}
 }
 return [...parents].sort((a,b)=>micros(a)<micros(b)?-1:micros(a)>micros(b)?1:0);
}
