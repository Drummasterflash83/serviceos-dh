import assert from 'node:assert/strict';
import test from 'node:test';
import { assess, applyExact, NAME, PROJECT, releaseSql, SHA256, source, VERSION } from './new-dawn-report-refresh-release.mjs';
const flags=[];
const base=(installed=false)=>({project:{id:PROJECT,status:'ACTIVE_HEALTHY'},
  ledger:installed?[{version:VERSION,name:NAME,statements:[source().sql]}]:[],
  schema:[{installed,security_definer:installed,authenticated_grant:installed,
    anon_grant:false,service_grant:false,existing_lease:true,existing_finish:true}],
  scope:[{active_tenant:true,confirmed_connections:1,active_refresh_leases:0}],flags});
test('exact migration source and one ledger insert are pinned',()=>{
  assert.equal(source().sql.includes('learn_quickbooks_report_refresh_authorize'),true);
  assert.match(SHA256,/^[0-9a-f]{64}$/);
  const sql=releaseSql();
  assert.equal(sql.match(/insert into supabase_migrations\.schema_migrations/g)?.length,1);
  assert.match(sql,/lock table supabase_migrations\.schema_migrations/);
  assert.match(sql,/refresh_source_already_installed/);
});
test('readback requires unchanged project, flags, grants, and exact ledger source',()=>{
  assert.equal(assess(base(),false).state,'absent');
  assert.equal(assess(base(true),true).state,'installed_default_off');
  assert.throws(()=>assess({...base(true),ledger:[{...base(true).ledger[0],statements:['changed']}]},true));
  assert.throws(()=>assess({...base(),scope:[{...base().scope[0],active_refresh_leases:1}]},false));
  assert.throws(()=>assess({...base(),schema:[{...base().schema[0],anon_grant:true}]},false));
});
test('uncertain write is read back once, never replayed',async()=>{
  let reads=0,writes=0;
  const result=await applyExact({project:PROJECT,token:'synthetic',read:async()=>++reads===1?base():base(true),
    write:async()=>{writes++;throw Error('response lost');}});
  assert.equal(result.ledgerReadbackVerified,true);
  assert.equal(result.writeAcknowledged,false);
  assert.equal(writes,1);assert.equal(reads,2);
});
