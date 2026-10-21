import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, installExact, releaseSql, source } from './new-dawn-card-graph-count-release.mjs';

const hash = '8176fecdf713f208aeee691fdbb778b11981fd079ead07997e6001d7c5b124f0';
const absent = { rpc_present: false, ledger_count: 0, ledger_sha: null, endpoint_indexes: 2,
  service_execute: null, anon_execute: null, authenticated_execute: null };
const installed = { rpc_present: true, ledger_count: 1, ledger_sha: hash, endpoint_indexes: 2,
  service_execute: true, anon_execute: false, authenticated_execute: false };

test('exact source is one guarded migration with a ledger write in the same transaction', () => {
  assert.match(source(), /create function public\.learn_customer_card_relationship_counts/);
  const sql = releaseSql();
  assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
  assert.match(sql, /to_regprocedure\('public\.learn_customer_card_relationship_counts\(uuid,uuid\[\]\)'\) is not null/);
  assert.match(sql, /insert into supabase_migrations\.schema_migrations/);
  assert.ok(sql.indexOf('create function') < sql.indexOf('insert into supabase_migrations'));
  assert.ok(sql.trimEnd().endsWith('commit;'));
});

test('readback rejects partial installs, missing indexes and wrong grants', () => {
  assert.equal(assess([absent]).state, 'absent');
  assert.equal(assess([installed]).state, 'installed');
  for (const changed of [
    { ...installed, ledger_sha: 'wrong' },
    { ...installed, anon_execute: true },
    { ...installed, endpoint_indexes: 1 },
    { ...absent, rpc_present: true },
  ]) assert.throws(() => assess([changed]));
});

test('one uncertain write is never replayed when exact readback proves install', async () => {
  const calls = [];
  const fetcher = async (url, request) => {
    calls.push({url, query: JSON.parse(request.body).query});
    if (url.endsWith('/read-only'))
      return Response.json([calls.filter(x => !x.url.endsWith('/read-only')).length ? installed : absent]);
    throw Error('lost acknowledgement');
  };
  const result = await installExact('synthetic-token', fetcher);
  assert.equal(result.state, 'installed');
  assert.equal(result.acknowledged, false);
  assert.equal(result.writeQueries, 1);
  assert.equal(calls.filter(x => !x.url.endsWith('/read-only')).length, 1);
});
