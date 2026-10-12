export type MicrosoftAccountStatus = {
  account_id: string; email_address: string; account_active: boolean; capture_allowed: boolean;
  bindings: number; enabled_bindings: number; coverage_complete: false; attachments_captured: false;
  saved_pages: number; settled_pages: number; last_saved_at: string | null; last_settled_at: string | null;
  published_observations: number; held_observations: number; draft_observations: number; removal_observations: number;
  physical_folders: number; search_folders: number; discovery_rounds: number; last_discovery_at: string | null;
  jobs: Record<string,number>; next_job_at: string | null; issue_code: string | null; issue_at: string | null;
};
export type MicrosoftStatusPage = {version:'learn-microsoft-status/1';tenant_id:string;observed_at:string;accounts:MicrosoftAccountStatus[];next_after:string|null};
export type MicrosoftStatusClient={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
const object=(v:any):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const count=(v:unknown)=>Number.isSafeInteger(v)&&(v as number)>=0;
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const nullable=(v:unknown,fn:(v:unknown)=>boolean)=>v===null||fn(v);
export const microsoftIssueHelp:Record<string,string>={
 microsoft_auth_required:'Reconnect the mailbox with the authorised Microsoft account.',
 microsoft_access_denied:'Review Microsoft mail permissions and mailbox access before resuming.',
 microsoft_folder_unavailable:'Review the missing folder and retain its saved history; folder recovery is not yet automated.',
 microsoft_delta_expired:'The provider checkpoint expired. Arrange a reviewed rescan while retaining saved history; automated reset is not yet available.',
 microsoft_throttled:'Wait until the next eligible retry; do not shorten the provider delay.',
 microsoft_provider_unavailable:'Check provider availability and the scheduled retry.',
 microsoft_fetch_failed:'Check worker connectivity and the scheduled retry.',
 microsoft_refresh_failed:'Check credential refresh and the scheduled retry; reconnect if consent has ended.',
 microsoft_credential_unavailable:'Verify the mailbox association and server credential configuration.',
 microsoft_reauthorization_required:'Renew Microsoft consent for this mailbox.',
 microsoft_capture_unconfirmed:'Inspect the saved job outcome before retrying; the request may already have been stored.',
 microsoft_retry_delay_requires_review:'Review the provider retry delay before scheduling further requests.',
 microsoft_capture_paused:'Review the Email capture switch. Saved evidence remains available.',
 microsoft_review_required:'Review the worker diagnostics and retained checkpoint before resuming.',
};
const countFields=['bindings','enabled_bindings','saved_pages','settled_pages','published_observations','held_observations','draft_observations','removal_observations','physical_folders','search_folders','discovery_rounds'] as const;
const dates=['last_saved_at','last_settled_at','last_discovery_at','next_job_at','issue_at'] as const;
const jobStates=['queued','retrying','running','succeeded','dead_letter','failed','cancelled','skipped','unknown'];
export function validMicrosoftStatus(v:any,tenant:string,after:string|null):v is MicrosoftStatusPage {
 if(!object(v)||v.version!=='learn-microsoft-status/1'||v.tenant_id!==tenant||!date(v.observed_at)||!Array.isArray(v.accounts)||v.accounts.length>20||!nullable(v.next_after,uuid))return false;
 let previous=after;
 for(const a of v.accounts){
  if(!object(a)||!uuid(a.account_id)||(previous!==null&&a.account_id<=previous)||typeof a.email_address!=='string'||!a.email_address||a.email_address.length>320||/[\r\n\x00]/.test(a.email_address)||
   typeof a.account_active!=='boolean'||typeof a.capture_allowed!=='boolean'||a.coverage_complete!==false||a.attachments_captured!==false||
   !countFields.every(k=>count(a[k]))||a.enabled_bindings>a.bindings||a.enabled_bindings>1||a.settled_pages>a.saved_pages||!dates.every(k=>nullable(a[k],date))||
   !nullable(a.issue_code,x=>typeof x==='string'&&Object.hasOwn(microsoftIssueHelp,x))||(a.issue_code===null)!==(a.issue_at===null)||
   !object(a.jobs)||!Object.entries(a.jobs).every(([k,n])=>jobStates.includes(k)&&count(n)))return false;
  previous=a.account_id;
 }
 return v.next_after===null||(v.accounts.length===20&&v.next_after===previous);
}
export async function readMicrosoftStatus(client:MicrosoftStatusClient,tenant:string,after:string|null=null):Promise<MicrosoftStatusPage>{
 if(!uuid(tenant)||!nullable(after,uuid))throw Error('Microsoft status scope is invalid.');
 try{const {data,error}=await client.rpc('learn_operator_microsoft_status',{p_tenant:tenant,p_after:after});if(error||!validMicrosoftStatus(data,tenant,after))throw Error();return data;}
 catch{throw Error('Microsoft status could not be verified. Refresh status or check OpenFolk access and the backend release.');}
}
export function microsoftCaptureState(a:MicrosoftAccountStatus):string{
 if(!a.capture_allowed)return 'Capture paused';
 if(!a.account_active||a.enabled_bindings===0)return 'Mailbox setup or access needs attention';
 if(a.issue_code||a.jobs.dead_letter||a.jobs.failed||a.jobs.unknown)return 'Capture needs attention';
 if(a.jobs.running)return 'Work in progress — coverage unverified';
 if(a.jobs.queued||a.jobs.retrying)return 'Work scheduled — coverage unverified';
 return a.saved_pages?'Saved evidence available — capture freshness unverified':'Awaiting first saved page';
}
