// Offline, read-only trace of package ownership contradictions into sealed sources.
// Prints aggregate evidence only. This does not validate or repair an import.
// Usage: node scripts/commusoft/trace-site-ownership.mjs PACKAGE SOURCE_DIR CURRENT_WINDOW_JSON
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalContractPayload, parseCsv, REQUIRED_FILES} from './lib/package-contract.mjs';
import {
  parseHtmlTable, corroborationPairs, buildCorroboration, fromJsonWindow,
  classifyCurrentWindowGap, indexSiteCustomers,
} from './lib/prepare-canonical-core.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const requireEvidence = (condition, code) => { if (!condition) throw new Error(code); };

function trace() {
  const [packageDir, sourceDir, currentWindowPath, extra] = process.argv.slice(2);
  requireEvidence(packageDir && sourceDir && currentWindowPath && !extra, 'three_paths_required');
  const manifest = JSON.parse(readFileSync(join(packageDir, 'commusoft_canonical.manifest.json'), 'utf8'));
  requireEvidence(manifest.package_version === 4, 'package_version_unexpected');
  requireEvidence(sha(canonicalContractPayload(manifest)) === manifest.contract_seal, 'manifest_seal_mismatch');
  const records = {};
  const hashes = {};
  for (const [file, spec] of Object.entries(REQUIRED_FILES)) {
    const bytes = readFileSync(join(packageDir, file));
    requireEvidence(sha(bytes) === manifest.output?.[file]?.sha256, 'output_seal_mismatch');
    const [header, ...rows] = parseCsv(bytes.toString('utf8'));
    requireEvidence(JSON.stringify(header) === JSON.stringify(spec.columns), 'output_schema_mismatch');
    requireEvidence(rows.length === manifest.output[file].rows && rows.every(row => row.length === header.length), 'output_rows_mismatch');
    records[spec.entity] = rows.map(row => Object.fromEntries(header.map((key, i) => [key, row[i]])));
    hashes[file] = sha(bytes);
  }
  const owners = indexSiteCustomers(records.sites);
  const mismatches = records.jobs.filter(job => job.site_external_id && owners.has(job.site_external_id) &&
    owners.get(job.site_external_id) !== job.customer_external_id);
  const byJob = new Map(mismatches.map(job => [job.external_id, job]));
  const specs = [
    ['purchase_orders', 'purchase_orders_all_time_enhanced_generated_2026-08-04.xls', 'Job Number'],
    ['parts', 'parts_all_time_enhanced_generated_2026-08-04.xls', 'Job Number'],
    ['additional_works', 'additional_works_all_time_generated_2026-08-04.xls', 'Job No'],
    ['further_works', 'further_works_open_tasks_generated_2026-08-04.xls', 'Job or Estimate no', 'Type :'],
    ['diary_events', 'diary_events_2026-05-01_to_2026-08-04_enhanced.xls', 'Record number', 'Type of Event'],
  ];
  const pairLists = [];
  const sources = {};
  for (const [key, file, jobCol, typeCol] of specs) {
    const bytes = readFileSync(join(sourceDir, file));
    const sourceHash = sha(bytes);
    requireEvidence(sourceHash === manifest.sources?.[key]?.sha256 && bytes.length === manifest.sources[key].bytes, 'supporting_source_seal_mismatch');
    const pairs = corroborationPairs(parseHtmlTable(bytes.toString('utf8'), jobCol), {
      jobCol, customerCol: 'Customer Account Number', workAddressCol: 'WorkAddress Account Number',
      ...(typeCol ? {typeCol, typeIs: 'job'} : {}),
    }, key);
    pairLists.push(pairs);
    const matching = pairs.filter(pair => byJob.has(pair.job));
    sources[key] = {
      sha256: sourceHash, sealVerified: true, matchingRows: matching.length,
      matchingJobCustomer: matching.filter(pair => pair.customer === byJob.get(pair.job).customer_external_id).length,
      matchingDisputedSite: matching.filter(pair => pair.workAddress === byJob.get(pair.job).site_external_id).length,
      differentCustomer: matching.filter(pair => pair.customer && pair.customer !== byJob.get(pair.job).customer_external_id).length,
      differentSite: matching.filter(pair => pair.workAddress && pair.workAddress !== byJob.get(pair.job).site_external_id).length,
    };
  }
  const windowBytes = readFileSync(currentWindowPath);
  requireEvidence(sha(windowBytes) === manifest.sources?.profit_by_job_current_window?.sha256, 'current_window_seal_mismatch');
  const result = classifyCurrentWindowGap({
    unmatchedIds: [...byJob.keys()],
    profitWindow: fromJsonWindow(JSON.parse(windowBytes.toString('utf8'))),
    customerIds: new Set(records.customers.map(row => row.external_id)),
    siteCustomers: owners, corroboration: buildCorroboration(pairLists), windowLabel: 'sealed_current_window',
  });
  console.log(JSON.stringify({
    version: 'learn-commusoft-ownership-trace/1', observedAt: new Date().toISOString(),
    packageManifestSeal: manifest.contract_seal, packageOutputHashes: hashes,
    packageRows: Object.fromEntries(Object.entries(records).map(([entity, rows]) => [entity, rows.length])),
    ownershipContradictions: mismatches.length, sources,
    currentWindowSha256: sha(windowBytes),
    guardedReconstruction: {counts: result.counts, provenance: result.provenance, classified: result.classified, emittedRows: result.reconstructable.length},
    sourceWrites: 0, imports: 0, networkCalls: 0,
    limitations: [
      'This traces contradictions; it does not repair or approve the package.',
      'Source seals establish retained-byte consistency, not live provider truth.',
      'Customer and site master provenance remains locally sealed recovered export.',
      'Only the five supporting files named here were used; other diary windows were not incorporated.',
    ],
  }, null, 2));
}

try { trace(); } catch {
  // Even filesystem and parser failures must not dump private content or paths.
  console.error('REFUSED: ownership trace could not verify its arguments, source seals or schema.');
  process.exitCode = 1;
}
