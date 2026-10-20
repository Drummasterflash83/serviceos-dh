import assert from "node:assert/strict";
import test from "node:test";
import { PROJECT,TENANT,VERSION,NAME,reviewedSource } from "./new-dawn-m3-report-pairs-release.mjs";
import { assess,assessFlagState,flagSql,switchLive } from "./new-dawn-m3-job-home-accounts-flag.mjs";

function snapshot(enabled=false){
  return {project:{id:PROJECT,status:"ACTIVE_HEALTHY"},
    ledger:[{version:VERSION,name:NAME,statement_count:1,source_sha256:reviewedSource().hash}],
    catalog:[{installed:true,security_definer:true,authenticated_grant:true,
      anon_grant:false,service_grant:false,summary_rpc:true,active_tenant:true,
      confirmed_connections:1}],
    selector:[{selector_sha256:"8ecba7c16d0d4fa25399e81f9c33440197ae807c6d189489b0f8b130146b479d"}],
    pairs:[{operator_pair_available:true}],
    flags:[{operator_global:Number(enabled),operator_tenant:Number(enabled),
      other_tenant_rows:0,client_money_on:0,report_global:1,report_tenant:1,
      job_global:1,job_tenant:1}]};
}

test("enable is exact Drummonds operator-only and never changes client money",()=>{
  assert.equal(assess(snapshot(false),false).operatorFlagEnabled,false);
  assert.equal(assess(snapshot(true),true).clientMoneyFlagsEnabled,false);
  const sql=flagSql(true);
  assert.match(sql,/^begin;/);
  assert.match(sql,/lock table public\.feature_flags/);
  assert.match(sql,/m3_home_flag_preflight_changed/);
  assert.match(sql,/new_dawn\.report_summary_preview/);
  assert.match(sql,/new_dawn\.source_job_home\.operator_preview/);
  assert.match(sql,/new_dawn\.owner_accounts_report/);
  assert.match(sql,/new_dawn\.owner_money/);
  assert.match(sql,/20261108100000/);
  assert.match(sql,/m3-home-accounts-enabled\/1/);
  assert.match(sql,/\ncommit;$/);
  assert.equal(sql.match(/insert into public\.feature_flags\(tenant_id,flag,value\)/g)?.length,1);
  assert.ok(sql.includes(TENANT));
  assert.doesNotMatch(sql,/GET \/|POST \/|update public\.learn_quickbooks_report/);
});

test("enable denies wrong scope, unsafe flags, missing pair or altered selector",()=>{
  const changes=[
    s=>{s.project.id="wrong";},
    s=>{s.ledger[0].source_sha256="0".repeat(64);},
    s=>{s.selector[0].selector_sha256="0".repeat(64);},
    s=>{s.pairs[0].operator_pair_available=false;},
    s=>{s.flags[0].client_money_on=1;},
    s=>{s.flags[0].report_tenant=0;},
    s=>{s.flags[0].job_global=2;},
    s=>{s.flags[0].other_tenant_rows=1;},
  ];
  for(const change of changes){const s=snapshot();change(s);assert.throws(()=>assess(s,false));}
});

test("withdrawal needs only exact flag scope, even if report source disappears",()=>{
  const broken=snapshot(true);broken.pairs[0].operator_pair_available=false;
  broken.catalog[0].installed=false;
  assert.equal(assessFlagState(broken,true).operatorFlagEnabled,true);
  const sql=flagSql(false);
  assert.match(sql,/m3_home_flag_withdraw_preflight_changed/);
  assert.match(sql,/m3-home-accounts-disabled\/1/);
  assert.doesNotMatch(sql,/report_pair_candidates|report_summary_preview/);
  assert.match(sql,/\ncommit;$/);
  assert.throws(()=>assessFlagState({...broken,flags:[{...broken.flags[0],other_tenant_rows:1}]},true));
});

test("uncertain switch is read once and never replayed",async()=>{
  let reads=0,writes=0;
  const result=await switchLive(true,{token:"synthetic",
    read:async()=>++reads===1?snapshot(false):snapshot(true),
    write:async()=>{writes++;throw Error("connection lost after commit");}});
  assert.equal(result.operatorFlagEnabled,true);
  assert.equal(result.writeAcknowledged,false);
  assert.equal(reads,2);assert.equal(writes,1);
  reads=0;writes=0;
  await assert.rejects(switchLive(true,{token:"synthetic",
    read:async()=>{reads++;return snapshot(false);},
    write:async()=>{writes++;throw Error("uncertain");}}),/outcome_unverified_no_replay/);
  assert.equal(reads,2);assert.equal(writes,1);
  reads=0;writes=0;
  const withdrawn=await switchLive(false,{token:"synthetic",
    read:async()=>++reads===1?snapshot(true):snapshot(false),
    write:async()=>[{marker:"m3-home-accounts-disabled/1"}]});
  assert.equal(withdrawn.operatorFlagEnabled,false);
  assert.equal(reads,2);
});
