import test from 'node:test';
import assert from 'node:assert/strict';
import { launchReadMode, METADATA_TABLES, TEST_ORIGIN } from './read-mode.ts';
import { readLaunchStatus } from './handler.ts';
const tenant='11111111-1111-4111-8111-111111111111';
function client(failed='') {
 const reads:string[]=[];
 return {reads,db:{from(table:string){
  reads.push(table);
  if(table===failed)throw Error('Synthetic view unavailable');
  const q:any={select:()=>q,eq:()=>q,neq:()=>q,order:()=>q,limit:()=>q,in:()=>q,contains:()=>q,
   then:(resolve:any)=>Promise.resolve({data:[],count:0,error:null}).then(resolve)};
  return q;
 }}};
}
test('TEST metadata mode rejects wrong origin/configuration and retains the default path unchanged',()=>{
 const c=client();
 assert.equal(launchReadMode(c.db,undefined,'https://production.invalid').db,c.db);
 assert.equal(launchReadMode(c.db,'existing',TEST_ORIGIN).ownerAdminOnly,false);
 for(const [mode,origin] of [['test_metadata_views','https://tgbnakbxwcqjeimygroz.supabase.co'],['test_metadata_views',TEST_ORIGIN+'/'],['unknown',TEST_ORIGIN]])
  assert.throws(()=>launchReadMode(c.db,mode,origin));
 assert.equal(c.reads.length,0);
});
test('actual launch handler uses only metadata views and leaves unsupported voicemail unknown',async()=>{
 const c=client(),mode=launchReadMode(c.db,'test_metadata_views',TEST_ORIGIN);
 const r=await readLaunchStatus({tenant_id:tenant},mode.db,async()=>({userId:'synthetic',tenantId:tenant,role:'owner'}),Date.now,mode.ownerAdminOnly);
 assert.equal(r.status,200);
 assert.equal((r.body as any).counts.email.record_count,0);
 assert.equal((r.body as any).voicemails.read_status,'unavailable');
 assert.equal((r.body as any).voicemails.record_count,null);
 assert.ok(c.reads.every(t=>(METADATA_TABLES as readonly string[]).some(name=>t===`learn_launch_${name}`)));
 assert.equal(c.reads.some(t=>t.includes('oauth')||t.includes('secret')||t.includes('voicemail')),false);
});
test('viewer/ops/unknown roles cannot turn unavailable company status into a displayed zero',async()=>{
 for(const role of ['viewer','ops','openfolk','']){
  const c=client(),mode=launchReadMode(c.db,'test_metadata_views',TEST_ORIGIN);
  const r=await readLaunchStatus({tenant_id:tenant},mode.db,async()=>({userId:'synthetic',tenantId:tenant,role}),Date.now,mode.ownerAdminOnly);
  assert.equal(r.status,403);assert.equal(c.reads.length,0);
 }
});
test('a missing metadata view remains unavailable and cannot fall back to raw source access',async()=>{
 const c=client('learn_launch_email_messages'),mode=launchReadMode(c.db,'test_metadata_views',TEST_ORIGIN);
 const r=await readLaunchStatus({tenant_id:tenant},mode.db,async()=>({userId:'synthetic',tenantId:tenant,role:'admin'}),Date.now,mode.ownerAdminOnly);
 assert.equal((r.body as any).counts.email.record_count,null);
 assert.equal((r.body as any).counts.phone.record_count,0);
 assert.equal(c.reads.includes('email_messages'),false);
});
