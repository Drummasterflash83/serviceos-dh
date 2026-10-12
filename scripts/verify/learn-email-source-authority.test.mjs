import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesEmailSourceAuthority as matches } from './learn-email-source-authority.mjs';

const prepared = { last_verified_at: '2026-10-12T13:46:01Z', status: 'active',
  email_address: 'fixture@example.invalid', service_account_client_id: 'fixture',
  delegated_scopes: ['gmail.readonly'], sync_enabled: true };
test('accepts unchanged authority with a newer successful verification', () => {
  assert.equal(matches(prepared, prepared), true);
  assert.equal(matches(prepared, { ...prepared, last_verified_at: '2026-10-12T14:26:01Z' }), true);
});
test('rejects changed identity, permissions, activation and missing fields', () => {
  for (const [key, value] of Object.entries({ status: 'disabled', email_address: 'other@example.invalid',
    service_account_client_id: 'other', delegated_scopes: ['gmail.modify'], sync_enabled: false })) {
    assert.equal(matches(prepared, { ...prepared, [key]: value }), false);
  }
  const { status, ...missing } = prepared;
  assert.equal(matches(prepared, missing), false);
});
test('rejects older or invalid verification', () => {
  for (const value of ['2026-10-12T12:00:00Z', null, 'invalid'])
    assert.equal(matches(prepared, { ...prepared, last_verified_at: value }), false);
});
