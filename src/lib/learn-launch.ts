import {validateLearnStatus,learnStatusState} from './learn-status-contract.ts';
export function launchSnapshot(raw:any,tenant:string,now:number){
 if(!raw||raw.version!=='learn-launch/1'||raw.tenant_id!==tenant||!Number.isFinite(now))return null;
 const counts=validateLearnStatus(raw.counts,tenant);if(!counts||learnStatusState(counts,now)==='stale'||raw.observed_at!==counts.observed_at||raw.valid_until!==counts.valid_until)return null;
 const n=(v:unknown)=>v===null||typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
 const at=(v:unknown)=>v===null||typeof v==='string'&&Number.isFinite(Date.parse(v))&&Date.parse(v)<=now;
 if(!raw.recordings||!n(raw.recordings.record_count)||!['ok','unavailable'].includes(raw.recordings.read_status)||!raw.email||!['accounts','disabled_accounts','mailboxes','selected_mailboxes','removed_mailboxes'].every(k=>n(raw.email[k]))||!at(raw.email.last_successful_message_sync_at)||!raw.phone||!at(raw.phone.last_successful_call_sync_at)||!raw.slack||![true,false,null].includes(raw.slack.notifications_enabled)||raw.slack.message_ingestion!=='unavailable')return null;
 if(raw.recordings.read_status==='unavailable'&&raw.recordings.record_count!==null)return null;
 const recordingCheck=validateLearnStatus({...counts,phone:raw.recordings},tenant);
 const voicemailCheck=validateLearnStatus({...counts,phone:raw.voicemails},tenant);
 if(!recordingCheck||!voicemailCheck||raw.phone.direction_scope!=='raw_provider'||raw.phone.family_audio_coverage!=='unverified'||raw.phone.recent_calls!==null&&(!Array.isArray(raw.phone.recent_calls)||raw.phone.recent_calls.length>10||raw.phone.recent_calls.some((c:any)=>!c||typeof c.id!=='string'||!['IN','OUT',null].includes(c.raw_direction)||!at(c.started_at))))return null;
 const labels=raw.email.stored_label_counts;
 if(labels!==undefined&&(!labels||!['inbox','sent','draft'].every(k=>n(labels[k]))||raw.email.label_scope!=='stored_current_metadata'||raw.email.draft_lifecycle!=='unverified'))return null;
 return {version:raw.version,tenant_id:tenant,observed_at:counts.observed_at,valid_until:counts.valid_until,counts,recordings:recordingCheck.phone,voicemails:voicemailCheck.phone,
  email:{stored_label_counts:labels?{inbox:labels.inbox,sent:labels.sent,draft:labels.draft}:null,accounts:raw.email.accounts,disabled_accounts:raw.email.disabled_accounts,mailboxes:raw.email.mailboxes,selected_mailboxes:raw.email.selected_mailboxes,removed_mailboxes:raw.email.removed_mailboxes,last_successful_message_sync_at:raw.email.last_successful_message_sync_at},
  phone:{last_successful_call_sync_at:raw.phone.last_successful_call_sync_at,recent_calls:raw.phone.recent_calls?.map((c:any)=>({id:c.id,raw_direction:c.raw_direction,started_at:c.started_at,linked_id:c.linked_id,recording_ids:Array.isArray(c.recording_ids)&&c.recording_ids.every((id:any)=>typeof id==='string')?[...new Set(c.recording_ids)]:null}))??null},slack:{notifications_enabled:raw.slack.notifications_enabled,message_ingestion:'unavailable'}};
}
/** The existing Gmail flow binds tenant from the JWT, so never use it for a
 * differently selected operator tenant. Consent URL validation is not authority. */
export function gmailConsentUrl(value:unknown){try{const u=new URL(String(value));return u.protocol==='https:'&&u.hostname==='accounts.google.com'&&u.pathname==='/o/oauth2/v2/auth'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
