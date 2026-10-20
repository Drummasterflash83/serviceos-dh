import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FACET_COLUMNS, VISIT_COLUMNS_V2, prepareJobFacetCsv } from './prepare-job-facet-csv.mjs';

const manifest = {
  tenant_id: '00000000-0000-4000-8000-000000000001',
  connection_id: '00000000-0000-4000-8000-000000000002',
  source: 'commusoft_csv', facet: 'visits', exported_at: '2026-10-19T09:00:00Z',
};
const csv = (facet, rows) => [FACET_COLUMNS[facet].join(','), ...rows].join('\r\n') + '\r\n';
const visitV2 = { ...manifest, exported_at: '2026-10-20T09:00:00Z',
  contract: 'commusoft_visit_export/2', visit_export: {
  source_account_ref: 'drummonds-v2', covered_from: '2026-10-01T00:00:00+01:00',
  covered_to: '2026-10-20T00:00:00+01:00', source_timezone: 'Europe/London',
  coverage: 'complete_window', event_id_semantics: 'event_level_appointment_id',
  job_id_semantics: 'v2_jobs_id', correction_policy: 'same_id_newer_updated_at',
  field_dictionary_sha256: 'a'.repeat(64),
} };
const v2Csv = rows => [VISIT_COLUMNS_V2.join(','), ...rows].join('\n') + '\n';

test('current visit export v2 retains bounded provenance and source correction fields', () => {
  const result = prepareJobFacetCsv(visitV2, v2Csv([
    'event-1,955,001,2026-10-18T09:00:00+01:00,2026-10-18T10:00:00+01:00,user-2,Booked,,2026-10-19T11:00:00+01:00',
  ]));
  assert.equal(result.version, 'commusoft-job-facet-csv/2');
  assert.equal(result.manifest.visit_export.coverage, 'complete_window');
  assert.equal(result.records[0].fields.job_code, '001');
  assert.equal(result.records[0].time_states.updated_at, 'zoned');
  assert.equal(result.records[0].time_states.cancelled_at, 'absent');
  assert.throws(() => prepareJobFacetCsv({ ...visitV2, visit_export: {
    ...visitV2.visit_export, source_timezone: 'not/a-timezone',
  } }, v2Csv([])), /visit_export_timezone_invalid/);
  assert.throws(() => prepareJobFacetCsv(visitV2, csv('visits', [])), /csv_columns_invalid/);
});

test('visits preserve exact source IDs and job codes, without assigning an engineer', () => {
  const result = prepareJobFacetCsv(manifest, csv('visits', [
    'visit-01,955,001,2026-10-18T09:00:00+01:00,2026-10-18T10:00:00+01:00,user-2,Booked',
    'visit-02,,008,2026-10-19 09:00:00,,user-3,Pending',
  ]));
  assert.equal(result.counts.source_id_present, 1);
  assert.equal(result.counts.held_missing_job_id, 1);
  assert.equal(result.records[0].identity.tenant_id, manifest.tenant_id);
  assert.equal(result.records[0].fields.job_code, '001');
  assert.deepEqual(result.records[0].link, { state: 'source_id_present', job_external_id: '955' });
  assert.equal(result.records[0].fields.engineer_id, 'user-2');
  assert.equal(result.records[1].time_states.starts_at, 'timezone_required');
  assert.deepEqual(result.records[1].link, { state: 'held_missing_job_id', job_external_id: null });
});

test('quoted CSV cells, UTC boundary offsets and corrections stay source text', () => {
  const source = csv('parts_costs', ['part-1,955,001,"Boiler, valve ""A""",2,10.50,GBP']);
  const result = prepareJobFacetCsv({ ...manifest, facet: 'parts_costs' }, source);
  assert.equal(result.records[0].fields.description, 'Boiler, valve "A"');
  assert.equal(result.records[0].fields.amount, '10.50');
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  const visit = prepareJobFacetCsv(manifest, csv('visits', [
    'v1,955,001,2026-10-18T00:30:00+01:00,,,Booked',
  ]));
  assert.equal(visit.records[0].time_states.starts_at, 'zoned');
});

test('foreign scope, malformed headers, duplicate IDs and bad dates fail or remain held', () => {
  const good = csv('visits', ['v1,955,001,2026-02-30T09:00:00Z,,,Booked']);
  assert.equal(prepareJobFacetCsv(manifest, good).records[0].time_states.starts_at, 'invalid');
  assert.throws(() => prepareJobFacetCsv({ ...manifest, tenant_id: 'bad' }, good));
  assert.throws(() => prepareJobFacetCsv(manifest, good.replace('source_record_id', 'id')));
  assert.throws(() => prepareJobFacetCsv(manifest, csv('visits', [
    'v1,955,001,,,,Booked', 'v1,955,001,,,,Booked',
  ])));
  assert.throws(() => prepareJobFacetCsv(manifest, csv('visits', ['v1,955,001,"unclosed,,,'])));
});

test('CLI writes private staging once and prints only counts and input hash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'commusoft-facet-'));
  try {
    const scope = join(dir, 'scope.json'), input = join(dir, 'visits.csv'), output = join(dir, 'staging.json');
    await writeFile(scope, JSON.stringify(manifest));
    await writeFile(input, csv('visits', ['v1,955,001,2026-10-18T09:00:00Z,,,Booked']));
    const report = JSON.parse(execFileSync(process.execPath, [
      new URL('./prepare-job-facet-csv.mjs', import.meta.url).pathname,
      '--manifest', scope, '--csv', input, '--out', output,
    ], { encoding: 'utf8' }));
    assert.equal(report.counts.rows, 1);
    assert.equal(report.records, undefined);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).records[0].fields.job_code, '001');
    assert.throws(() => execFileSync(process.execPath, [
      new URL('./prepare-job-facet-csv.mjs', import.meta.url).pathname,
      '--manifest', scope, '--csv', input, '--out', output,
    ], { stdio: 'pipe' }));
    assert.throws(() => execFileSync(process.execPath, [
      new URL('./prepare-job-facet-csv.mjs', import.meta.url).pathname,
      '--manifest', scope, '--csv', input, '--out', join(process.cwd(), 'private-leak.json'),
    ], { stdio: 'pipe' }), /private_output_inside_git_checkout/);
    const alias = join(dir, 'linked-checkout');
    await symlink(process.cwd(), alias, 'dir');
    assert.throws(() => execFileSync(process.execPath, [
      new URL('./prepare-job-facet-csv.mjs', import.meta.url).pathname,
      '--manifest', scope, '--csv', input, '--out', join(alias, 'private-leak.json'),
    ], { stdio: 'pipe' }), /private_output_inside_git_checkout/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
