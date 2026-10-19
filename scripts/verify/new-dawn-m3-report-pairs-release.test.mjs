import assert from "node:assert/strict";
import test from "node:test";
import { assess, installLive, PROJECT, reviewedSource, releaseSql, VERSION, NAME } from "./new-dawn-m3-report-pairs-release.mjs";

const counts={report_requests:5,report_receipts:4,finance_events:131};
const catalog={installed:false,security_definer:false,authenticated_grant:false,
  anon_grant:false,service_grant:false,summary_rpc:true,
  summary_sha256:"b98df331e0613be5cc490ed0f8f0f283233378b058433ceb81cfb9e75ea531a4",
  extract_sha256:"a8aa46ebcdbb07e24dfb0d103c37ced3a84b33efb76f77b89e5d0e11e30e8642",
  capture_finish_sha256:"351da00347b7e9a4df4f73bc2619c096afb2af593a3ca136ece2dd90f864996c",
  active_tenant:true,confirmed_connections:1,client_flags_on:0,
  home_operator_on:0,report_preview_on:1};
const before={project:{id:PROJECT,status:"ACTIVE_HEALTHY"},ledger:[],catalog:[catalog],counts:[counts]};
const after={...before,ledger:[{version:VERSION,name:NAME,statement_count:1,
  source_sha256:reviewedSource().hash}],catalog:[{...catalog,installed:true,
  security_definer:true,authenticated_grant:true}]};

test("exact report-pair SQL is wrapped, pinned and never toggles a money flag",()=>{
  const sql=releaseSql();
  assert.match(sql,/^begin;/);
  assert.match(sql,/lock table supabase_migrations\.schema_migrations/);
  assert.match(sql,/m3_pairs_install_preflight_changed/);
  assert.match(sql,/insert into supabase_migrations\.schema_migrations/);
  assert.match(sql,/commit;$/);
  assert.doesNotMatch(sql,/update public\.feature_flags|insert into public\.feature_flags/i);
  assert.doesNotMatch(sql,/https:\/\/|GET \/|POST \//);
});

test("readback proves exact ledger, source functions, grants and default-off boundary",()=>{
  assert.equal(assess(before,false).state,"exact_m3_pairs_ready");
  assert.equal(assess(after,true).state,"installed_default_off_readback");
  assert.equal(assess({...after,catalog:[{...after.catalog[0],home_operator_on:1}]},
    true,reviewedSource(),true).operatorPreviewEnabled,true);
  for(const changed of [
    {...before,project:{...before.project,id:"wrong"}},
    {...before,catalog:[{...catalog,client_flags_on:1}]},
    {...before,catalog:[{...catalog,extract_sha256:"0".repeat(64)}]},
    {...before,catalog:[{...catalog,report_preview_on:0}]},
    {...before,ledger:[after.ledger[0]]},
  ])assert.throws(()=>assess(changed,false));
  assert.throws(()=>assess({...after,ledger:[{...after.ledger[0],source_sha256:"0".repeat(64)}]},true));
});

test("one uncertain write is read back once and never replayed",async()=>{
  let reads=0,writes=0;
  const result=await installLive({project:PROJECT,token:"synthetic",read:async()=>++reads===1?before:after,
    write:async()=>{writes++;throw Error("uncertain");}});
  assert.equal(result.state,"installed_default_off_readback");
  assert.equal(result.writeAcknowledged,false);
  assert.equal(writes,1);assert.equal(reads,2);
  reads=0;writes=0;
  await assert.rejects(installLive({project:PROJECT,token:"synthetic",
    read:async()=>++reads===1?before:before,
    write:async()=>{writes++;throw Error("uncertain");}}),/outcome_unverified_no_replay/);
  assert.equal(writes,1);assert.equal(reads,2);
});
