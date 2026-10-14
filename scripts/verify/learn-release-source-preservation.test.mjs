import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sourceFingerprintQuery,validateSourcePage,assertSourcesPreserved} from './learn-release-source-preservation.mjs';
const id=n=>`af440001-aaaa-4000-8000-${String(n).padStart(12,'0')}`;
const args={table:'email_messages',tenant:id(1),cutoff:'2026-10-14T07:00:00.123456+00:00',columns:['id','tenant_id','created_at','body_text','raw_payload']};
for(const replacement of [{tenant:"x'"},{cutoff:"2026-10-14';drop table public.email_messages;--"},
 {table:'auth.users'},{cursor:"x'"},{pageSize:2001},{columns:['id','tenant_id']}])
 test('rejects malformed/unbounded source scope '+Object.keys(replacement)[0],()=>assert.throws(()=>sourceFingerprintQuery({...args,...replacement})));
const row=(n,f='a'.repeat(32))=>({id:id(n),fingerprint:f});
const inventory=rows=>[{cutoff:args.cutoff,sources:[{name:'email_messages',count:rows.length,rows}]}];
test('new arrivals do not invalidate preservation of earlier sources',()=>assertSourcesPreserved(inventory([row(2)]),inventory([row(2),row(3)])));
test('a missing earlier source cannot pass',()=>assert.throws(()=>assertSourcesPreserved(inventory([row(2),row(3)]),inventory([row(3)]))));
test('canonical content or pointer drift cannot pass',()=>assert.throws(()=>assertSourcesPreserved(inventory([row(2)]),inventory([row(2,'b'.repeat(32))]))));
test('duplicate or out-of-order pages cannot pass',()=>{
 assert.throws(()=>validateSourcePage([row(2),row(2)]));assert.throws(()=>validateSourcePage([row(3),row(2)]));
 assert.throws(()=>validateSourcePage([row(2)],id(3)));
});
test('different observation cutoffs cannot pass',()=>{
 const b=inventory([row(2)]);b[0].cutoff='2026-10-15T00:00:00Z';assert.throws(()=>assertSourcesPreserved(inventory([row(2)]),b));
});
test('truncated inventories and duplicate dataset names cannot pass',()=>{
 const b=inventory([row(2)]);b[0].sources[0].count=2;assert.throws(()=>assertSourcesPreserved(b,inventory([row(2)])));
 const c=inventory([row(2)]);c[0].sources.push(c[0].sources[0]);assert.throws(()=>assertSourcesPreserved(c,inventory([row(2)])));
});
