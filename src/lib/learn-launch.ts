import {validateLearnStatus,learnStatusState} from './learn-status-contract.ts';
export type LaunchProcessingAttempt={state:'idle'|'processing'|'success'|'failed'|'unknown';started_at:string|null;completed_at:string|null;records_processed:number|null;error_present:boolean|null};
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function processingAttempt(value:unknown,now:number):LaunchProcessingAttempt|null{
 if(!object(value)||Object.keys(value).length!==5||!['state','started_at','completed_at','records_processed','error_present'].every(k=>Object.hasOwn(value,k)))return null;
 const empty=value.started_at===null&&value.completed_at===null&&value.records_processed===null&&value.error_present===null;
 if(value.state==='idle'||value.state==='unknown')return empty?{state:value.state,started_at:null,completed_at:null,records_processed:null,error_present:null}:null;
 const started=typeof value.started_at==='string'?Date.parse(value.started_at):NaN,completed=typeof value.completed_at==='string'?Date.parse(value.completed_at):NaN;
 if(!Number.isFinite(started)||started>now||!Number.isSafeInteger(value.records_processed)||value.records_processed<0||typeof value.error_present!=='boolean')return null;
 if(value.state==='processing')return value.completed_at===null?{state:'processing',started_at:value.started_at,completed_at:null,records_processed:value.records_processed,error_present:value.error_present}:null;
 if(!['success','failed'].includes(value.state)||!Number.isFinite(completed)||completed<started||completed>now)return null;
 return {state:value.state,started_at:value.started_at,completed_at:value.completed_at,records_processed:value.records_processed,error_present:value.error_present} as LaunchProcessingAttempt;
}
export function launchSnapshot(raw:any,tenant:string,now:number){
 if(!raw||raw.version!=='learn-launch/1'||raw.tenant_id!==tenant||!Number.isFinite(now))return null;
 const counts=validateLearnStatus(raw.counts,tenant);if(!counts||raw.observed_at!==counts.observed_at||raw.valid_until!==counts.valid_until)return null;
 // Independent server/browser clocks can differ slightly. Accept at most five
 // seconds ahead; never extend the server's original validity deadline.
 const observed=Date.parse(counts.observed_at);if(observed>now+5000)return null;
 now=Math.max(now,observed);if(learnStatusState(counts,now)==='stale')return null;
 const n=(v:unknown)=>v===null||typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
 const at=(v:unknown)=>v===null||typeof v==='string'&&Number.isFinite(Date.parse(v))&&Date.parse(v)<=now;
 const emailAttempt=processingAttempt(raw.email?.latest_message_sync_attempt,now),phoneAttempt=processingAttempt(raw.phone?.latest_call_sync_attempt,now);
 if(!raw.recordings||!n(raw.recordings.record_count)||!['ok','unavailable'].includes(raw.recordings.read_status)||!raw.email||!['accounts','disabled_accounts','mailboxes','selected_mailboxes','removed_mailboxes'].every(k=>n(raw.email[k]))||!emailAttempt||!at(raw.email.last_successful_message_sync_at)||!raw.phone||!phoneAttempt||!at(raw.phone.last_successful_call_sync_at)||!raw.slack||![true,false,null].includes(raw.slack.notifications_enabled)||raw.slack.message_ingestion!=='unavailable')return null;
 if(raw.recordings.read_status==='unavailable'&&raw.recordings.record_count!==null)return null;
 const recordingCheck=validateLearnStatus({...counts,phone:raw.recordings},tenant);
 const voicemailCheck=validateLearnStatus({...counts,phone:raw.voicemails},tenant);
 if(!recordingCheck||!voicemailCheck||raw.phone.direction_scope!=='raw_provider'||raw.phone.family_audio_coverage!=='unverified'||raw.phone.recent_calls!==null&&(!Array.isArray(raw.phone.recent_calls)||raw.phone.recent_calls.length>10||raw.phone.recent_calls.some((c:any)=>!c||typeof c.id!=='string'||!['IN','OUT',null].includes(c.raw_direction)||!at(c.started_at))))return null;
 const transcripts=raw.phone.transcript_status_counts;
 if(transcripts!==undefined&&(!object(transcripts)||Object.keys(transcripts).length!==4||!['completed','failed','pending','processing'].every(k=>n(transcripts[k]))||raw.phone.transcript_scope!=='stored_status_rows'))return null;
 const labels=raw.email.stored_label_counts;
 if(labels!==undefined&&(!labels||!['inbox','sent','draft'].every(k=>n(labels[k]))||raw.email.label_scope!=='stored_current_metadata'||raw.email.draft_lifecycle!=='unverified'))return null;
 return {version:raw.version,tenant_id:tenant,observed_at:counts.observed_at,valid_until:counts.valid_until,counts,recordings:recordingCheck.phone,voicemails:voicemailCheck.phone,
  email:{stored_label_counts:labels?{inbox:labels.inbox,sent:labels.sent,draft:labels.draft}:null,accounts:raw.email.accounts,disabled_accounts:raw.email.disabled_accounts,mailboxes:raw.email.mailboxes,selected_mailboxes:raw.email.selected_mailboxes,removed_mailboxes:raw.email.removed_mailboxes,latest_message_sync_attempt:emailAttempt,last_successful_message_sync_at:raw.email.last_successful_message_sync_at},
  phone:{transcript_status_counts:transcripts?{completed:transcripts.completed,failed:transcripts.failed,pending:transcripts.pending,processing:transcripts.processing}:null,latest_call_sync_attempt:phoneAttempt,last_successful_call_sync_at:raw.phone.last_successful_call_sync_at,recent_calls:raw.phone.recent_calls?.map((c:any)=>({id:c.id,raw_direction:c.raw_direction,started_at:c.started_at,linked_id:c.linked_id,recording_ids:Array.isArray(c.recording_ids)&&c.recording_ids.every((id:any)=>typeof id==='string')?[...new Set(c.recording_ids)]:null}))??null},slack:{notifications_enabled:raw.slack.notifications_enabled,message_ingestion:'unavailable'}};
}
export function isCurrentLaunchRequest(ticket:number,selectedScope:string,currentTicket:number,currentScope:string){return ticket===currentTicket&&selectedScope===currentScope;}
/** The existing Gmail flow binds tenant from the JWT, so never use it for a
 * differently selected operator tenant. Consent URL validation is not authority. */
export function gmailConsentUrl(value:unknown){try{const u=new URL(String(value));return u.protocol==='https:'&&u.hostname==='accounts.google.com'&&u.pathname==='/o/oauth2/v2/auth'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
