import assert from 'node:assert/strict';
import test from 'node:test';
import { assess, predictionSql, releaseSql, source } from './new-dawn-m1-attention-order-release.mjs';

test('attention migration changes only the two ordering clauses and pins its source', () => {
  const sql=source().sql;
  assert.match(sql,/case status when 'on_hold' then 0 when 'pending' then 1 when 'open' then 2/);
  assert.match(sql,/case fields->>'status' when 'on_hold' then 0/);
  assert.match(sql,/new_dawn\.source_job_home\.operator_preview/);
  assert.doesNotMatch(sql,/\b(?:insert|update|delete|truncate)\s+public\./i);
  assert.match(sql,/commit;\s*$/);
});

test('exact LIVE installer writes one ledger receipt and no feature flag', () => {
  const sql=releaseSql();
  assert.match(sql,/lock table supabase_migrations\.schema_migrations/);
  assert.equal(sql.match(/insert into supabase_migrations\.schema_migrations/g)?.length,1);
  assert.match(sql,/m1_attention_release_preflight_changed/);
  assert.match(sql,/m1_attention_release_postflight_changed/);
  assert.match(sql,/new-dawn-m1-attention-order-installed\/1/);
  assert.match(sql,/commit;\s*$/);
  assert.doesNotMatch(sql,/update public\.feature_flags/i);
  assert.match(releaseSql('00000000-0000-0000-0000-000000000001',true),/rollback;\s*$/);
});

test('prediction remains bounded to saved aggregate statuses inside a read-only rollback', () => {
  const sql=predictionSql();
  assert.match(sql,/^begin transaction read only;/);
  assert.match(sql,/from candidates;rollback;$/);
  assert.match(sql,/limit 24/);
  assert.match(sql,/pending_count/);
  assert.match(sql,/completed_count/);
  assert.doesNotMatch(sql,/select\s+\*\s+from candidates/i);
});

test('release readback requires exact ledger, operator-only gate and unchanged grants', () => {
  const catalog={installed:true,operator_gate:true,audited_preview:true,
    attention_selection:false,attention_response:false,authenticated_execute:true,
    anon_execute:false,service_execute:false,client_enabled:0,
    operator_enabled:1,drummonds_operator_enabled:1};
  assert.equal(assess({catalog,ledger:[]},false),true);
  assert.throws(()=>assess({catalog:{...catalog,client_enabled:1},ledger:[]},false));
  const installed={...catalog,attention_selection:true,attention_response:true};
  assert.equal(assess({catalog:installed,ledger:[{version:'20261107050000',
    name:'new_dawn_source_job_home_attention_order',statements:[source().sql]}]},true),true);
});
