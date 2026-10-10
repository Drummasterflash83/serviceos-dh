import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCurrentWindowGap,
  buildCorroboration,
  indexSiteCustomers,
} from './lib/prepare-canonical-core.mjs';

function fixture() {
  return {
    unmatchedIds: ['20'],
    profitWindow: {
      header: ['Job date', 'Customer Account Number', 'Job description', 'Job number', 'Job is complete'],
      rows: [['01/08/2026', '1', 'SYNTHETIC PRIVATE DESCRIPTION', '20', 'Yes']],
    },
    customerIds: new Set(['1', '2']),
    siteCustomers: indexSiteCustomers([{external_id: '10', customer_external_id: '1'}]),
    corroboration: buildCorroboration([[{job: '20', customer: '1', workAddress: '10', sourceType: 'diary'}]]),
    windowLabel: 'synthetic',
  };
}

test('exact same-customer evidence reconstructs without inventing engineer or completion time', () => {
  const input = fixture();
  const result = classifyCurrentWindowGap(input);
  assert.equal(result.counts.fully_reconstructable, 1);
  assert.equal(result.provenance.site_exact, 1);
  assert.equal(result.reconstructable[0].site_external_id, '10');
  assert.equal(result.reconstructable[0].engineer, '');
  assert.equal(result.reconstructable[0].completed_date, '');
  assert.equal(input.profitWindow.rows[0][2], 'SYNTHETIC PRIVATE DESCRIPTION');
});

test('agreeing diary references cannot override site customer ownership', () => {
  const input = fixture();
  input.siteCustomers.set('10', '2');
  const before = structuredClone(input);
  const result = classifyCurrentWindowGap(input);
  assert.equal(result.counts.conflict_or_duplicate, 1);
  assert.equal(result.counts.fully_reconstructable, 0);
  assert.equal(result.provenance.site_customer_conflicts, 1);
  assert.equal(result.provenance.site_exact, 0);
  assert.deepEqual(result.reconstructable, []);
  assert.equal(result.classified, 1);
  assert.deepEqual(input, before);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC PRIVATE DESCRIPTION/);
});

test('legacy existence-only callers and invalid ownership maps fail before producing rows', () => {
  for (const ownerMap of [undefined, new Set(['10']), new Map([['10', '']]), new Map([['10', null]])]) {
    const input = fixture();
    input.siteIds = new Set(['10']);
    input.siteCustomers = ownerMap;
    assert.throws(() => classifyCurrentWindowGap(input), /site ownership evidence/);
  }
});

test('duplicate site masters cannot silently overwrite an ownership contradiction', () => {
  for (const owner of ['1', '2']) {
    assert.throws(() => indexSiteCustomers([
      {external_id: '10', customer_external_id: '1'},
      {external_id: '10', customer_external_id: owner},
    ]), /duplicate site ownership evidence/);
  }
});

test('missing or competing site references remain unlinked; customer conflicts still block', () => {
  for (const kind of ['absent', 'multiple', 'customer_conflict']) {
    const input = fixture();
    if (kind === 'absent') input.siteCustomers.clear();
    if (kind === 'multiple') input.corroboration.get('20').workAddresses.add('11');
    if (kind === 'customer_conflict') input.corroboration.get('20').customers.add('2');
    const result = classifyCurrentWindowGap(input);
    assert.equal(result.classified, 1);
    if (kind === 'customer_conflict') {
      assert.equal(result.counts.conflict_or_duplicate, 1);
      assert.equal(result.provenance.customer_conflicts, 1);
      assert.deepEqual(result.reconstructable, []);
    } else {
      assert.equal(result.counts.fully_reconstructable, 1);
      assert.equal(result.reconstructable[0].site_external_id, '');
      assert.equal(result.provenance.site_exact, 0);
    }
  }
});
