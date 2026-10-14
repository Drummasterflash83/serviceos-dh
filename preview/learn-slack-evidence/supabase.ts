const id=(n:number)=>`a0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const supabaseConfig={url:'synthetic://slack-evidence'};
export const scenario={denied:false,fail:false,changed:false,delay:false};
export function getSupabaseClient(){return {rpc(name:string,args:any){return {async abortSignal(signal:AbortSignal){
  if(scenario.delay)await new Promise(r=>setTimeout(r,1500));signal.throwIfAborted();
  if(scenario.denied || scenario.fail)return {data:null,error:{message:'Synthetic unavailable'}};
  const operator=args.p_operator_reason!==null;
  if(name==='learn_slack_evidence_read'){
    const n=args.p_after?4:3;const row={id:id(n),interaction_id:id(n+10),source_id:id(n+20),source_version:'a'.repeat(64),recorded_at:new Date().toISOString(),posted_at:'2022-04-07T15:57:01Z',channel_id:args.p_tenant===id(101)?'CSECOND':'CSYNTHETIC',summary:'Saved parts request',excerpt:'Synthetic historical request — no customer or job has been assigned.',attribution:'unresolved'};
    return {data:{version:'learn-slack-evidence/1',tenant_id:args.p_tenant,actor_id:id(2),after:args.p_after,rows:[row],next_after:args.p_after?null:id(3),scanned:1,observed_at:new Date().toISOString(),operator_mode:operator,audit_id:operator?id(90):null},error:null};
  }
  if(name==='learn_slack_card_source_read')return {data:{version:'learn-slack-card-source/1',tenant_id:args.p_tenant,actor_id:id(2),id:args.p_id,operator_mode:operator,audit_id:operator?id(90):null,observed_at:new Date().toISOString(),record:{id:args.p_id,tenant_id:args.p_tenant,message_text:'Synthetic original message: Please review the requested part. <script>untrusted()</script>',text_shortened:false,team_id:'TTEST',channel_id:args.p_tenant===id(101)?'CSECOND':'CSYNTHETIC',posted_at:'2022-04-07T15:57:01Z',provider_timestamp:'1649347021.000000',thread_timestamp:null,source_version:(scenario.changed?'b':'a').repeat(64),retained_at:new Date().toISOString(),author_ref:'UTEST'}},error:null};
  throw Error('Unexpected synthetic request');
}};}};}
