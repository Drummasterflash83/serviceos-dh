import test from 'node:test';
import assert from 'node:assert/strict';
import { quickBooksExportQuery } from './quickbooks-export-query.mjs';

test('rejects injection, missing scope and unsupported environments before preparing SQL', () => {
  for (const tenant of [undefined, '', "';delete from tenants;--", '00000000-0000-4000-8000-000000000001\n'])
    assert.throws(() => quickBooksExportQuery(tenant, 'production'));
  for (const env of [undefined, '', 'all', "production';--"])
    assert.throws(() => quickBooksExportQuery('00000000-0000-4000-8000-000000000001', env));
});

test('read-only export excludes credential-bearing tables and preserves exact payload text', () => {
  const query = quickBooksExportQuery('00000000-0000-4000-8000-000000000001', 'production');
  assert.match(query, /^begin isolation level repeatable read read only;/);
  assert.doesNotMatch(query, /vault\.|learn_quickbooks_apps|token_secret_id|client_secret|state_hash|token_digest|learn_quickbooks_authorizations/);
  assert.match(query, /v\.payload::text payload_text/);
  assert.match(query, /p\.raw_envelope/);
  assert.match(query, /v\.realm_id=i\.realm_id/);
});
