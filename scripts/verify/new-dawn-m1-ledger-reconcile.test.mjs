import assert from 'node:assert/strict';
import test from 'node:test';
import { exactLedger, installedCatalog, reconcileSql, sources } from './new-dawn-m1-ledger-reconcile.mjs';

test('ledger reconciliation pins exactly the two installed M1 sources', () => {
  const files=sources();
  assert.deepEqual(files.map(file=>file.version),['20261106210000','20261106230000']);
  const sql=reconcileSql();
  assert.match(sql,/lock table supabase_migrations\.schema_migrations in share row exclusive mode/);
  assert.equal(sql.match(/insert into supabase_migrations\.schema_migrations/g)?.length,1);
  assert.match(sql,/new-dawn-m1-ledger-reconciled\/1/);
  assert.match(sql,/commit;\s*$/);
  const executablePrefix=sql.slice(0,sql.indexOf('insert into supabase_migrations.schema_migrations'));
  assert.doesNotMatch(executablePrefix,/(?:create|replace|alter)\s+function public\.new_dawn_source_job_home/i);
  assert.doesNotMatch(executablePrefix,/update public\.feature_flags/i);
  assert.match(reconcileSql(files,true),/rollback;\s*$/);
});

test('readback requires exact ledger text and bounded audited function', () => {
  const files=sources();
  const rows=files.map(file=>({version:file.version,name:file.name,statements:[file.source]}));
  assert.equal(exactLedger(rows),true);
  assert.equal(exactLedger([{...rows[0],statements:['different']},rows[1]]),false);
  assert.equal(exactLedger(rows.slice(0,1)),false);
  const catalog={installed:true,security_definer:true,operator_gate:true,audited_preview:true,
    bounded_page:true,authenticated_execute:true,anon_execute:false,service_execute:false,enabled_flags:0};
  assert.equal(installedCatalog(catalog),true);
  assert.equal(installedCatalog({...catalog,enabled_flags:1}),false);
  assert.equal(installedCatalog({...catalog,operator_gate:false}),false);
});
