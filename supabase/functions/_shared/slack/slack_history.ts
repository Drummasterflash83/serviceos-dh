/** Source-only history reader. Caller supplies a persisted, authorised scope and
 * an existing server-side Slack request function. No token, job, grant or write here. */
export interface SlackHistoryScope{tenantId:string;teamId:string;channelIds:readonly string[];oldest:string;latest:string;consentReference:string}
export async function readSlackHistoryPage(scope:SlackHistoryScope,tenantId:string,channelId:string,cursor:string|null,request:(method:string,body:Record<string,unknown>)=>Promise<any>){
 assertSlackHistoryScope(scope,tenantId,channelId,cursor);
 const page=await request('conversations.history',{channel:channelId,oldest:scope.oldest,latest:scope.latest,limit:15,...(cursor?{cursor}:{})});
 if(page?.ok!==true||!Array.isArray(page.messages)||page.messages.length>15||typeof page.has_more!=='boolean')throw Error('history_page_unavailable');
 const seen=new Set<string>();
 const records=page.messages.map((m:any)=>{if(!m||typeof m.text!=='string'||m.text.length>40000||!/^\d{1,12}\.\d{1,6}$/.test(m.ts)||Number(m.ts)<Number(scope.oldest)||Number(m.ts)>Number(scope.latest)||m.subtype&&m.subtype!=='bot_message'||seen.has(m.ts)||m.thread_ts!==undefined&&(typeof m.thread_ts!=='string'||!/^\d{1,12}\.\d{1,6}$/.test(m.thread_ts)))throw Error('history_page_integrity');
  const encoded=JSON.stringify(m);if(new TextEncoder().encode(encoded).length>262144)throw Error('history_message_too_large');
  seen.add(m.ts);return {tenant_id:tenantId,source_external_id:`${scope.teamId}:${channelId}:${m.ts}`,source_connector_id:'slack',channel_id:channelId,provider_timestamp:m.ts,thread_timestamp:typeof m.thread_ts==='string'?m.thread_ts:null,text:m.text,provider_payload:JSON.parse(encoded)};});
 const next=page.response_metadata?.next_cursor;
 if(next!==undefined&&(typeof next!=='string'||next.length>1024)||page.has_more&&!(typeof next==='string'&&next.length)||!page.has_more&&!!next)throw Error('history_cursor_unavailable');
 return {records,nextCursor:next||null,historyComplete:!page.has_more,coverage:'channel_history_page_only' as const,threadCoverage:'unverified' as const};
}

export function assertSlackHistoryScope(scope:SlackHistoryScope,tenantId:string,channelId:string,cursor:string|null){
 if(scope.tenantId!==tenantId||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tenantId)||!/^T[A-Z0-9]+$/.test(scope.teamId)||!/^C[A-Z0-9]+$/.test(channelId)||!scope.channelIds.includes(channelId)||!scope.consentReference||!/^\d{1,12}\.\d{1,6}$/.test(scope.oldest)||!/^\d{1,12}\.\d{1,6}$/.test(scope.latest)||Number(scope.oldest)>Number(scope.latest)||cursor!==null&&(typeof cursor!=='string'||cursor.length>1024))throw Error('history_scope_unavailable');
}
export function historyScopeKey(scope:SlackHistoryScope,channelId:string){return JSON.stringify([scope.tenantId,scope.teamId,channelId,scope.oldest,scope.latest,scope.consentReference]);}
