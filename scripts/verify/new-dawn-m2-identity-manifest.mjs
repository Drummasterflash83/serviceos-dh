/** Offline, read-only classifier of a complete private Commusoft snapshot.
 * Outputs exact-version registration manifests only in ignored mode-0600 files.
 * No Supabase/API call, registration, provider request or canonical write.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, statSync, realpathSync } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const privateRoot = join(root, '.verification-results') + sep;
const args = Object.fromEntries(process.argv.slice(2).map((x, i, all) =>
  x.startsWith('--') ? [x.slice(2), all[i + 1]] : null).filter(Boolean));
const fail = reason => { throw Error(`Private manifest build stopped: ${reason}`); };
const uuid = x => typeof x === 'string' &&
  /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const numeric = x => typeof x === 'string' && /^[1-9][0-9]{0,15}$/.test(x);
const text = x => typeof x === 'string' ? x.trim() : '';
const postcode = x => text(x).toUpperCase().replace(/\s+/g, '');
const name = x => text(x).toLowerCase().replace(/\s+/g, ' ');
const sha = x => createHash('sha256').update(x).digest('hex');
const sortIds = (a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
function privateFile(path) {
  if (!path) fail('snapshot, kind-map and output paths are required');
  const p = realpathSync(path);
  if (!p.startsWith(privateRoot) || (statSync(p).mode & 0o777) !== 0o600)
    fail('inputs must be mode-0600 files under ignored .verification-results');
  return p;
}
const snapshotPath = privateFile(args.snapshot);
const kindPath = privateFile(args['kind-map']);
const out = resolve(args.out ?? '');
if (!out.startsWith(privateRoot) || out === privateRoot.slice(0, -1) ||
  !realpathSync(dirname(out)).startsWith(privateRoot))
  fail('output must be a new directory under ignored .verification-results');
const tenant = args.tenant;
let connection = args.connection;
if (!uuid(tenant) || !(uuid(connection) || connection === 'auto'))
  fail('tenant UUID and exact or snapshot connection required');
const raw = readFileSync(snapshotPath);
const snapshotHash = sha(raw);
const kindDoc = JSON.parse(readFileSync(kindPath, 'utf8'));
const kindMap = kindDoc.kind_map;
const mapStatus = kindDoc.status;
if (!['reviewed_for_registration', 'provisional_not_apply_authorized'].includes(mapStatus))
  fail('category map must declare reviewed or provisional authority status');
if (!kindMap || typeof kindMap !== 'object' || Array.isArray(kindMap) ||
  !/^[0-9a-f]{64}$/.test(kindDoc.kind_evidence_sha256 ?? '') ||
  !Object.entries(kindMap).length || Object.entries(kindMap).some(([k, v]) =>
    !/^[1-9][0-9]{0,8}$/.test(k) || !['person', 'company'].includes(v)))
  fail('reviewed category map and SHA-256 evidence are required');

const versions = new Map(), observed = new Map();
const existingNames = new Set(), existingPostcodes = new Set();
const sitePostcodes = new Set(), siteIds = new Set(), jobIds = new Set();
const sourceLinks = new Set(), currentLinks = new Set(), legacyLinks = new Set();
let scope = 0, end = 0, lines = 0, sourceVersions = 0, observations = 0;
for (const line of raw.toString('utf8').split(/\r?\n/)) {
  if (!line) continue;
  lines++;
  let row;
  try { row = JSON.parse(line); } catch { fail('snapshot is not complete JSONL'); }
  if (row.kind === 'scope') {
    scope++;
    if (connection === 'auto' && uuid(row.connection_id)) connection = row.connection_id;
    if (row.tenant_id !== tenant || row.connection_id !== connection)
      fail('snapshot scope differs');
  } else if (row.kind === 'end') {
    end++;
    if (row.tenant_id !== tenant || row.connection_id !== connection)
      fail('snapshot completion scope differs');
  } else if (row.kind === 'source_version') {
    if (!['jobs', 'properties'].includes(row.collection) ||
      typeof row.external_id !== 'string' || !uuid(row.version_id))
      fail('saved source identity invalid');
    const key = `${row.collection}:${row.external_id}`;
    if (!versions.has(key)) versions.set(key, new Map());
    versions.get(key).set(row.version_id, row.source);
    sourceVersions++;
  } else if (row.kind === 'source_observation') {
    const key = `${row.collection}:${row.external_id}`;
    const time = Date.parse(row.committed_at);
    if (!Number.isFinite(time) || !uuid(row.version_id)) fail('source observation invalid');
    const prior = observed.get(key);
    if (!prior || time > prior.time) observed.set(key, { time, ids: new Set([row.version_id]) });
    else if (time === prior.time) prior.ids.add(row.version_id);
    observations++;
  } else if (row.kind === 'person' || row.kind === 'company') {
    existingNames.add(name(row.name));
    existingPostcodes.add(postcode(row.postcode));
  } else if (row.kind === 'site') {
    sitePostcodes.add(postcode(row.postcode));
    if (['commusoft', `commusoft:connection:${connection}`].includes(row.source_system))
      siteIds.add(row.external_id);
  } else if (row.kind === 'job') {
    if (['commusoft', `commusoft:connection:${connection}`].includes(row.source_system))
      jobIds.add(row.external_id);
  } else if (row.kind === 'link') {
    sourceLinks.add(`${row.collection}:${row.external_id}`);
    if (row.current === true && row.collection === 'jobs' && row.entity_kind === 'job')
      currentLinks.add(row.external_id);
  } else if (row.kind === 'legacy_link') {
    legacyLinks.add(`${row.entity_kind}:${row.external_id}`);
  } else fail('unexpected private snapshot row');
}
if (scope !== 1 || end !== 1 || lines < 3)
  fail('snapshot scope, completion marker or rows missing');
if (!sourceVersions || !observations ||
  ![...versions.keys()].some(k => k.startsWith('jobs:')) ||
  ![...versions.keys()].some(k => k.startsWith('properties:')))
  fail('saved jobs, properties or observations missing');
function current(collection, id) {
  const key = `${collection}:${id}`, o = observed.get(key), v = versions.get(key);
  if (!v || !o || o.ids.size !== 1) return { reason: 'source_missing_or_ambiguous' };
  const versionId = [...o.ids][0], source = v.get(versionId);
  if (!source || String(source.id) !== id) return { reason: 'source_identity_conflict' };
  return { versionId, source };
}
const jobKeys = [...versions.keys()].filter(k => k.startsWith('jobs:'))
  .map(k => k.slice(5)).sort((a, b) => numeric(a) && numeric(b) ? sortIds(a, b) :
    a.localeCompare(b));
const groups = new Map(), jobHolds = new Map(), alreadyLinked = new Set();
const openStatuses = new Map();
for (const jobId of jobKeys) {
  if (!numeric(jobId)) { jobHolds.set(jobId, 'job_identity_invalid'); continue; }
  const latest = current('jobs', jobId);
  if (!latest.reason) {
    const status = latest.source.status;
    if (status === 'on_hold' || status === 'pending' ||
      status === 'Open' || status === 'ongoing')
      openStatuses.set(jobId, status === 'ongoing' ? 'Open' : status);
  }
  if (currentLinks.has(jobId)) { alreadyLinked.add(jobId); continue; }
  if (sourceLinks.has(`jobs:${jobId}`)) {
    jobHolds.set(jobId, 'retained_reversed_link_review'); continue;
  }
  const j = current('jobs', jobId);
  if (j.reason) { jobHolds.set(jobId, `job_${j.reason}`); continue; }
  const propertyId = String(j.source.propertyID ?? '');
  if (!numeric(propertyId)) { jobHolds.set(jobId, 'property_reference_invalid'); continue; }
  const p = current('properties', propertyId);
  if (p.reason) { jobHolds.set(jobId, `property_${p.reason}`); continue; }
  const shape = p.source.type === 'workaddress' ? 'workaddress' :
    p.source.type === 'customer' ? 'direct' : null;
  if (!shape) { jobHolds.set(jobId, 'property_kind_unsupported'); continue; }
  const customerId = shape === 'direct' ? propertyId :
    String(p.source.parentPropertyID ?? '');
  if (!numeric(customerId) || (shape === 'workaddress' && customerId === propertyId)) {
    jobHolds.set(jobId, 'customer_reference_invalid'); continue;
  }
  const c = current('properties', customerId);
  if (c.reason || c.source?.type !== 'customer') {
    jobHolds.set(jobId, 'customer_source_missing_or_ambiguous'); continue;
  }
  if (!groups.has(customerId)) groups.set(customerId, { customer: c, sites: new Map(), jobs: [] });
  const group = groups.get(customerId);
  group.sites.set(propertyId, { ...p, shape });
  group.jobs.push({ id: jobId, ...j, propertyId, shape });
}

const candidateGroups = [], heldGroups = [];
for (const [customerId, g] of [...groups].sort((a, b) => sortIds(a[0], b[0]))) {
  const c = g.customer.source, category = String(c.customerType ?? '');
  let reason = '';
  if (!kindMap[category]) reason = 'customer_kind_unreviewed';
  else if (kindMap[category] === 'person') reason = 'account_holder_review_required';
  else if (!text(c.companyName)) reason = 'company_name_missing';
  else if (!postcode(c.postcode)) reason = 'customer_postcode_missing';
  else if (existingNames.has(name(c.companyName)) ||
    existingPostcodes.has(postcode(c.postcode))) reason = 'customer_duplicate_or_conflict';
  else if (sourceLinks.has(`properties:${customerId}`) ||
    legacyLinks.has(`customer:${customerId}`)) reason = 'customer_identity_conflict';
  const siteCodes = new Set();
  for (const [siteId, s] of g.sites) {
    const code = postcode(s.source.postcode);
    if (!reason && (!text(s.source.addressLine1) || !code)) reason = 'site_address_missing';
    if (!reason && (sitePostcodes.has(code) || siteCodes.has(code))) reason = 'site_postcode_collision';
    if (!reason && (siteIds.has(siteId) || legacyLinks.has(`site:${siteId}`) ||
      (s.shape === 'workaddress' && sourceLinks.has(`properties:${siteId}`))))
      reason = 'site_identity_conflict';
    siteCodes.add(code);
  }
  if (!reason && g.jobs.some(j => jobIds.has(j.id) ||
    sourceLinks.has(`jobs:${j.id}`) || legacyLinks.has(`job:${j.id}`)))
    reason = 'job_identity_conflict';
  if (!reason && 1 + g.sites.size + g.jobs.length > 500) reason = 'group_over_limit';
  const entry = { customerId, ...g, reason, siteCodes };
  (reason ? heldGroups : candidateGroups).push(entry);
}
// Compare proposed identities against every saved source property, including
// groups without a job or already held. Multiple versions of one ID count once.
const allCustomerNames = new Map(), allCustomerPostcodes = new Map();
const allSitePostcodes = new Map();
function claim(map, key, id) {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(id);
}
for (const [key, byVersion] of versions) if (key.startsWith('properties:')) {
  const propertyId = key.slice('properties:'.length);
  for (const source of byVersion.values()) {
    if (!source || !['customer', 'workaddress'].includes(source.type)) continue;
    claim(allSitePostcodes, postcode(source.postcode), propertyId);
    if (source.type === 'customer') {
      claim(allCustomerNames, name(source.companyName), propertyId);
      claim(allCustomerPostcodes, postcode(source.postcode), propertyId);
    }
  }
}
for (const g of [...candidateGroups]) if (
  (allCustomerNames.get(name(g.customer.source.companyName))?.size ?? 0) > 1 ||
  (allCustomerPostcodes.get(postcode(g.customer.source.postcode))?.size ?? 0) > 1) {
  g.reason = 'customer_source_collision';
  heldGroups.push(g);
  candidateGroups.splice(candidateGroups.indexOf(g), 1);
}
for (const g of [...candidateGroups]) if ([...g.sites].some(([id, s]) =>
  [...(allSitePostcodes.get(postcode(s.source.postcode)) ?? [])].some(other => other !== id))) {
  g.reason = 'site_source_collision';
  heldGroups.push(g);
  candidateGroups.splice(candidateGroups.indexOf(g), 1);
}
for (const g of heldGroups) for (const j of g.jobs) jobHolds.set(j.id, g.reason);
const cleanJobs = candidateGroups.reduce((n, g) => n + g.jobs.length, 0);
if (cleanJobs + jobHolds.size + alreadyLinked.size !== jobKeys.length)
  fail('job accounting incomplete');
const cleanJobIds = new Set(candidateGroups.flatMap(g => g.jobs.map(j => j.id)));
const openClasses = {};
const openByStatus = {};
let openLinked = 0, openClean = 0, openHeld = 0;
for (const [jobId, status] of openStatuses) {
  openByStatus[status] ??= { linked: 0, clean: 0, held: 0 };
  if (alreadyLinked.has(jobId)) { openLinked++; openByStatus[status].linked++; }
  else if (cleanJobIds.has(jobId)) { openClean++; openByStatus[status].clean++; }
  else {
    openHeld++; openByStatus[status].held++;
    const reason = jobHolds.get(jobId);
    if (!reason) fail('open job classification incomplete');
    openClasses[reason] = (openClasses[reason] ?? 0) + 1;
  }
}

mkdirSync(out, { mode: 0o700 });
const batches = [];
let next = [], groupCount = 0;
function flush() {
  if (!next.length) return;
  if (mapStatus === 'provisional_not_apply_authorized') {
    next = []; groupCount = 0; return;
  }
  const items = [
    ...next.map(g => ({ kind: 'customer', shape: 'customer', external_id: g.customerId,
      source_version_id: g.customer.versionId, customer_external_id: null,
      property_external_id: null, customer_kind: 'company' })),
    ...next.flatMap(g => [...g.sites].sort((a, b) => sortIds(a[0], b[0])).map(([id, s]) =>
      ({ kind: 'site', shape: s.shape, external_id: id,
        source_version_id: s.versionId, customer_external_id: g.customerId,
        property_external_id: null, customer_kind: null }))),
    ...next.flatMap(g => g.jobs.sort((a, b) => sortIds(a.id, b.id)).map(j =>
      ({ kind: 'job', shape: j.shape, external_id: j.id,
        source_version_id: j.versionId, customer_external_id: g.customerId,
        property_external_id: j.propertyId, customer_kind: null }))),
  ];
  const manifest = { batch_id: randomUUID(), tenant_id: tenant,
    connection_id: connection, kind_map: kindMap,
    kind_evidence_sha256: kindDoc.kind_evidence_sha256,
    reason: `Reviewed staged exact-ID company batch from snapshot ${snapshotHash.slice(0, 16)}`,
    items };
  const filename = `manifest-${String(batches.length + 1).padStart(4, '0')}.json`;
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(out, filename), bytes, { flag: 'wx', mode: 0o600 });
  batches.push({ file: filename, sha256: sha(bytes), customers: next.length,
    sites: items.filter(i => i.kind === 'site').length,
    jobs: items.filter(i => i.kind === 'job').length });
  next = []; groupCount = 0;
}
for (const g of candidateGroups) {
  const size = 1 + g.sites.size + g.jobs.length;
  if (groupCount + size > 2000) flush();
  next.push(g); groupCount += size;
}
flush();
const classCounts = new Map();
for (const reason of jobHolds.values()) {
  if (!classCounts.has(reason)) classCounts.set(reason, { customers: 0, sites: 0, jobs: 0 });
  classCounts.get(reason).jobs++;
}
for (const g of heldGroups) {
  const count = classCounts.get(g.reason);
  count.customers++;
  count.sites += g.sites.size;
}
const classes = Object.fromEntries([...classCounts].sort(([a], [b]) => a.localeCompare(b)));
const byCategory = {};
for (const g of candidateGroups) {
  const category = String(g.customer.source.customerType);
  byCategory[category] ??= { customers: 0, sites: 0, jobs: 0 };
  byCategory[category].customers++;
  byCategory[category].sites += g.sites.size;
  byCategory[category].jobs += g.jobs.length;
}
const report = { version: 'new-dawn-m2-identity-dry-run/1',
  authority_status: mapStatus,
  snapshot_sha256: snapshotHash, source_version_rows: sourceVersions,
  observation_rows: observations, source_job_count: jobKeys.length,
  already_linked_jobs: alreadyLinked.size,
  unlinked_source_job_count: jobKeys.length - alreadyLinked.size,
  clean: { customers: candidateGroups.length,
    sites: candidateGroups.reduce((n, g) => n + g.sites.size, 0), jobs: cleanJobs,
    by_category: byCategory },
  held: { jobs: jobHolds.size, classes }, manifest_count: batches.length, batches };
report.open = { total: openStatuses.size, already_linked: openLinked,
  clean: openClean, held: openHeld, by_status: openByStatus,
  held_classes: Object.fromEntries(Object.entries(openClasses).sort(([a], [b]) =>
    a.localeCompare(b))) };
if (report.open.total !== openLinked + openClean + openHeld)
  fail('open job accounting incomplete');
writeFileSync(join(out, 'aggregate.json'), JSON.stringify(report, null, 2) + '\n',
  { flag: 'wx', mode: 0o600 });
const sample = [], usedCustomers = new Set();
for (const shape of ['direct', 'workaddress']) for (const g of candidateGroups) {
  if (sample.filter(x => x.shape === shape).length >= 5) break;
  if (usedCustomers.has(g.customerId)) continue;
  const job = g.jobs.find(x => x.shape === shape);
  if (!job) continue;
  const property = g.sites.get(job.propertyId);
  sample.push({ shape, customer_external_id: g.customerId,
    customer_source_version_id: g.customer.versionId,
    property_external_id: job.propertyId,
    property_source_version_id: property.versionId,
    job_external_id: job.id, job_source_version_id: job.versionId });
  usedCustomers.add(g.customerId);
}
if (sample.length === 10)
  writeFileSync(join(out, 'spotcheck-candidates.json'),
    JSON.stringify({ purpose: 'ten_link', authority_status: mapStatus, tenant_id: tenant,
      connection_id: connection, snapshot_sha256: snapshotHash, sample }, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
const addendum = [];
for (const category of ['3', '6', '7', '8']) {
  const g = candidateGroups.find(x => String(x.customer.source.customerType) === category);
  const job = g?.jobs[0];
  if (!g || !job) continue;
  const property = g.sites.get(job.propertyId);
  addendum.push({ shape: job.shape, customer_external_id: g.customerId,
    customer_source_version_id: g.customer.versionId,
    property_external_id: job.propertyId,
    property_source_version_id: property.versionId,
    job_external_id: job.id, job_source_version_id: job.versionId });
}
if (addendum.length === 4)
  writeFileSync(join(out, 'category-addendum-candidates.json'),
    JSON.stringify({ purpose: 'category_addendum', authority_status: mapStatus,
      tenant_id: tenant, connection_id: connection,
      snapshot_sha256: snapshotHash, sample: addendum }, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ source_job_count: report.source_job_count,
  already_linked_jobs: report.already_linked_jobs,
  unlinked_source_job_count: report.unlinked_source_job_count,
  clean: report.clean, held: report.held, open: report.open,
  manifest_count: report.manifest_count,
  snapshot_sha256: snapshotHash }));
