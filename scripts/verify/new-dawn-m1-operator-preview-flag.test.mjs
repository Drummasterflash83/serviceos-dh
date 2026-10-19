import assert from 'node:assert/strict';
import test from 'node:test';
import { flagSql } from './new-dawn-m1-operator-preview-flag.mjs';

test('enable only the exact Drummonds operator preview while rejecting any client release', () => {
  const sql=flagSql(true);
  assert.match(sql,/00000000-0000-0000-0000-000000000001/);
  assert.match(sql,/new_dawn\.source_job_home\.operator_preview/);
  assert.match(sql,/m1_operator_preview_preflight_changed/);
  assert.match(sql,/new-dawn-m1-operator-preview-enabled\/1/);
  assert.match(sql,/commit;\s*$/);
  assert.doesNotMatch(sql,/set value='true'::jsonb\s+where[^;]+flag='new_dawn\.source_job_home'/i);
  assert.match(sql,/flag='new_dawn\.source_job_home' and value='true'::jsonb/);
});

test('disable the same operator preview and support rollback rehearsal', () => {
  const sql=flagSql(false);
  assert.match(sql,/new-dawn-m1-operator-preview-disabled\/1/);
  assert.match(sql,/set value='false'::jsonb/);
  assert.match(flagSql(true,true),/rollback;\s*$/);
  assert.throws(()=>flagSql(true,false,'not-a-uuid'));
});
