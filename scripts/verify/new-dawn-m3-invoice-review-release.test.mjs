import assert from "node:assert/strict";
import test from "node:test";
import {assess,installLive,PROJECT,readStage,reviewedSource,releaseSql,VERSION,NAME}
  from "./new-dawn-m3-invoice-review-release.mjs";

const catalog={rpc_installed:false,date_installed:false,security_definer:false,
  authenticated_grant:false,anon_grant:false,service_grant:false,
  date_authenticated_grant:false,date_anon_grant:false,date_service_grant:false,
  rpc_sha256:null,date_sha256:null,operator_access:true,quickbooks_access:true,
  source_latest:true,source_versions:true,finance_audit:true,active_tenant:true,
  confirmed_connections:1,client_flags_on:0,invoice_preview_flags_on:0};
const before={project:{id:PROJECT,status:"ACTIVE_HEALTHY"},ledger:[],catalog:[catalog]};
const after={...before,ledger:[{version:VERSION,name:NAME,statement_count:1,
  source_sha256:reviewedSource().hash}],catalog:[{...catalog,rpc_installed:true,
  date_installed:true,security_definer:true,authenticated_grant:true,
  rpc_sha256:"f8ca4b3da3f719562b9630a734625b348a000513201fe1100a334f6bd2b50a5c",
  date_sha256:"a70d57bf99c61c5018a1067f16d260eab6cb356cd0e71bb05b3ca4f3200637a9"}]};

test("exact source and migration ledger are pinned without invoice reads or flag writes",()=>{
  const sql=releaseSql();
  assert.match(sql,/^begin;/);
  assert.match(sql,/lock table supabase_migrations\.schema_migrations/);
  assert.match(sql,/lock table public\.feature_flags/);
  assert.match(sql,/m3_invoice_review_install_preflight_changed/);
  assert.match(sql,/insert into supabase_migrations\.schema_migrations/);
  assert.match(sql,/commit;$/);
  assert.doesNotMatch(sql,/update public\.feature_flags|insert into public\.feature_flags/i);
  assert.doesNotMatch(sql,/https:\/\/|GET \/|POST \//i);
});

test("read-only preflight inspects metadata without invoice values",async()=>{
  const queries=[];
  const fetcher=async(url,options)=>{
    if(options.body)queries.push(JSON.parse(options.body).query);
    return {ok:true,arrayBuffer:async()=>Buffer.from(JSON.stringify(
      url.endsWith(PROJECT)?before.project:[]))};
  };
  await readStage(PROJECT,"synthetic",fetcher);
  assert.equal(queries.length,2);
  assert.ok(queries.every(query=>!query.includes("payload") &&
    !query.includes("learn_quickbooks_latest l") &&
    !query.includes("learn_quickbooks_source_versions v")));
});

test("preflight and independent readback require exact catalog, grants and default-off flags",()=>{
  assert.equal(assess(before,false).state,"exact_m3_invoice_review_ready");
  assert.equal(assess(after,true).state,"installed_default_off_readback");
  for(const change of [
    {project:{...before.project,id:"wrong"}},
    {catalog:[{...catalog,client_flags_on:1}]},
    {catalog:[{...catalog,invoice_preview_flags_on:1}]},
    {catalog:[{...catalog,confirmed_connections:2}]},
    {catalog:[{...catalog,source_versions:false}]},
    {ledger:after.ledger},
  ]) assert.throws(()=>assess({...before,...change},false));
  for(const change of [
    {ledger:[{...after.ledger[0],source_sha256:"0".repeat(64)}]},
    {catalog:[{...after.catalog[0],anon_grant:true}]},
    {catalog:[{...after.catalog[0],date_authenticated_grant:true}]},
    {catalog:[{...after.catalog[0],date_service_grant:true}]},
    {catalog:[{...after.catalog[0],rpc_sha256:"0".repeat(64)}]},
    {catalog:[{...after.catalog[0],invoice_preview_flags_on:1}]},
  ]) assert.throws(()=>assess({...after,...change},true));
});

test("one uncertain write gets one readback, never a replay",async()=>{
  let reads=0,writes=0;
  const result=await installLive({project:PROJECT,token:"synthetic",
    read:async()=>++reads===1?before:after,
    write:async()=>{writes++;throw Error("uncertain");}});
  assert.equal(result.state,"installed_default_off_readback");
  assert.equal(result.writeAcknowledged,false);
  assert.equal(reads,2);assert.equal(writes,1);
  reads=0;writes=0;
  await assert.rejects(installLive({project:PROJECT,token:"synthetic",
    read:async()=>++reads===1?before:before,
    write:async()=>{writes++;throw Error("uncertain");}}),/outcome_unverified_no_replay/);
  assert.equal(reads,2);assert.equal(writes,1);
});
