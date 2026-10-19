import assert from 'node:assert/strict';
import test from 'node:test';
import { rollbackReadSql, selectionSql } from './new-dawn-m1-live-source-home-performance.mjs';

test('pinned M1 selection stays bounded, aggregate-only and source-linked', () => {
  const sql = selectionSql();
  assert.match(sql,/with linked as materialized/);
  assert.match(sql,/learn_business_input_current_links/);
  assert.match(sql,/learn_business_input_latest/);
  assert.match(sql,/limit 24/);
  assert.match(sql,/select \(select count\(\*\)::integer from valid\) reviewed_count/);
  assert.doesNotMatch(sql,/\b(?:insert|update|delete|create|commit|rollback)\b/i);
});

test('LIVE execution is fenced in a read-only rollback transaction', () => {
  const sql = rollbackReadSql(selectionSql());
  assert.match(sql,/^begin transaction read only;\nset local statement_timeout='15s';\nwith linked/);
  assert.match(sql,/from rows;\nrollback;$/);
  assert.throws(() => rollbackReadSql(selectionSql() + '; delete from public.jobs'),
    /selection changed/);
  assert.throws(() => rollbackReadSql('select * from public.jobs'),
    /selection changed/);
});
