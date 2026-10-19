import {useEffect,useRef,useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {getSupabaseClient} from "@/lib/supabase";
import type {QuickBooksConnection} from "@/lib/learn-quickbooks";
import {readMoneySourceReadiness,type MoneySourceReadiness} from "@/lib/learn-quickbooks-money-readiness";

/** OpenFolk-only, count-only metadata check. Never calculates money. */
export function OperatorQuickBooksMoneyReadiness({tenantId,actorId,canWrite,connections}:{
  tenantId:string;actorId:string;canWrite:boolean;connections:QuickBooksConnection[];
}) {
  const flag=useQuery({
    queryKey:["quickbooks-money-source-readiness-flag",tenantId,actorId],enabled:canWrite,
    queryFn:async()=>{
      const {data,error}=await getSupabaseClient().from("feature_flags").select("value")
        .eq("tenant_id",tenantId).eq("flag","new_dawn.money_source_readiness").maybeSingle();
      if(error) throw Error("Money source readiness flag unavailable");
      return data?.value===true;
    },staleTime:30_000,
  });
  const [connectionId,setConnectionId]=useState(""),[reason,setReason]=useState("");
  const [reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false);
  const [notice,setNotice]=useState(""),[result,setResult]=useState<MoneySourceReadiness|null>(null);
  const generation=useRef(0),working=useRef(false);
  useEffect(()=>{generation.current++;working.current=false;setConnectionId("");setReason("");
    setReviewed(false);setBusy(false);setNotice("");setResult(null);
    return()=>{generation.current++;};},[tenantId,actorId]);
  if(!canWrite||flag.data!==true)return null;
  const available=connections.filter(c=>c.confirmedAt&&c.realmId&&["active","paused"].includes(c.status));
  const selected=available.find(c=>c.id===connectionId);
  const ready=!!selected&&reason.trim().length>=3&&reason.trim().length<=500&&reviewed;
  async function inspect(){
    if(!ready||working.current||!selected)return;
    const ticket=generation.current;working.current=true;setBusy(true);setNotice("");setResult(null);
    try{
      const {data,error}=await getSupabaseClient().rpc("learn_quickbooks_money_source_readiness",{
        p_tenant:tenantId,p_connection:selected.id,p_reason:reason.trim(),
      }).abortSignal(AbortSignal.timeout(20_000));
      if(error)throw Error("Source readiness unavailable");
      const checked=readMoneySourceReadiness(data,{tenantId,connectionId:selected.id,
        environment:selected.environment,realmId:selected.realmId!});
      if(ticket===generation.current)setResult(checked);
    }catch{if(ticket===generation.current)setNotice("The source-readiness read could not be confirmed. Check the selected company and operator audit.");}
    finally{if(ticket===generation.current){working.current=false;setBusy(false);setReviewed(false);}}
  }
  const number=(n:number)=>new Intl.NumberFormat("en-GB").format(n);
  return <details className="min-w-0 rounded-xl border p-4" aria-label="QuickBooks money source readiness">
    <summary className="cursor-pointer font-semibold">Money source readiness · OpenFolk only</summary>
    <div className="mt-3 min-w-0 space-y-3">
    <p className="text-sm text-muted-foreground">Counts retained source fields for a selected company. It makes no provider request and shows no amounts. Field gross profit and ARR remain held until their source links and definitions are reviewed.</p>
    <label className="grid gap-1 text-sm">Connected company
      <select className="min-w-0 w-full rounded-lg border bg-background p-2" value={connectionId} disabled={busy}
        onChange={e=>{setConnectionId(e.target.value);setResult(null);setReviewed(false);}}>
        <option value="">Choose company</option>
        {available.map(c=><option key={c.id} value={c.id}>{c.companyName??c.realmId} · {c.environment==="production"?"LIVE":"Sandbox"}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-sm">Reason for this source read
      <input className="min-w-0 w-full rounded-lg border bg-background p-2" maxLength={500} value={reason} disabled={busy}
        onChange={e=>{setReason(e.target.value);setResult(null);setReviewed(false);}}/>
    </label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={busy||!selected}
      onChange={e=>setReviewed(e.target.checked)}/>I reviewed the selected client, QuickBooks company and reason.</label>
    <button className="cp-secondary" disabled={!ready||busy} onClick={()=>void inspect()}>{busy?"Checking saved sources…":"Check saved source readiness"}</button>
    {notice&&<p role="status" className="text-sm">{notice}</p>}
    {result&&<div role="status" className="space-y-2 text-sm">
      <p><strong>Field gross profit: held.</strong> QuickBooks job customers and cost-side line references are potential inputs. No reviewed Commusoft job mapping or actual job-cost ledger has been established.</p>
      <p><strong>ARR: held.</strong> Invoice repetition and item prices do not establish a recurring contract, period or end date. The current importer does not capture recurring transactions.</p>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
        <dt>Retained QuickBooks invoices</dt><dd>{number(result.retained.invoice_latest)}</dd>
        <dt>QuickBooks job customers</dt><dd>{number(result.retained.qbo_job_customers)}</dd>
        <dt>Bills with customer line references</dt><dd>{number(result.retained.bill_customer_line_refs)}</dd>
        <dt>Purchases with customer line references</dt><dd>{number(result.retained.purchase_customer_line_refs)}</dd>
        <dt>Invoices with item references</dt><dd>{number(result.retained.invoice_item_refs)}</dd>
        <dt>Items with purchase-cost fields</dt><dd>{number(result.retained.items_with_purchase_cost_field)}</dd>
        <dt>Commusoft job versions · tenant-wide</dt><dd>{number(result.retained.commusoft_job_versions)}</dd>
        <dt>Jobs with checked direct-cost fields</dt><dd>{number(result.retained.commusoft_jobs_with_checked_direct_cost_fields)}</dd>
        <dt>Invoices with checked recurrence markers</dt><dd>{number(result.retained.invoices_with_checked_recurring_markers)}</dd>
      </dl>
      <p className="break-all text-xs text-muted-foreground">QuickBooks latest observation: {result.latestObservedAt??"none"}. Read {result.readAt}. Audit {result.auditId}. Company {result.realmId} · {result.environment==="production"?"LIVE":"Sandbox"}. Field presence is evidence coverage, not a money figure.</p>
    </div>}
    </div>
  </details>;
}
