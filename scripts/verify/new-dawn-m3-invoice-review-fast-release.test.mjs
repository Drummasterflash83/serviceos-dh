import assert from 'node:assert/strict';
import test from 'node:test';
import {assess,installLive,PROJECT,readStage,reviewedSource,releaseSql,
  VERSION,NAME,FUNCTION_SHA256,INDEX_SHA256}
  from './new-dawn-m3-invoice-review-fast-release.mjs';

const project={id:PROJECT,status:'ACTIVE_HEALTHY'};
const base={version:'20261108110000',name:'new_dawn_invoice_review_candidates',
  statement_count:1,source_sha256:'1bc934adf50168eb82c6dc139236911cf9ba6d364d921d7ace98b3b46057e0bc'};
const fast={version:VERSION,name:NAME,statement_count:1,source_sha256:reviewedSource().hash};
const catalog={rpc_installed:true,
  rpc_sha256:'f8ca4b3da3f719562b9630a734625b348a000513201fe1100a334f6bd2b50a5c',
  date_sha256:'a70d57bf99c61c5018a1067f16d260eab6cb356cd0e71bb05b3ca4f3200637a9',
  index_installed:false,index_sha256:null,index_ready:null,
  security_definer:true,authenticated_grant:true,anon_grant:false,service_grant:false,
  date_authenticated_grant:false,date_anon_grant:false,date_service_grant:false,
  active_tenant:true,confirmed_connections:1,client_flags_on:0,invoice_preview_flags_on:0};
const before={project,ledger:[base],catalog:[catalog]};
const after={project,ledger:[base,fast],catalog:[{...catalog,
  rpc_sha256:FUNCTION_SHA256,index_installed:true,index_sha256:INDEX_SHA256,index_ready:true}]};

test('exact additive release requires the previous source and keeps every money flag off',()=>{
  const sql=releaseSql();
  assert.match(sql,/^begin;/);
  assert.match(sql,/20261108110000/);
  assert.match(sql,/20261108120000/);
  assert.match(sql,/m3_fast_install_preflight_changed/);
  assert.match(sql,/learn_quickbooks_latest_invoice_recent_review/);
  assert.equal(sql.match(/insert into supabase_migrations\.schema_migrations/g)?.length,1);
  assert.match(sql,/\ncommit;$/);
  assert.doesNotMatch(sql,/update public\.feature_flags|insert into public\.feature_flags/i);
  assert.doesNotMatch(sql,/https:\/\/|GET \/|POST \//i);
});

test('readback rejects a changed source, index, grant or active scope',()=>{
  assert.equal(assess(before,false).state,'fast_invoice_review_ready');
  assert.equal(assess(after,true).state,'fast_invoice_review_installed');
  assert.equal(assess({...after,catalog:[{...after.catalog[0],invoice_preview_flags_on:1}]},
    true,reviewedSource(),true).invoiceReviewFlagEnabled,true);
  for(const edit of [
    s=>{s.ledger[0].source_sha256='0'.repeat(64);},
    s=>{s.catalog[0].rpc_sha256='0'.repeat(64);},
    s=>{s.catalog[0].anon_grant=true;},
    s=>{s.catalog[0].client_flags_on=1;},
    s=>{s.catalog[0].invoice_preview_flags_on=1;},
  ]){const s=structuredClone(before);edit(s);assert.throws(()=>assess(s,false));}
  for(const edit of [
    s=>{s.ledger[1].source_sha256='0'.repeat(64);},
    s=>{s.catalog[0].index_sha256='0'.repeat(64);},
    s=>{s.catalog[0].index_ready=false;},
    s=>{s.catalog[0].rpc_sha256='0'.repeat(64);},
  ]){const s=structuredClone(after);edit(s);assert.throws(()=>assess(s,true));}
});

test('preflight reads metadata only, with no saved invoice payloads',async()=>{
  const queries=[];
  const fetcher=async(url,options)=>{
    if(options.body)queries.push(JSON.parse(options.body).query);
    return {ok:true,arrayBuffer:async()=>Buffer.from(JSON.stringify(
      url.endsWith(PROJECT)?project:[]))};
  };
  await readStage(PROJECT,'synthetic',fetcher);
  assert.equal(queries.length,2);
  assert.ok(queries.every(query=>!query.includes('payload')&&
    !query.includes('learn_quickbooks_latest l')&&
    !query.includes('learn_quickbooks_source_versions v')));
});

test('uncertain install is independently read once and never replayed',async()=>{
  let reads=0,writes=0;
  const result=await installLive({project:PROJECT,token:'synthetic',
    read:async()=>++reads===1?before:after,
    write:async()=>{writes++;throw Error('uncertain');}});
  assert.equal(result.state,'fast_invoice_review_installed');
  assert.equal(result.writeAcknowledged,false);
  assert.equal(reads,2);assert.equal(writes,1);
  reads=0;writes=0;
  await assert.rejects(installLive({project:PROJECT,token:'synthetic',
    read:async()=>{reads++;return before;},
    write:async()=>{writes++;throw Error('uncertain');}}),/outcome_unverified_no_replay/);
  assert.equal(reads,2);assert.equal(writes,1);
});
