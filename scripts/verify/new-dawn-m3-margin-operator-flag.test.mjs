import assert from 'node:assert/strict';
import test from 'node:test';
import { PROJECT,TENANT,FLAG,assessEnableScope,assessFlagScope,flagSql,switchLive }
  from './new-dawn-m3-margin-operator-flag.mjs';

function snapshot(on=false){
  return {project:{id:PROJECT,status:'ACTIVE_HEALTHY'},
    flags:[{target_rows:Number(on),target_global:Number(on),target_tenant:Number(on),
      other_rows:0,client_money_on:0,accounts_global:1,accounts_tenant:1,
      report_global:1,report_tenant:1}],
    source:[{exact_ledger:true,
      function_sha256:'8fea235331db857fb38c7cb21f99f7829050daab1fcdfbd7d43d5972463b6385',
      authenticated_grant:true,anon_grant:false,service_grant:false,
      tenant_active:true,production_connections:1,saved_pair_available:true}]};
}

test('enable checks exact function, saved pair and operator-only prior flags',()=>{
  assert.equal(assessEnableScope(snapshot(),false).sourcePairVerified,true);
  assert.equal(assessEnableScope(snapshot(true),true).clientMoneyFlagsEnabled,false);
  const sql=flagSql(true);
  assert.match(sql,/^begin;/);
  assert.match(sql,/lock table public\.feature_flags/);
  assert.match(sql,/new_dawn\.job_home_accounts_preview/);
  assert.match(sql,/new_dawn\.report_summary_preview/);
  assert.match(sql,/learn_quickbooks_report_requests/);
  assert.match(sql,/learn_quickbooks_report_receipts/);
  assert.match(sql,/platform\.controlplane\.admin/);
  assert.match(sql,/new_dawn\.owner_accounts_report/);
  assert.match(sql,/m3-margin-enabled\/1/);
  assert.match(sql,/\ncommit;$/);
  assert.ok(sql.includes(TENANT));assert.ok(sql.includes(FLAG));
  assert.doesNotMatch(sql,/update public\.learn_quickbooks_report|GET \/|POST \//);
});

test('enable refuses changed grants, source pair, client money and other tenants',()=>{
  for(const change of [
    s=>{s.project.id='wrong';},
    s=>{s.source[0].exact_ledger=false;},
    s=>{s.source[0].function_sha256='0'.repeat(64);},
    s=>{s.source[0].authenticated_grant=false;},
    s=>{s.source[0].anon_grant=true;},
    s=>{s.source[0].saved_pair_available=false;},
    s=>{s.flags[0].client_money_on=1;},
    s=>{s.flags[0].accounts_tenant=0;},
    s=>{s.flags[0].report_global=2;},
    s=>{s.flags[0].other_rows=1;},
  ]){const s=snapshot();change(s);assert.throws(()=>assessEnableScope(s,false));}
});

test('OFF rollback depends only on exact target flag scope',()=>{
  const broken=snapshot(true);
  broken.source[0].saved_pair_available=false;
  broken.source[0].authenticated_grant=false;
  assert.equal(assessFlagScope(broken,true).operatorFlagEnabled,true);
  const sql=flagSql(false);
  assert.match(sql,/m3-margin-disabled\/1/);
  assert.doesNotMatch(sql,/learn_quickbooks_report_requests|report_summary_preview/);
  assert.match(sql,/\ncommit;$/);
  assert.throws(()=>assessFlagScope({...broken,flags:[{...broken.flags[0],other_rows:1}]},true));
});

test('uncertain write is read back once and never replayed',async()=>{
  let reads=0,writes=0;
  const enabled=await switchLive(true,{token:'synthetic',
    readEnable:async()=>++reads===1?snapshot(false):snapshot(true),
    write:async()=>{writes++;throw Error('connection lost');}});
  assert.equal(enabled.operatorFlagEnabled,true);
  assert.equal(enabled.writeAcknowledged,false);
  assert.equal(reads,2);assert.equal(writes,1);
  reads=0;writes=0;
  await assert.rejects(switchLive(true,{token:'synthetic',
    readEnable:async()=>{reads++;return snapshot(false);},
    write:async()=>{writes++;throw Error('uncertain');}}),/outcome_unverified_no_replay/);
  assert.equal(reads,2);assert.equal(writes,1);
  const withdrawn=await switchLive(false,{token:'synthetic',
    readFlag:async()=>snapshot(true),write:async()=>[{marker:'m3-margin-disabled/1'}]
      // The second read must show OFF; test that independently below.
  }).catch(error=>error);
  assert.match(withdrawn.message,/outcome_unverified_no_replay/);
  reads=0;
  const verified=await switchLive(false,{token:'synthetic',
    readFlag:async()=>++reads===1?snapshot(true):snapshot(false),
    write:async()=>[{marker:'m3-margin-disabled/1'}]});
  assert.equal(verified.operatorFlagEnabled,false);
  assert.equal(reads,2);
});
