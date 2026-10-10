const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const tenant=id(1);
export const actor=id(80);
export const supabaseConfig={url:'https://synthetic-commusoft.invalid'};
const receiptKey='synthetic:commusoft-work:receipts';
let linked:any=null;
const scenario=new URLSearchParams(location.search).get('scenario');
export function getSupabaseClient(){return {rpc:async(name:string,args:Record<string,any>)=>{
 if(args.p_tenant!==tenant)throw Error('Synthetic tenant mismatch');
 if(scenario==='unavailable')return {data:null,error:{code:'42501'}};
 let data:any;
 if(name==='learn_commusoft_review_connections')data={tenant_id:tenant,connections:[{id:id(2),name:'Synthetic Drummonds input'}]};
 else if(name==='learn_commusoft_work_review_page')data={tenant_id:tenant,connection_id:id(2),kind:args.p_kind,rows:[11,12].map((n)=>({external_id:String(n),version_id:id(n),title:n===11?'Boiler service — sample premises':'Repair — customer needs review',property_reference:n===11?'1':'999',customer_name:n===11?'Alex Sample':null,relationship_reason:n===11?null:'property_identity_unreviewed',source_status:args.p_kind==='job'?'Open':null,linked_version_id:null,last_result:null,selectable:true})),next_cursor:null};
 else if(name==='learn_commusoft_work_batch_result')data=JSON.parse(localStorage.getItem(receiptKey)??'{}')[args.p_request]??null;
 else if(name==='learn_commusoft_work_batch'){
  const saved=JSON.parse(localStorage.getItem(receiptKey)??'{}');
  const items=args.p_cancel?[]:args.p_items.map((item:any)=>({version_id:item.version_id,outcome:item.version_id===id(11)?{state:'linked',entity_id:id(90),entity_kind:args.p_kind,link_id:id(91),already:false}:{state:'held',reason:'property_identity_unreviewed'}}));
  data=saved[args.p_request]??{batch_id:args.p_request,tenant_id:tenant,actor_id:actor,connection_id:id(2),kind:args.p_kind,state:args.p_cancel?'cancelled':'recorded',items,linked:items.filter((i:any)=>i.outcome.state==='linked').length,held:items.filter((i:any)=>i.outcome.state==='held').length};
  saved[args.p_request]=data;localStorage.setItem(receiptKey,JSON.stringify(saved));
  if(scenario==='uncertain')return {data:null,error:{code:'SyntheticLostReply'}};
 }
 else if(name==='learn_commusoft_review_page')data={tenant_id:tenant,connection_id:id(2),rows:[{version_id:id(3),external_id:'101',observed_at:'2026-10-10T08:00:00Z',summary:{person_name:'Alex Sample',company_name:null,email:'alex@example.invalid',phone:'01234 000000',address:'1 Synthetic Road',postcode:'TEST 1AA',source_type:'customer',customer_type:'45'},link:linked}],next_cursor:null};
 else if(name==='learn_commusoft_customer_candidates')data={tenant_id:tenant,version_id:id(3),kind:args.p_kind,rows:args.p_kind==='person'?[{id:id(4),name:'Alex Sample',email:'alex@example.invalid',phone:'01234 000000',postcode:'TEST 1AA',reason:'shared_email'}]:[],next_cursor:null};
 else if(name==='learn_commusoft_confirm_customer'){
  linked={entity_table:args.p_kind==='person'?'people':'companies',entity_id:args.p_target??id(7),card_id:id(5),source_version_id:id(3)};
  if(scenario==='uncertain')return {data:null,error:{code:'SyntheticLostReply'}};
  data={...linked,link_id:id(6),already:false};
 }else throw Error('Unexpected synthetic RPC');
 return {data:structuredClone(data),error:null};
}};}
