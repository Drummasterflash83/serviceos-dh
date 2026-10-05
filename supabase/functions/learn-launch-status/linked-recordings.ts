/** Metadata-only reconciliation for supplied tenant-scoped rows. Does not infer
 * canonical call direction, playable audio, transcription or provider coverage. */
export function linkedRecordingIds(tenant:string,call:{tenant_id:string;provider_call_id:string|null;linked_id:string|null},rows:readonly {tenant_id:string;id:string;provider_call_id:string|null;linked_id:string|null}[]){
 if(!tenant||call.tenant_id!==tenant)throw Error('recording_tenant_mismatch');
 const ids=new Set<string>();
 for(const r of rows){if(r.tenant_id!==tenant)throw Error('recording_tenant_mismatch');if(!r.id)throw Error('recording_identity_unavailable');
  if(call.provider_call_id&&r.provider_call_id===call.provider_call_id||call.linked_id&&r.linked_id===call.linked_id)ids.add(r.id);
 }
 return [...ids].sort();
}
