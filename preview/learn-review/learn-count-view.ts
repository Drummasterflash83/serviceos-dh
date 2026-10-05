import {validateLearnStatus,learnStatusState} from './source/lib/learn-status-contract.ts';

export type StoredObservation = {state:'ready';snapshot:unknown}|{state:'denied'|'unavailable'|'failed'|'loading'};
/** Presentation only. Caller must use the existing authenticated read contract;
 * this function neither authorises nor fetches, and never invents sync/coverage. */
export function learnCountView(tenantId:string, observation:StoredObservation|null, now:number){
 const unknown={email:null as number|null,phone:null as number|null,latestEmailStorageAt:null as string|null,latestPhoneStorageAt:null as string|null};
 if(!Number.isFinite(now))return {...unknown,state:'unavailable' as const};
 if(!observation || observation.state!=='ready')return {...unknown,state:observation?.state??'unavailable'};
 const snapshot=validateLearnStatus(observation.snapshot,tenantId);
 if(!snapshot)return {...unknown,state:'unavailable' as const};
 const state=learnStatusState(snapshot,now);
 if(state==='stale'||state==='unavailable')return {...unknown,state};
 return {state,email:snapshot.email.record_count,phone:snapshot.phone.record_count,
  latestEmailStorageAt:snapshot.email.latest_record_at,latestPhoneStorageAt:snapshot.phone.latest_record_at};
}
