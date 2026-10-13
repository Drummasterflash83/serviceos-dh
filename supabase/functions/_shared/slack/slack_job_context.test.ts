import test from 'node:test';import assert from 'node:assert/strict';
import {explicitSlackJobReferences as refs,proposeSlackJobContext as propose,type SlackJobContextInput}from './slack_job_context.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(text='Parts are missing for job 12345'):SlackJobContextInput{return{
 tenantId:id(1),connection:{id:id(2),provider:'commusoft',sourceSystem:`commusoft:connection:${id(2)}`,active:true},
 source:{id:id(3),tenantId:id(1),teamId:'TDH',channelId:'CENGINEERS',sourceVersion:'a'.repeat(64),text,kind:'conversation',visibility:'public',status:'active'},
 interaction:{id:id(4),tenantId:id(1),sourceId:id(3),sourceVersion:'a'.repeat(64),direction:'unknown',relatedJobId:null},
 jobs:[{tenantId:id(1),connectionId:id(2),provider:'commusoft',sourceSystem:`commusoft:connection:${id(2)}`,jobId:id(5),jobNumber:'12345',externalId:'12345',linkedExternalId:'12345',collection:'jobs',entityKind:'job',linkedEntityId:id(5),sourceVersionId:id(6),canonicalSourceVersionId:id(6),latestSourceVersionId:id(6)}]};}
test('strict explicit references preserve source span; repeated same number is one review candidate',()=>{
 const text='JOB: 12345 and job number #12345; Commusoft 54321';const r=refs(text);
 assert.deepEqual(r.map(x=>x.number),['12345','12345','54321']);assert.equal(text.slice(r[0].start,r[0].end),'JOB: 12345');
 const p=propose(fixture('Job12345 and #12345'));assert.equal(p.state,'candidate_review_required');
});
test('phone, prices, years, bare numbers, embedded prefixes and partial numbers never become candidates',()=>{
 for(const text of ['12345','2026','£12345','job £12345','job 12345.67','job 12345,67','job 07700900123','job 07700 900123','job 123456789','xjob12345','somecommusoft12345','éjob12345','job12345a','job12345_foo','job 12345-6789'])assert.deepEqual(refs(text),[],text);
});
test('URLs require a separate reviewed grammar and are not guessed',()=>{
 for(const text of ['https://evil.example/job12345','<https://app.commusoft.co.uk/jobs#12345|job>','www.example.test/#12345'])assert.deepEqual(refs(text),[],text);
});
test('unique current canonical proof creates review proposal without changing unknown direction or pretending reviewed',()=>{
 const f=fixture(),before=structuredClone(f),p=propose(f);assert.equal(p.state,'candidate_review_required');
 if(p.state!=='candidate_review_required')throw Error('expected candidate');
 assert.equal(p.direction,'unknown');assert.equal(p.attribution,'unchanged');assert.equal(p.jobId,id(5));assert.equal(p.evidence.jobSourceVersionId,id(6));
 assert.ok(!('reviewed_by'in p));assert.ok(!('work_context'in p));assert.deepEqual(f,before);
});
test('multiple explicit references remain held even if only one has a canonical match',()=>{
 assert.equal(propose(fixture('Job12345 and job99999')).state,'held');
 assert.deepEqual(propose(fixture('Job12345 and job99999')),{version:'slack-job-context-candidate/1',state:'held',reason:'multiple_references'});
});
test('no canonical record and ambiguous records never link',()=>{
 let f=fixture();f.jobs=[];assert.equal((propose(f)as any).reason,'job_not_published');
 f=fixture();f.jobs.push({...f.jobs[0],jobId:id(7),linkedEntityId:id(7)});assert.equal((propose(f)as any).reason,'ambiguous_job');
});
test('foreign tenant/provider connection and unexpected lookup results fail closed',()=>{
 for(const mutation of [(f:SlackJobContextInput)=>f.jobs[0].tenantId=id(9),(f:SlackJobContextInput)=>f.jobs[0].connectionId=id(9),(f:SlackJobContextInput)=>f.jobs[0].jobNumber='99999',(f:SlackJobContextInput)=>f.jobs[0].sourceSystem='commusoft']){const f=fixture();mutation(f);assert.equal((propose(f)as any).reason,'lookup_scope_mismatch');}
});
test('stale source, revoked connection and stale canonical provider proof are held',()=>{
 let f=fixture();f.interaction.sourceVersion='b'.repeat(64);assert.equal((propose(f)as any).reason,'source_changed');
 f=fixture();f.connection.active=false;assert.equal((propose(f)as any).reason,'connection_unavailable');
 for(const key of ['latestSourceVersionId','canonicalSourceVersionId','linkedEntityId','linkedExternalId']as const){f=fixture();f.jobs[0][key]=id(8);assert.equal((propose(f)as any).reason,'job_provenance_changed');}
});
test('existing manual or stale work context is preserved, not replaced',()=>{
 let f=fixture();f.interaction.relatedJobId=id(8);assert.equal((propose(f)as any).reason,'existing_context');
 f=fixture();f.interaction.workContext={state:'source_changed'};assert.equal((propose(f)as any).reason,'existing_context');
});
test('channel activity, other-tenant source and oversized text cannot produce proposals',()=>{
 let f=fixture();f.source.kind='channel_activity';assert.equal((propose(f)as any).reason,'invalid_source');
 f=fixture();f.source.tenantId=id(8);assert.equal((propose(f)as any).reason,'invalid_source');
 f=fixture();f.source.text='job 12345'+' '.repeat(100_000);assert.equal((propose(f)as any).reason,'invalid_source');
});

test('sentence punctuation is allowed but decimal/long numeric tokens remain excluded',()=>{assert.deepEqual(refs('See job 12345.').map(r=>r.number),['12345']);assert.deepEqual(refs('See job 12345, please.').map(r=>r.number),['12345']);assert.deepEqual(refs('See job 12345.67'),[]);});
test('deleted sources and private channels/DMs stay outside this public-history proposal',()=>{for(const visibility of ['private','direct_message']as const){const f=fixture();f.source.visibility=visibility;assert.equal((propose(f)as any).reason,'invalid_source');}const f=fixture();f.source.status='deleted';assert.equal((propose(f)as any).reason,'invalid_source');});

test('JN references are explicit and multi-job stock summaries remain held',()=>{
 const text='Weekly StockBot summary: Job 12345 awaiting parts; JN12952 stock follow-up; JN 13356 next visit.';
 assert.deepEqual(refs(text).map(r=>r.number),['12345','12952','13356']);
 assert.equal(refs('JN12952')[0].form,'jn');assert.deepEqual(refs('xJN12952'),[]);
 assert.equal((propose(fixture(text))as any).reason,'multiple_references');
});
