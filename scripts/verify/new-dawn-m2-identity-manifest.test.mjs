import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const privateRoot = join(root, '.verification-results');
const tenant = '00000000-0000-4000-8000-000000000001';
const connection = '00000000-0000-4000-8000-000000000002';
const version = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const source = (collection, id, ver, fields) => ({ kind: 'source_version',
  collection, external_id: String(id), version_id: version(ver),
  source: { id, ...fields } });
const observation = (collection, id, ver) => ({ kind: 'source_observation',
  collection, external_id: String(id), version_id: version(ver),
  committed_at: '2026-10-20T17:00:00Z' });
const rows = [
  { kind: 'scope', tenant_id: tenant, connection_id: connection },
  source('properties', 21, 1, { type: 'customer', customerType: 4,
    companyName: 'Synthetic Works', addressLine1: '1 Synthetic Road', postcode: 'AB1 2CD' }),
  source('properties', 22, 2, { type: 'workaddress', parentPropertyID: 21,
    addressLine1: '2 Synthetic Road', postcode: 'AB2 3CD' }),
  source('jobs', 31, 3, { propertyID: 21 }),
  source('jobs', 32, 4, { propertyID: 22 }),
  source('properties', 23, 5, { type: 'customer', customerType: 5,
    firstName: 'Ada', lastName: 'Example', addressLine1: '3 Synthetic Road',
    postcode: 'CD1 2EF' }),
  source('jobs', 33, 6, { propertyID: 23 }),
  source('jobs', 34, 7, { propertyID: 99 }),
  source('properties', 24, 8, { type: 'customer', customerType: 4,
    companyName: 'Collision Ltd', addressLine1: '4 Synthetic Road', postcode: 'XY1 2ZZ' }),
  source('jobs', 35, 9, { propertyID: 24 }),
  source('jobs', 36, 10, { propertyID: 21 }),
  source('jobs', 37, 11, { propertyID: 21 }),
  ...[['properties', 21, 1], ['properties', 22, 2], ['jobs', 31, 3],
    ['jobs', 32, 4], ['properties', 23, 5], ['jobs', 33, 6],
    ['jobs', 34, 7], ['properties', 24, 8], ['jobs', 35, 9],
    ['jobs', 36, 10], ['jobs', 37, 11]]
    .map(([collection, id, ver]) => observation(collection, id, ver)),
  { kind: 'link', collection: 'jobs', external_id: '36', entity_kind: 'job', current: true },
  { kind: 'link', collection: 'jobs', external_id: '37', entity_kind: 'job', current: false },
  { kind: 'site', source_system: 'native', external_id: 'fixture', postcode: 'XY1 2ZZ' },
  { kind: 'end', tenant_id: tenant, connection_id: connection },
];

test('full saved-job classification produces only clean exact-version manifests', () => {
  mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(privateRoot, 'm2-manifest-synthetic-'));
  try {
    const snapshot = join(dir, 'snapshot.jsonl');
    const map = join(dir, 'kind-map.json');
    const out = join(dir, 'out');
    writeFileSync(snapshot, rows.map(x => JSON.stringify(x)).join('\n') + '\n',
      { mode: 0o600 });
    writeFileSync(map, JSON.stringify({ kind_map: { 4: 'company', 5: 'person' },
      kind_evidence_sha256: 'a'.repeat(64), status: 'reviewed_for_registration' }),
      { mode: 0o600 });
    const result = spawnSync(process.execPath,
      [join(root, 'scripts/verify/new-dawn-m2-identity-manifest.mjs'),
        '--snapshot', snapshot, '--kind-map', map, '--out', out,
        '--tenant', tenant, '--connection', connection],
      { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const printed = JSON.parse(result.stdout);
    assert.equal(printed.source_job_count, 7);
    assert.equal(printed.already_linked_jobs, 1);
    assert.equal(printed.unlinked_source_job_count, 6);
    assert.deepEqual(printed.clean, { customers: 1, sites: 2, jobs: 2,
      by_category: { 4: { customers: 1, sites: 2, jobs: 2 } } });
    assert.equal(printed.held.jobs, 4);
    assert.deepEqual(printed.held.classes, {
      account_holder_review_required: { customers: 1, sites: 1, jobs: 1 },
      property_source_missing_or_ambiguous: { customers: 0, sites: 0, jobs: 1 },
      retained_reversed_link_review: { customers: 0, sites: 0, jobs: 1 },
      site_postcode_collision: { customers: 1, sites: 1, jobs: 1 },
    });
    assert.equal(printed.manifest_count, 1);
    assert.ok(!result.stdout.includes('Synthetic') &&
      !result.stdout.includes('external_id') && !result.stdout.includes('customer_id'));
    const manifestPath = join(out, 'manifest-0001.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.items.length, 5);
    assert.deepEqual(manifest.items.map(x => x.kind),
      ['customer', 'site', 'site', 'job', 'job']);
    assert.deepEqual(manifest.items.map(x => x.external_id),
      ['21', '21', '22', '31', '32']);
    assert.equal(statSync(manifestPath).mode & 0o777, 0o600);
    assert.equal(statSync(join(out, 'aggregate.json')).mode & 0o777, 0o600);
    assert.equal(statSync(out).mode & 0o777, 0o700);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('unproposed saved customer and site collisions hold the whole group', () => {
  mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(privateRoot, 'm2-source-collision-'));
  try {
    const map = join(dir, 'kind-map.json');
    writeFileSync(map, JSON.stringify({ kind_map: { 4: 'company', 5: 'person' },
      kind_evidence_sha256: 'a'.repeat(64), status: 'reviewed_for_registration' }),
      { mode: 0o600 });
    const scenarios = [
      { label: 'customer', extra: source('properties', 97, 97,
        { type: 'customer', customerType: 4, companyName: 'Synthetic Works',
          addressLine1: '99 Synthetic Road', postcode: 'ZX9 9ZX' }),
        reason: 'customer_source_collision' },
      { label: 'site', extra: source('properties', 96, 96,
        { type: 'workaddress', parentPropertyID: 97, addressLine1: '96 Synthetic Road',
          postcode: 'AB2 3CD' }), reason: 'site_source_collision' },
    ];
    for (const scenario of scenarios) {
      const snapshot = join(dir, `${scenario.label}.jsonl`);
      const out = join(dir, `${scenario.label}-out`);
      const beforeEnd = rows.slice(0, -1);
      const extraRows = [scenario.extra,
        observation('properties', scenario.extra.external_id,
          Number(scenario.extra.external_id))];
      writeFileSync(snapshot, [...beforeEnd, ...extraRows, rows.at(-1)]
        .map(x => JSON.stringify(x)).join('\n') + '\n', { mode: 0o600 });
      const result = spawnSync(process.execPath,
        [join(root, 'scripts/verify/new-dawn-m2-identity-manifest.mjs'),
          '--snapshot', snapshot, '--kind-map', map, '--out', out,
          '--tenant', tenant, '--connection', connection], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const printed = JSON.parse(result.stdout);
      assert.equal(printed.clean.jobs, 0);
      assert.equal(printed.held.classes[scenario.reason].jobs, 2);
      assert.equal(printed.source_job_count,
        printed.clean.jobs + printed.held.jobs + printed.already_linked_jobs);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('provisional kind map produces aggregates but no registrable manifest', () => {
  mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(privateRoot, 'm2-provisional-'));
  try {
    const snapshot = join(dir, 'snapshot.jsonl');
    const map = join(dir, 'kind-map.json');
    const out = join(dir, 'out');
    writeFileSync(snapshot, rows.map(x => JSON.stringify(x)).join('\n') + '\n',
      { mode: 0o600 });
    writeFileSync(map, JSON.stringify({ kind_map: { 4: 'company', 5: 'person' },
      kind_evidence_sha256: 'a'.repeat(64),
      status: 'provisional_not_apply_authorized' }), { mode: 0o600 });
    const result = spawnSync(process.execPath,
      [join(root, 'scripts/verify/new-dawn-m2-identity-manifest.mjs'),
        '--snapshot', snapshot, '--kind-map', map, '--out', out,
        '--tenant', tenant, '--connection', connection], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const aggregate = JSON.parse(readFileSync(join(out, 'aggregate.json'), 'utf8'));
    assert.equal(aggregate.authority_status, 'provisional_not_apply_authorized');
    assert.equal(aggregate.clean.jobs, 2);
    assert.equal(aggregate.manifest_count, 0);
    assert.equal(statSync(out).mode & 0o777, 0o700);
    assert.equal(statSync(join(out, 'aggregate.json')).mode & 0o777, 0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
