import assert from "node:assert/strict";
import test from "node:test";
import { PROJECT,TENANT,VERSION,NAME,reviewedSource } from "./new-dawn-m3-report-pairs-release.mjs";
import { FLAG,assessEnableScope,assessFlagScope,flagSql,readFlagScope,switchLive }
  from "./new-dawn-m3-aged-receivables-flag.mjs";

function snapshot(enabled=false,existingRow=enabled){
  return {project:{id:PROJECT,status:"ACTIVE_HEALTHY"},
    accounts:{project:{id:PROJECT,status:"ACTIVE_HEALTHY"},
      ledger:[{version:VERSION,name:NAME,statement_count:1,source_sha256:reviewedSource().hash}],
      catalog:[{installed:true,security_definer:true,authenticated_grant:true,
        anon_grant:false,service_grant:false,summary_rpc:true,active_tenant:true,
        confirmed_connections:1}],
      selector:[{selector_sha256:"8ecba7c16d0d4fa25399e81f9c33440197ae807c6d189489b0f8b130146b479d"}],
      pairs:[{operator_pair_available:true}],
      flags:[{operator_global:1,operator_tenant:1,other_tenant_rows:0,client_money_on:0,
        report_global:1,report_tenant:1,job_global:1,job_tenant:1}]},
    flags:[{target_rows:Number(existingRow),target_global:Number(enabled),target_tenant:Number(enabled),
      other_rows:0,client_money_on:0,accounts_global:1,accounts_tenant:1,
      report_global:1,report_tenant:1,job_global:1,job_tenant:1}]};
}

test("enable preflight requires exact operator source and keeps client money OFF",()=>{
  assert.equal(assessEnableScope(snapshot(),false).operatorFlagEnabled,false);
  assert.equal(assessEnableScope(snapshot(true),true).clientMoneyFlagsEnabled,false);
  for(const change of [
    s=>{s.project.id="wrong";},
    s=>{s.accounts.pairs[0].operator_pair_available=false;},
    s=>{s.accounts.selector[0].selector_sha256="0".repeat(64);},
    s=>{s.flags[0].client_money_on=1;},
    s=>{s.flags[0].accounts_tenant=0;},
    s=>{s.flags[0].other_rows=1;},
    s=>{s.flags[0].target_rows=2;},
  ]){const s=snapshot();change(s);assert.throws(()=>assessEnableScope(s,false));}
});

test("transaction changes only the exact Drummonds flag with fail-closed guards",()=>{
  assert.equal(FLAG,"new_dawn.aged_debt_exception_preview");
  const sql=flagSql(true);
  assert.match(sql,/^begin;/);
  assert.match(sql,/lock table public\.feature_flags/);
  assert.match(sql,/20261108100000/);
  assert.match(sql,/new_dawn\.job_home_accounts_preview/);
  assert.match(sql,/new_dawn\.report_summary_preview/);
  assert.match(sql,/new_dawn\.source_job_home\.operator_preview/);
  assert.match(sql,/new_dawn\.owner_money/);
  assert.match(sql,/m3_aged_flag_preflight_changed/);
  assert.match(sql,/m3-aged-review-enabled\/1/);
  assert.equal(sql.match(/insert into public\.feature_flags\(tenant_id,flag,value\)/g)?.length,1);
  assert.ok(sql.includes(TENANT));
  assert.match(sql,/\ncommit;$/);
  assert.doesNotMatch(sql,/update public\.learn_quickbooks|GET \/|POST \/|insert into public\.learn_quickbooks/);
});

test("rollback accepts an existing false row and does not depend on report source",()=>{
  const broken=snapshot(true);broken.accounts.pairs[0].operator_pair_available=false;
  assert.equal(assessFlagScope(broken,true,{withdrawal:true}).operatorFlagEnabled,true);
  assert.equal(assessFlagScope(snapshot(false,true),false,{withdrawal:true}).operatorFlagEnabled,false);
  const sql=flagSql(false);
  assert.match(sql,/m3_aged_flag_withdraw_preflight_changed/);
  assert.match(sql,/m3-aged-review-disabled\/1/);
  assert.doesNotMatch(sql,/report_pair_candidates|report_summary_preview/);
  assert.match(sql,/\ncommit;$/);
});

test("read-only flag scope uses project metadata and Supabase read-only SQL only",async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    return {ok:true,arrayBuffer:async()=>Buffer.from(JSON.stringify(
      url.endsWith("/read-only")?snapshot().flags:url.endsWith(PROJECT)?snapshot().project:null))};
  };
  const result=await readFlagScope("synthetic",fetcher);
  assert.equal(result.flags[0].target_global,0);
  assert.equal(calls.length,2);
  assert.ok(calls.every(call=>!call.url.includes("quickbooks")&&!call.url.includes("commusoft")));
  assert.equal(calls.filter(call=>call.options.method==="POST").length,1);
  assert.match(calls.find(call=>call.options.method==="POST").url,/database\/query\/read-only$/);
});

test("one uncertain write gets one independent readback and is never replayed",async()=>{
  let reads=0,writes=0;
  const result=await switchLive(true,{token:"synthetic",
    readEnable:async()=>++reads===1?snapshot():snapshot(true),
    write:async()=>{writes++;throw Error("connection lost after commit");}});
  assert.equal(result.operatorFlagEnabled,true);
  assert.equal(result.writeAcknowledged,false);
  assert.equal(reads,2);assert.equal(writes,1);
  reads=0;writes=0;
  await assert.rejects(switchLive(true,{token:"synthetic",
    readEnable:async()=>{reads++;return snapshot();},
    write:async()=>{writes++;throw Error("uncertain");}}),/outcome_unverified_no_replay/);
  assert.equal(reads,2);assert.equal(writes,1);
  reads=0;writes=0;
  const withdrawn=await switchLive(false,{token:"synthetic",
    readFlag:async()=>++reads===1?snapshot(true):snapshot(false,true),
    write:async()=>{writes++;return [{marker:"m3-aged-review-disabled/1"}];}});
  assert.equal(withdrawn.operatorFlagEnabled,false);
  assert.equal(withdrawn.readbackVerified,true);
  assert.equal(reads,2);assert.equal(writes,1);
});
