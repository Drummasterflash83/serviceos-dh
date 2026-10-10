import test from 'node:test';import assert from 'node:assert/strict';
import {harness,profileId,csv} from './learn-import-handler-harness.mjs';
const url='https://test.invalid/learn-data-import';
const headers={authorization:'Bearer session','content-type':'application/json'};
test('LEARN facade bounds declared and streamed bytes before running the import engine',async()=>{
 for(const declared of ['16777217','invalid']){
  const h=harness(),f=h.load('learn-data-import/index.ts');const r=await f.handleLearnDataImport(new Request(url,{method:'POST',headers:{...headers,'content-length':declared},body:'{}'}));assert.equal(r.status,413);assert.equal(h.calls.length,0);assert.deepEqual(h.writes,[]);
 }
 let cancelled=false,part=0;const h=harness(),f=h.load('learn-data-import/index.ts');
 const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(++part<=2?8*1024*1024:1));},cancel(){cancelled=true;}});
 const r=await f.handleLearnDataImport(new Request(url,{method:'POST',headers:{...headers,'content-length':'1'},body,duplex:'half'}));assert.equal(r.status,413);assert.equal(cancelled,true);assert.equal(h.calls.length,0);assert.deepEqual(h.writes,[]);
});
test('facade forwards bounded user preview and keeps CORS, invalid JSON and wrong methods explicit',async()=>{
 const h=harness(),f=h.load('learn-data-import/index.ts');
 const valid=await f.handleLearnDataImport(new Request(url,{method:'POST',headers,body:JSON.stringify({action:'preview',entity_type:'customers',source_system:'commusoft',profile_id:profileId,csv_text:csv})}));assert.equal(valid.status,200);assert.equal((await valid.json()).success,true);
 const invalid=await f.handleLearnDataImport(new Request(url,{method:'POST',headers,body:'not JSON'}));assert.equal(invalid.status,400);assert.equal(invalid.headers.get('access-control-allow-origin'),'*');
 assert.equal((await f.handleLearnDataImport(new Request(url,{method:'GET'}))).status,405);
 assert.equal((await f.handleLearnDataImport(new Request(url,{method:'OPTIONS'}))).status,200);
});
test('runtime faults return a recoverable error without leaking a CSV or database exception',async()=>{
 const h=harness(),f=h.load('learn-data-import/index.ts');
 const broken=new ReadableStream({pull(){throw Error('SYNTHETIC PRIVATE INPUT');}});
 const r=await f.handleLearnDataImport(new Request(url,{method:'POST',headers,body:broken,duplex:'half'}));assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/SYNTHETIC PRIVATE INPUT/);assert.deepEqual(h.writes,[]);
});
