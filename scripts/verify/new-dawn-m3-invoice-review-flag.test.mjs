import assert from "node:assert/strict";
import test from "node:test";
import {PROJECT,TENANT,VERSION,NAME,FUNCTION_SHA256,INDEX_SHA256,reviewedSource}
  from "./new-dawn-m3-invoice-review-fast-release.mjs";
import {FLAG,assessAudit,assessEnableScope,assessFlagScope,flagSql,readFlagScope,switchLive}
  from "./new-dawn-m3-invoice-review-flag.mjs";

const auditId="00000000-0000-4000-8000-000000000777";
const installed={project:{id:PROJECT,status:"ACTIVE_HEALTHY"},
  ledger:[
    {version:"20261108110000",name:"new_dawn_invoice_review_candidates",statement_count:1,
      source_sha256:"1bc934adf50168eb82c6dc139236911cf9ba6d364d921d7ace98b3b46057e0bc"},
    {version:VERSION,name:NAME,statement_count:1,source_sha256:reviewedSource().hash}],
  catalog:[{rpc_installed:true,index_installed:true,index_ready:true,
    index_sha256:INDEX_SHA256,security_definer:true,
    authenticated_grant:true,anon_grant:false,service_grant:false,
    date_authenticated_grant:false,date_anon_grant:false,date_service_grant:false,
    rpc_sha256:FUNCTION_SHA256,
    date_sha256:"a70d57bf99c61c5018a1067f16d260eab6cb356cd0e71bb05b3ca4f3200637a9",
    active_tenant:true,confirmed_connections:1,
    client_flags_on:0,invoice_preview_flags_on:0}]};
function snapshot(on=false,existing=on){
  return {project:installed.project,
    install:{...installed,catalog:[{...installed.catalog[0],invoice_preview_flags_on:Number(on)}]},
    flags:[{target_rows:Number(existing),target_global:Number(on),target_tenant:Number(on),
      other_rows:0,client_money_on:0,audit_log_present:true,audit_immutable:true}],audit:[]};
}
function audit(on){return {id:auditId,tenant_id:TENANT,
  actor:"codex:delegated-openfolk-operator",
  action:`new_dawn.invoice_review_candidates_preview.${on?'enable':'disable'}`,
  resource_type:"feature_flag",resource_id:FLAG,before:{enabled:!on},after:{enabled:on},
  reason:"Reviewed Drummonds operator-only saved invoice candidate switch",
  source:"codex-release",view_as_active:false,correlation_id:auditId};}

test("enable requires exact installed source, operator grant and client money OFF",()=>{
  assert.equal(assessEnableScope(snapshot(),false).operatorFlagEnabled,false);
  assert.equal(assessEnableScope(snapshot(true),true).operatorFlagEnabled,true);
  for(const change of [
    s=>{s.project.id="wrong";},
    s=>{s.install.ledger[0].source_sha256="0".repeat(64);},
    s=>{s.install.ledger[1].source_sha256="0".repeat(64);},
    s=>{s.install.catalog[0].index_sha256="0".repeat(64);},
    s=>{s.install.catalog[0].anon_grant=true;},
    s=>{s.flags[0].client_money_on=1;},
    s=>{s.flags[0].other_rows=1;},
    s=>{s.flags[0].audit_immutable=false;},
    s=>{s.flags[0].target_rows=2;},
  ]){const s=structuredClone(snapshot());change(s);assert.throws(()=>assessEnableScope(s,false));}
});

test("one transaction changes only the target flag and appends one exact audit row",()=>{
  const sql=flagSql(true,auditId);
  assert.equal(FLAG,"new_dawn.invoice_review_candidates_preview");
  assert.match(sql,/^begin;/);
  assert.match(sql,/lock table public\.feature_flags/);
  assert.match(sql,/lock table public\.controlplane_change_log/);
  assert.match(sql,/20261108120000/);
  assert.match(sql,/learn_quickbooks_latest_invoice_recent_review/);
  assert.match(sql,/m3_invoice_flag_preflight_changed/);
  assert.match(sql,/m3-invoice-review-enabled\/1/);
  assert.equal(sql.match(/insert into public\.controlplane_change_log/g)?.length,1);
  assert.equal(sql.match(/insert into public\.feature_flags/g)?.length,1);
  assert.ok(sql.includes(TENANT));
  assert.match(sql,/\ncommit;$/);
  assert.doesNotMatch(sql,/update public\.learn_quickbooks|insert into public\.learn_quickbooks|GET \/|POST \//);
});

test("withdrawal can turn off the flag even if source or client money state changes",()=>{
  const s=snapshot(true);s.flags[0].client_money_on=1;
  assert.equal(assessFlagScope(s,true,{withdrawal:true}).operatorFlagEnabled,true);
  assert.equal(assessFlagScope(snapshot(false,true),false,{withdrawal:true}).operatorFlagEnabled,false);
  const sql=flagSql(false,auditId);
  assert.match(sql,/m3_invoice_flag_withdraw_preflight_changed/);
  assert.match(sql,/m3-invoice-review-disabled\/1/);
  assert.doesNotMatch(sql,/schema_migrations|pg_get_functiondef/);
});

test("independent audit readback binds exact tenant, action and before/after",()=>{
  const s={...snapshot(true),audit:[audit(true)]};
  assert.equal(assessAudit(s,auditId,true),auditId);
  for(const change of [{tenant_id:"00000000-0000-0000-0000-000000000099"},
    {actor:"other"},{after:{enabled:false}},{view_as_active:true}])
    assert.throws(()=>assessAudit({...s,audit:[{...audit(true),...change}]},auditId,true));
});

test("read-only metadata checks never fetch invoice values",async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    return {ok:true,arrayBuffer:async()=>Buffer.from(JSON.stringify(
      url.endsWith("/read-only")?[]:installed.project))};
  };
  await readFlagScope("synthetic",auditId,fetcher);
  assert.equal(calls.length,3);
  const queries=calls.filter(call=>call.options.body).map(call=>JSON.parse(call.options.body).query);
  assert.ok(queries.every(query=>!query.includes("payload")&&!query.includes("Balance")&&
    !query.includes("learn_quickbooks_latest l")));
  assert.ok(calls.filter(call=>call.options.method==="POST").every(call=>
    call.url.endsWith("/database/query/read-only")));
});

test("an uncertain write receives one independent readback and is never replayed",async()=>{
  let reads=0,writes=0;
  const result=await switchLive(true,{token:"synthetic",auditId,
    readEnable:async()=>++reads===1?snapshot():{...snapshot(true),audit:[audit(true)]},
    write:async()=>{writes++;throw Error("uncertain");}});
  assert.equal(result.operatorFlagEnabled,true);
  assert.equal(result.auditId,auditId);
  assert.equal(result.writeAcknowledged,false);
  assert.equal(reads,2);assert.equal(writes,1);
  reads=0;writes=0;
  await assert.rejects(switchLive(true,{token:"synthetic",auditId,
    readEnable:async()=>{reads++;return snapshot();},
    write:async()=>{writes++;throw Error("uncertain");}}),/outcome_unverified_no_replay/);
  assert.equal(reads,2);assert.equal(writes,1);
});
