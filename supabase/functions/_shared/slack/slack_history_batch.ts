import {readSlackHistoryPage,assertSlackHistoryScope,historyScopeKey} from './slack_history.ts';
import type {SlackHistoryScope} from './slack_history.ts';
/** Unregistered coordinator. The persistence port must atomically upsert messages
 * by tenant/source identity and compare-and-swap the checkpoint. No credentials,
 * retry loop, storage or job registration are provided by this source artifact. */
export async function readSlackHistoryBatch(scope:SlackHistoryScope, tenantId:string, channelId:string,
 checkpoint:{scopeKey:string;cursor:string|null;pages:number;complete:boolean}, maxPages:number,
 ports:{authorised:()=>Promise<boolean>;request:(method:string,body:Record<string,unknown>)=>Promise<any>;
 persist:(page:Awaited<ReturnType<typeof readSlackHistoryPage>>, expected:typeof checkpoint, next:typeof checkpoint)=>Promise<void>}) {
 if(checkpoint.cursor!==null&&(typeof checkpoint.cursor!=='string'||checkpoint.cursor.length===0||checkpoint.cursor.length>1024)||!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>10||!Number.isSafeInteger(checkpoint.pages)||checkpoint.pages<0||checkpoint.pages>maxPages||typeof checkpoint.complete!=='boolean'||checkpoint.complete&&checkpoint.cursor!==null)throw Error('history_checkpoint_invalid');
 assertSlackHistoryScope(scope,tenantId,channelId,checkpoint.cursor);
 if(checkpoint.scopeKey!==historyScopeKey(scope,channelId))throw Error('history_checkpoint_scope_mismatch');
 if(!await ports.authorised())throw Error('history_authority_unavailable');
 let current={...checkpoint};const seen=new Set<string>();if(current.cursor)seen.add(current.cursor);
 while(!current.complete&&current.pages<maxPages){
  if(!await ports.authorised())throw Error('history_authority_unavailable');
  const page=await readSlackHistoryPage(scope,tenantId,channelId,current.cursor,ports.request);
  if(page.nextCursor&&seen.has(page.nextCursor))throw Error('history_cursor_cycle');
  if(!await ports.authorised())throw Error('history_authority_changed');
  const next={scopeKey:current.scopeKey,cursor:page.nextCursor,pages:current.pages+1,complete:page.historyComplete};
  await ports.persist(page,{...current},{...next}); // Failure never advances local checkpoint.
  current=next;if(current.cursor)seen.add(current.cursor);
 }
 return {...current,stopReason:current.complete?'window_pages_complete':'page_budget_exhausted',threadCoverage:'unverified' as const};
}
