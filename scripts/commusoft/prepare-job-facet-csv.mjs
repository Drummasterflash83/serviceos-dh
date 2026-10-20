/** Local, read-only preparation of Commusoft job-facet exports. No provider or DB calls. */
import { createHash } from 'node:crypto';
import { readFile, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateOutputPath } from './lib/private-output.mjs';

export const FACET_COLUMNS = Object.freeze({
  visits: ['source_record_id', 'job_id', 'job_code', 'starts_at', 'ends_at', 'engineer_id', 'status'],
  engineers: ['source_record_id', 'display_name', 'status'],
  estimates: ['source_record_id', 'job_id', 'job_code', 'issued_at', 'status', 'amount', 'currency'],
  invoices: ['source_record_id', 'job_id', 'job_code', 'issued_at', 'status', 'amount', 'currency'],
  parts_costs: ['source_record_id', 'job_id', 'job_code', 'description', 'quantity', 'amount', 'currency'],
});
export const VISIT_COLUMNS_V2 = Object.freeze([
  ...FACET_COLUMNS.visits, 'cancelled_at', 'updated_at',
]);

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const sourceId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const jobId = /^[1-9][0-9]{0,15}$/;
const instant = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/;
const localTime = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?$/;
const maxBytes = 5 * 1024 * 1024;
const maxRows = 20_000;
const sha256 = /^[a-f0-9]{64}$/;

function visitExportScope(manifest) {
  if (manifest.facet !== 'visits') {
    if ('contract' in manifest || 'visit_export' in manifest) throw Error('visit_contract_wrong_facet');
    return null;
  }
  if (!('contract' in manifest) && !('visit_export' in manifest)) return null;
  const scope = manifest.visit_export;
  if (manifest.contract !== 'commusoft_visit_export/2' || !scope ||
      typeof scope !== 'object' || Array.isArray(scope) ||
      !sourceId.test(scope.source_account_ref) ||
      !validInstant(scope.covered_from) || !validInstant(scope.covered_to) ||
      Date.parse(scope.covered_to) <= Date.parse(scope.covered_from) ||
      Date.parse(manifest.exported_at) < Date.parse(scope.covered_to) ||
      typeof scope.source_timezone !== 'string' || !scope.source_timezone.trim() ||
      !['complete_window', 'partial_window'].includes(scope.coverage) ||
      scope.event_id_semantics !== 'event_level_appointment_id' ||
      scope.job_id_semantics !== 'v2_jobs_id' ||
      !['same_id_newer_updated_at', 'full_replacement', 'unknown'].includes(scope.correction_policy) ||
      !sha256.test(scope.field_dictionary_sha256)) throw Error('visit_export_scope_invalid');
  try { new Intl.DateTimeFormat('en', { timeZone: scope.source_timezone }); }
  catch { throw Error('visit_export_timezone_invalid'); }
  return {
    source_account_ref: scope.source_account_ref,
    covered_from: scope.covered_from,
    covered_to: scope.covered_to,
    source_timezone: scope.source_timezone,
    coverage: scope.coverage,
    event_id_semantics: scope.event_id_semantics,
    job_id_semantics: scope.job_id_semantics,
    correction_policy: scope.correction_policy,
    field_dictionary_sha256: scope.field_dictionary_sha256,
  };
}

function csvRows(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > maxBytes)
    throw Error('csv_size_invalid');
  const text = source.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], value = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else value += c;
    } else if (c === '"' && value === '' && !closed) quoted = true;
    else if (c === ',') { row.push(value); value = ''; closed = false; }
    else if (c === '\n' || c === '\r') {
      row.push(value); rows.push(row); row = []; value = ''; closed = false;
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else if (closed || c === '"') throw Error('csv_quoting_invalid');
    else value += c;
    if (value.length > 4000) throw Error('csv_cell_too_long');
    if (rows.length > maxRows) throw Error('csv_row_limit');
  }
  if (quoted) throw Error('csv_quoting_invalid');
  if (row.length || value !== '' || closed) { row.push(value); rows.push(row); }
  return rows;
}

function validCalendarTime(match) {
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.toISOString().slice(0, 10) === `${year}-${month}-${day}` &&
    Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
}
function validInstant(value) {
  const match = instant.exec(value);
  return validCalendarTime(match) &&
    (!match[7] || (Number(match[7]) <= 23 && Number(match[8]) <= 59)) &&
    Number.isFinite(Date.parse(value));
}

/** Produces local staging evidence only. A source ID is not a canonical job link. */
export function prepareJobFacetCsv(manifest, csv) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      !uuid.test(manifest.tenant_id) || !uuid.test(manifest.connection_id) ||
      manifest.source !== 'commusoft_csv' || !Object.hasOwn(FACET_COLUMNS, manifest.facet) ||
      !validInstant(manifest.exported_at)) throw Error('manifest_invalid');
  const visitExport = visitExportScope(manifest);
  const headers = visitExport ? VISIT_COLUMNS_V2 : FACET_COLUMNS[manifest.facet];
  const input = csvRows(csv);
  if (!input.length || JSON.stringify(input[0]) !== JSON.stringify(headers))
    throw Error('csv_columns_invalid');
  const seen = new Set();
  const records = [];
  for (const cells of input.slice(1)) {
    if (cells.length !== headers.length) throw Error('csv_columns_invalid');
    const fields = Object.fromEntries(headers.map((name, index) => [name, cells[index]]));
    const id = fields.source_record_id;
    if (!sourceId.test(id) || seen.has(id)) throw Error('source_record_id_invalid');
    seen.add(id);
    if ('job_code' in fields && fields.job_code.length > 100) throw Error('job_code_invalid');
    const link = manifest.facet === 'engineers'
      ? { state: 'not_applicable', job_external_id: null }
      : jobId.test(fields.job_id) && Number(fields.job_id) <= Number.MAX_SAFE_INTEGER
        ? { state: 'source_id_present', job_external_id: fields.job_id }
        : { state: 'held_missing_job_id', job_external_id: null };
    const timeFields = Object.fromEntries(
      ['starts_at', 'ends_at', 'issued_at', 'cancelled_at', 'updated_at'].filter(k => k in fields).map(k => [k,
        fields[k] === '' ? 'absent' : validInstant(fields[k]) ? 'zoned' :
          validCalendarTime(localTime.exec(fields[k])) ? 'timezone_required' : 'invalid',
      ]),
    );
    records.push({
      identity: { tenant_id: manifest.tenant_id, connection_id: manifest.connection_id,
        provider: 'commusoft_csv', facet: manifest.facet, source_record_id: id },
      exported_at: manifest.exported_at,
      link,
      time_states: timeFields,
      fields,
    });
  }
  return {
    version: visitExport ? 'commusoft-job-facet-csv/2' : 'commusoft-job-facet-csv/1',
    manifest: { tenant_id: manifest.tenant_id, connection_id: manifest.connection_id,
      source: manifest.source, facet: manifest.facet, exported_at: manifest.exported_at,
      ...(visitExport ? { contract: manifest.contract, visit_export: visitExport } : {}) },
    sha256: createHash('sha256').update(csv, 'utf8').digest('hex'),
    counts: { rows: records.length, source_id_present: records.filter(r => r.link.state === 'source_id_present').length,
      held_missing_job_id: records.filter(r => r.link.state === 'held_missing_job_id').length },
    records,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== '--manifest' || args[2] !== '--csv' || args[4] !== '--out')
    throw Error('Usage: node prepare-job-facet-csv.mjs --manifest scope.json --csv export.csv --out private-staging.json');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const manifest = JSON.parse(decoder.decode(await readFile(args[1])));
  const csv = decoder.decode(await readFile(args[3]));
  const result = prepareJobFacetCsv(manifest, csv);
  const handle = await open(await privateOutputPath(args[5]), 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(result, null, 2) + '\n'); }
  finally { await handle.close(); }
  process.stdout.write(JSON.stringify({ version: result.version, sha256: result.sha256, counts: result.counts }) + '\n');
}
