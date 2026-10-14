import { LearnImportedCustomerDetail } from './LearnImportedCustomerDetail';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { ImportedSource } from '@/lib/learn-imported-customers';
import { useEffect, useRef, useState } from 'react';
import { getSupabaseClient, supabaseConfig } from '@/lib/supabase';
import { readImportedCustomers, type ImportedPage, type ImportedScope } from '@/lib/learn-imported-customers';
const labels={commusoft:'Commusoft',quickbooks:'QuickBooks'};
const reviews={reviewed:'Reviewed customer link',unreviewed:'Identity review needed',review_changed:'New details need review',source_conflict:'Source record needs checking'};
export function LearnImportedCustomers({tenantId,actorId,operatorReason,onOpenCard}:{tenantId:string;actorId:string;operatorReason?:string;onOpenCard?:(id:string)=>void}) {
 const [provider,setProvider]=useState<ImportedScope['provider']>('all'),[environment,setEnvironment]=useState<ImportedScope['environment']>('production');
 const [draft,setDraft]=useState(''),[query,setQuery]=useState(''),[cursors,setCursors]=useState<(string|null)[]>([null]),[group,setGroup]=useState<string|null>(null);
 const [selected,setSelected]=useState<ImportedSource|null>(null);
 const [result,setResult]=useState<{key:string;data:ImportedPage}|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0);
 const generation=useRef(0),request=useRef<AbortController|null>(null);
 const after=cursors[cursors.length-1],scope:ImportedScope={tenant:tenantId,actor:actorId,environment,provider,query,after,group,operatorReason};
 const scopeKey=JSON.stringify([supabaseConfig.url,tenantId,actorId,operatorReason,provider,environment,query,after,group,refresh]);
 const visible=result?.key===scopeKey?result.data:null;
 function restart(){setCursors([null]);setGroup(null);}
 function clear(){generation.current++;request.current?.abort();setResult(null);setSelected(null);setBusy(false);}
 useEffect(()=>{clear();setNotice('');const ticket=generation.current,controller=new AbortController();request.current=controller;setBusy(true);
  void(async()=>{try{const {data,error}=await getSupabaseClient().rpc('learn_imported_customer_catalog',{p_tenant:tenantId,p_environment:environment,p_provider:provider,p_query:query,p_after:after,p_operator_reason:operatorReason??null,p_group_key:group}).abortSignal(AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]));if(error)throw Error();const page=readImportedCustomers(data,scope);if(ticket===generation.current)setResult({key:scopeKey,data:page});}catch{if(ticket===generation.current)setNotice('Captured customers are temporarily unavailable. Refresh or ask OpenFolk to check access.');}finally{if(ticket===generation.current)setBusy(false);}})();return()=>{generation.current++;controller.abort();};
 },[scopeKey]);
 useEffect(()=>{const hide=()=>{if(document.hidden){clear();setNotice('Refresh to recheck access to captured customer records.');}};document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide);},[]);
 useEffect(()=>{if(!result)return;const timer=setTimeout(()=>{clear();setNotice('Refresh to check the latest captured customer details.');},60000);return()=>clearTimeout(timer);},[result]);
 return <section aria-label="Imported customer records" className="min-w-0 space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Customers from your connected systems</h3><p className="text-sm">Captured account details, with their source. Only reviewed links are combined.</p></div><button className="cp-secondary" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Refresh imported customers</button></div>
  {environment==='sandbox'&&<p className="font-semibold">Sandbox demonstration — QuickBooks records here are sample data.</p>}
  <form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();restart();setQuery(draft.trim());setRefresh(v=>v+1);}}>
   <label className="grid gap-1 text-sm">Customer source<select className="cp-input" value={provider} disabled={busy} onChange={e=>{setProvider(e.target.value as ImportedScope['provider']);restart();}}><option value="all">All connected sources</option><option value="commusoft">Commusoft</option><option value="quickbooks">QuickBooks</option></select></label>
   {operatorReason&&<label className="grid gap-1 text-sm">Accounting environment<select className="cp-input" value={environment} disabled={busy} onChange={e=>{setEnvironment(e.target.value as ImportedScope['environment']);restart();}}><option value="production">Live company</option><option value="sandbox">Sandbox demonstration</option></select></label>}
   <label className="grid flex-1 gap-1 text-sm">Find an imported customer<input type="search" className="cp-input w-full" value={draft} maxLength={200} placeholder="Name, contact, address or source reference" onChange={e=>setDraft(e.target.value)}/></label><button type="submit" className="cp-secondary" disabled={busy}>Find imported customers</button>
  </form>
  {group&&<button className="cp-secondary" onClick={()=>{restart();setQuery('');setDraft('');}}>Back to all imported customers</button>}
  {busy&&<p role="status">Checking captured customer records…</p>}{notice&&<p role="status">{notice}</p>}
  {visible&&<>
   <p className="text-sm">{visible.counts.commusoft_records.toLocaleString()} Commusoft customer records · {visible.counts.quickbooks_accounts.toLocaleString()} QuickBooks main accounts</p>
   <p className="text-sm">{visible.counts.matching_results.toLocaleString()} {query?'matching ':''}{group?'source records':'customer entries'} · {visible.counts.records_needing_review.toLocaleString()} source records need checking. Imported history and identity review may still be incomplete.</p>
   <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Captured customer cards">{visible.rows.map(row=><article key={row.key} className="cp-card min-w-0 space-y-3">
    <h4 className="break-words font-semibold">{row.name}</h4>
    {row.sources.map(source=><div key={source.key} className="min-w-0 space-y-1 border-t pt-2 text-sm"><p className="font-medium">{labels[source.provider]} · {reviews[source.review_state]}{source.active===false?' · Inactive in source':''}</p>
     {source.contact_name&&<p className="break-words">Primary contact: {source.contact_name}</p>}{source.email&&<p className="break-all">{source.email}</p>}{source.phone&&<p className="break-words">{source.phone}</p>}{source.address&&<p className="break-words">{source.provider==='quickbooks'?'Billing address':'Recorded address'}: {source.address}</p>}
     <button className="cp-secondary" disabled={source.review_state==='source_conflict'} onClick={()=>setSelected(source)}>View captured {source.provider==='commusoft'?'jobs & contacts':'accounting history'}</button>
     <p className="text-xs text-muted-foreground">Captured {new Date(source.observed_at).toLocaleString('en-GB')}</p>
     <details className="text-xs"><summary>Source details</summary><p className="break-all">Customer reference {source.external_id} · Source version {source.version_id}</p></details>
    </div>)}
    {row.total_sources>row.sources.length&&<button className="cp-secondary" onClick={()=>{setGroup(row.key);setCursors([null]);setQuery('');setDraft('');}}>See all {row.total_sources.toLocaleString()} source records</button>}
    {row.card_id&&onOpenCard?<button className="cp-secondary" onClick={()=>onOpenCard(row.card_id!)}>Open customer, jobs & communications</button>:<p className="text-xs text-muted-foreground">Customer-card links and communication attribution still need review.</p>}
   </article>)}</div>
   {!visible.rows.length&&<p>No captured customer records match this view. This does not prove there are no customers in the source system.</p>}
   <div className="flex flex-wrap justify-between gap-3"><button className="cp-secondary" disabled={cursors.length<2||busy} onClick={()=>setCursors(v=>v.slice(0,-1))}>Previous imported customers</button><button className="cp-secondary" disabled={!visible.next_after||busy} onClick={()=>visible.next_after&&setCursors(v=>[...v,visible.next_after])}>Next imported customers</button></div>
  </>}
  <Dialog open={!!selected} onOpenChange={open=>{if(!open)setSelected(null);}}><DialogContent className="lc-dialog" overlayClassName="lc-overlay"><DialogHeader><DialogTitle>{selected?.name??'Captured customer details'}</DialogTitle><DialogDescription>Details retained from the selected source account.</DialogDescription></DialogHeader>{selected&&<LearnImportedCustomerDetail key={selected.key+':'+selected.version_id} tenantId={tenantId} actorId={actorId} environment={environment} source={selected} operatorReason={operatorReason}/>}</DialogContent></Dialog>
 </section>;
}
