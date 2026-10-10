import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditVoicemailEmails,attachmentSignals} from './learn-voicemail-email-audit.mjs';
const tenant='00000000-0000-4000-8000-000000000001',projectRef='abcdefghijklmnopqrst',origin=`https://${projectRef}.supabase.co`,cutoff='2026-10-10T03:00:00.000Z';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=n=>({id:id(n),tenant_id:tenant,direction:n%2?'inbound':'outbound',attachment_hint:n%2===1});
function fixture({length=2,attachmentFailure=false,failure=false,foreign=false,duplicate=false,drift=false,oversize=false,badIdentity=false,missingCount=false,extra=false}={}){
 const calls=[];let matchHeads=0;
 async function fetcher(url,options){
  calls.push({url:String(url),method:options.method});assert.equal(url.origin,origin);assert.equal(options.redirect,'error');assert.ok(['GET','HEAD'].includes(options.method));
  assert.equal(options.headers.apikey,'synthetic-token');
  if(url.pathname.endsWith('/tenants'))return Response.json([{id:badIdentity?id(99):tenant}]);
  assert.equal(url.searchParams.get('tenant_id'),`eq.${tenant}`);assert.equal(url.searchParams.get('created_at'),`lte.${cutoff}`);
  const email=url.pathname.endsWith('/email_messages'),matching=url.searchParams.has('or');
  if(failure&&email&&matching)return new Response('provider secret error',{status:500});
  if(attachmentFailure&&!email)return new Response('private error',{status:403});
  if(email){assert.ok(!/subject,|body|from_email|snippet/.test(url.searchParams.get('select')));if(matching)assert.equal(url.searchParams.get('or'),'(subject.ilike.*voicemail*,subject.ilike.*voice mail*,subject.ilike.*voice-mail*)');}
  else assert.ok(url.searchParams.get('message_id').startsWith('in.('));
  let rows=email?Array.from({length},(_,i)=>row(i+1)):[{id:id(999),tenant_id:tenant,message_id:id(1),mime_type:'audio/wav',filename:'PRIVATE caller.wav',size_bytes:123,storage_path:'PRIVATE/object',body:'DO NOT OUTPUT'}].filter(r=>url.searchParams.get('message_id').includes(r.message_id));
  const total=email&&!matching?18456:rows.length;
  if(options.method==='HEAD'){
   if(email&&matching)matchHeads++;
   return new Response(null,{headers:missingCount?{}:{'content-range':`*/${total+(drift&&email&&matching&&matchHeads>1?1:0)}`}});
  }
  if(oversize&&email)return new Response(' '.repeat(2*1024*1024+1));
  const cursor=url.searchParams.get('id')?.slice(3);if(cursor)rows=rows.filter(r=>r.id>cursor);
  rows=rows.slice(0,Number(url.searchParams.get('limit')));
  if(foreign&&email&&rows.length)rows[0].tenant_id=id(55);
  if(duplicate&&email&&rows.length>1)rows[1]=rows[0];
  if(extra&&email&&rows.length)rows[0].subject='SECRET SUBJECT';
  return Response.json(rows);
 }
 return {fetcher,calls};
}
async function run(options){const f=fixture(options);return {...await auditVoicemailEmails({origin,projectRef,tenant,token:'synthetic-token',cutoff,fetcher:f.fetcher}),calls:f.calls};}
test('scoped read-only audit distinguishes hints, metadata and pointers without retaining source content',async()=>{
 const {report,privateReferences,calls}=await run({extra:true});
 assert.equal(report.status,'complete_for_subject_query');assert.equal(report.storedEmailsAtCutoff,18456);assert.equal(report.observedSubjectMatches,2);
 assert.deepEqual(report.directions,{inbound:1,outbound:1,unknown:0});assert.equal(report.withAttachmentHint,1);assert.equal(report.withAudioMetadata,1);assert.equal(report.withAudioPointer,1);
 const json=JSON.stringify(report);for(const privateText of ['PRIVATE','SECRET SUBJECT','DO NOT OUTPUT',id(1),'synthetic-token'])assert.ok(!json.includes(privateText));
 assert.equal(privateReferences[0].messageId,id(1));assert.equal(privateReferences[0].messageFingerprint,report.candidates[0].messageFingerprint);
 assert.ok(calls.every(c=>new URL(c.url).pathname.startsWith('/rest/v1/')));
});
test('keyset pagination exhausts >one page and batches attachment scope',async()=>{
 const {report,calls}=await run({length:251});assert.equal(report.status,'complete_for_subject_query');assert.equal(report.observedSubjectMatches,251);
 assert.ok(calls.some(c=>new URL(c.url).searchParams.has('id')&&new URL(c.url).pathname.endsWith('email_messages')));
 for(const c of calls.filter(c=>c.url.includes('email_attachments')))assert.ok(new URL(c.url).searchParams.get('message_id').slice(4,-1).split(',').length<=50);
});
test('zero matches are complete only for the explicit subject query',async()=>{
 const {report,calls}=await run({length:0});assert.equal(report.status,'complete_for_subject_query');assert.equal(report.observedSubjectMatches,0);assert.equal(report.withAudioMetadata,0);
 assert.ok(!calls.some(c=>c.url.includes('email_attachments')));assert.ok(report.limitations.some(l=>l.includes('other subjects')));
});
test('unavailable, foreign, duplicate, oversized, drifting or uncounted results cannot claim coverage',async()=>{
 for(const options of [{failure:true},{foreign:true},{duplicate:true},{oversize:true},{drift:true},{missingCount:true}]){
  const {report}=await run(options);assert.equal(report.status,'unverified',JSON.stringify(options));assert.equal(report.subjectQueryComplete,false);
  assert.ok(!JSON.stringify(report).includes('secret error'));
  if(options.failure)assert.deepEqual(report.readFailures,[{table:'email_messages',method:'HEAD',kind:'http',status:500}]);
  if(options.oversize)assert.equal(report.readFailures[0].kind,'transport_or_response');
 }
 const {report}=await run({attachmentFailure:true});assert.equal(report.status,'unverified');assert.equal(report.subjectQueryComplete,true);assert.equal(report.candidates[0].attachmentMetadataComplete,false);
});
test('invalid identity/scope aborts before source access',async()=>{
 const f=fixture({badIdentity:true});await assert.rejects(auditVoicemailEmails({origin,projectRef,tenant,token:'synthetic-token',cutoff,fetcher:f.fetcher}),/Tenant identity/);assert.equal(f.calls.length,1);
 await assert.rejects(auditVoicemailEmails({origin:'https://example.com',projectRef,tenant,token:'x',fetcher:()=>assert.fail()}),/scope/);
});
test('attachment indicators do not imply authentic or playable voicemail',()=>{
 assert.deepEqual(attachmentSignals({mime_type:'application/octet-stream',filename:'sample.WAV',storage_path:null,size_bytes:0}),{audioMime:false,audioFilename:true,storedPointer:false,positiveBytes:false});
 assert.equal(attachmentSignals({filename:'file.wav.exe'}).audioFilename,false);
});
test('finite global budget reports partial observations as unverified',async()=>{
 const {report,calls}=await run({length:10000});assert.equal(report.status,'unverified');assert.equal(report.requests,200);assert.equal(calls.length,200);assert.ok(report.candidates.some(c=>!c.attachmentMetadataComplete));
});
