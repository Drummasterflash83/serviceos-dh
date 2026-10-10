const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const tenant=id(1);
let linked:any=null;
const scenario=new URLSearchParams(location.search).get('scenario');
export function getSupabaseClient(){return {rpc:async(name:string,args:Record<string,any>)=>{
 if(args.p_tenant!==tenant)throw Error('Synthetic tenant mismatch');
 if(scenario==='unavailable')return {data:null,error:{code:'42501'}};
 let data:any;
 if(name==='learn_commusoft_review_connections')data={tenant_id:tenant,connections:[{id:id(2),name:'Synthetic Drummonds input'}]};
 else if(name==='learn_commusoft_review_page')data={tenant_id:tenant,connection_id:id(2),rows:[{version_id:id(3),external_id:'101',observed_at:'2026-10-10T08:00:00Z',summary:{person_name:'Alex Sample',company_name:null,email:'alex@example.invalid',phone:'01234 000000',address:'1 Synthetic Road',postcode:'TEST 1AA',source_type:'customer',customer_type:'45'},link:linked}],next_cursor:null};
 else if(name==='learn_commusoft_customer_candidates')data={tenant_id:tenant,version_id:id(3),kind:args.p_kind,rows:args.p_kind==='person'?[{id:id(4),name:'Alex Sample',email:'alex@example.invalid',phone:'01234 000000',postcode:'TEST 1AA',reason:'shared_email'}]:[],next_cursor:null};
 else if(name==='learn_commusoft_confirm_customer'){
  linked={entity_table:args.p_kind==='person'?'people':'companies',entity_id:args.p_target??id(7),card_id:id(5),source_version_id:id(3)};
  if(scenario==='uncertain')return {data:null,error:{code:'SyntheticLostReply'}};
  data={...linked,link_id:id(6),already:false};
 }else throw Error('Unexpected synthetic RPC');
 return {data:structuredClone(data),error:null};
}};}
