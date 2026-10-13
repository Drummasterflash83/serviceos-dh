/** Release guard only: metadata/digests, never customer content or credentials. */
const check=(value,message)=>{if(!value)throw Error(message)};
export function assertReplayVoicemailControls(before,after){
 for(const key of ['voicemailRoutesHash','voicemailPermissionsHash','voicemailOwnersHash','accessHash','connectionHash'])check(typeof before[key]==='string'&&before[key]===after[key],`Preserved control changed: ${key}`);
 check(JSON.stringify(before.schedules)===JSON.stringify(after.schedules),'Preserved cron state changed');
 check(Number.isSafeInteger(before.activeVoicemailRoutes)&&before.activeVoicemailRoutes===after.activeVoicemailRoutes,'Enabled voicemail routes changed');
}
export function assertReplayVoicemailIdle(snapshot){check(snapshot.runningVoicemailJobs===0,'A voicemail import is running; wait for it to finish before replacing the runtime');}
export function assertRetainedDigestSubset(before,after,label){
 check(Array.isArray(before)&&Array.isArray(after),`Missing ${label} inventory`);
 const read=rows=>{const map=new Map();for(const row of rows){check(row&&typeof row.id==='string'&&/^[a-f0-9-]{36}$/.test(row.id)&&typeof row.sha256==='string'&&/^[a-f0-9]{64}$/.test(row.sha256)&&!map.has(row.id),`Invalid ${label} inventory`);map.set(row.id,row.sha256);}return map;};
 const old=read(before),current=read(after);for(const[id,digest]of old)check(current.get(id)===digest,`Retained ${label} removed or changed`);
 return {before:old.size,after:current.size,appended:current.size-old.size};
}
export function assertReplayVoicemailPreserved(before,after){
 assertReplayVoicemailControls(before,after);
 return {messages:assertRetainedDigestSubset(before.voicemailMessageDigests,after.voicemailMessageDigests,'voicemail message'),sources:assertRetainedDigestSubset(before.voicemailSourceDigests,after.voicemailSourceDigests,'voicemail source')};
}
