/** Bounded read-only provider check for ten private dry-run candidate links.
 * Never logs IDs, payloads, keys, or provider errors. No source registration.
 */
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { savedCliToken } from './learn-test-readiness.mjs';

const root = resolve(import.meta.dirname, '../..');
const privateRoot = join(root, '.verification-results') + sep;
const args = Object.fromEntries(process.argv.slice(2).map((x, i, all) =>
  x.startsWith('--') ? [x.slice(2), all[i + 1]] : null).filter(Boolean));
const fail = code => { throw Error(`Ten-link spot-check stopped: ${code}`); };
const uuid = x => typeof x === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const numeric = x => typeof x === 'string' && /^[1-9][0-9]{0,15}$/.test(x);
const file = p => {
  const path = realpathSync(p ?? '');
  if (!path.startsWith(privateRoot) || (statSync(path).mode & 0o777) !== 0o600)
    fail('private_input_required');
  return path;
};
const sample = JSON.parse(readFileSync(file(args.sample), 'utf8'));
const snapshotBytes = readFileSync(file(args.snapshot));
const snapshotHash = createHash('sha256').update(snapshotBytes).digest('hex');
const project = args.project;
const ten = sample.purpose === 'ten_link';
const addendum = sample.purpose === 'category_addendum';
if ((!ten && !addendum) || !/^[a-z]{20}$/.test(project ?? '') || !uuid(sample.tenant_id) ||
  !uuid(sample.connection_id) || sample.snapshot_sha256 !== snapshotHash ||
  sample.authority_status !== 'provisional_not_apply_authorized' ||
  !Array.isArray(sample.sample) || sample.sample.length !== (ten ? 10 : 4) ||
  (ten && sample.sample.filter(x => x.shape === 'direct').length !== 5) ||
  (ten && sample.sample.filter(x => x.shape === 'workaddress').length !== 5) ||
  new Set(sample.sample.map(x => x.customer_external_id)).size !== sample.sample.length ||
  sample.sample.some(x => !numeric(x.job_external_id) ||
    !numeric(x.property_external_id) || !numeric(x.customer_external_id) ||
    !uuid(x.job_source_version_id) || !uuid(x.property_source_version_id) ||
    !uuid(x.customer_source_version_id))) fail('sample_invalid');
const output = resolve(args.out ?? '');
if (!output.startsWith(privateRoot) ||
  !realpathSync(resolve(output, '..')).startsWith(privateRoot)) fail('private_output_required');
const versions = new Map();
for (const line of snapshotBytes.toString('utf8').split(/\r?\n/)) if (line) {
  const x = JSON.parse(line);
  if (x.kind === 'source_version') versions.set(x.version_id, x);
}
if (addendum && JSON.stringify(sample.sample.map(x =>
  String(versions.get(x.customer_source_version_id)?.source?.customerType)).sort()) !==
  JSON.stringify(['3', '6', '7', '8'])) fail('category_addendum_scope_invalid');
const token = savedCliToken();
async function management(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(45000) });
  if (!r.ok) fail(`source_http_${r.status}`);
  const result = await r.json();
  if (!Array.isArray(result)) fail('source_shape');
  return result;
}
const cli = args.cli ?? 'supabase';
const cliResult = spawnSync(cli, ['projects','api-keys','--project-ref',project,'--output','json'], {
  env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: 'utf8',
  timeout: 30000, maxBuffer: 1024 * 1024 });
if (cliResult.status !== 0) fail('service_key_unavailable');
const serviceKey = JSON.parse(cliResult.stdout).find(x => x.name === 'service_role')?.api_key;
if (typeof serviceKey !== 'string' || !/^eyJ[A-Za-z0-9._-]+$/.test(serviceKey))
  fail('service_key_invalid');
async function rpc(name, payload) {
  const r = await fetch(`https://${project}.supabase.co/rest/v1/rpc/${name}`, {
    method: 'POST', redirect: 'error', headers: { apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
  if (!r.ok) fail(`${name}_http_${r.status}`);
  return r.json();
}
let providerKey = await rpc('provider_secret_read', {
  p_tenant: sample.tenant_id, p_provider: 'commusoft', p_field: 'api_key' });
if (typeof providerKey !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(providerKey))
  fail('provider_key_unavailable');
const fingerprint = createHash('sha256').update(`commusoft:${providerKey}`).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function get(kind, id) {
  const owner = randomUUID();
  let acquired = false;
  for (let n = 0; n < 8; n++) {
    const lease = await rpc('learn_commusoft_shared_lease_acquire', {
      p_fingerprint: fingerprint, p_kind: 'verification', p_owner: owner });
    if (lease?.state === 'ready') { acquired = true; break; }
    if (lease?.state !== 'wait' || !Number.isSafeInteger(lease.retryAt))
      fail('lease_invalid');
    await delay(Math.max(50, Math.min(30000, lease.retryAt - Date.now() + 100)));
  }
  if (!acquired) fail('lease_busy');
  try {
    const r = await fetch(`https://app.commusoft.co.uk/api/v2/${kind}/${id}`, {
      method: 'GET', redirect: 'error', headers: {
        Authorization: `Bearer ${providerKey}`, Accept: 'application/json',
        'User-Agent': 'OpenFolk-ServiceOS/1.0 (+https://openfolk.ai)' },
      signal: AbortSignal.timeout(30000) });
    if (!r.ok || r.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
      fail(`provider_${kind}_http_${r.status}`);
    const chunks = []; let n = 0;
    for await (const chunk of r.body) {
      n += chunk.byteLength;
      if (n > 131072) fail('provider_body_large');
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks);
    return { body: JSON.parse(raw.toString('utf8')),
      sha256: createHash('sha256').update(raw).digest('hex') };
  } finally {
    await rpc('learn_commusoft_shared_lease_release', {
      p_kind: 'verification', p_owner: owner });
  }
}
const q = x => `'${x}'`;
const ids = [
  ...sample.sample.map(x => ['jobs', x.job_external_id, x.job_source_version_id]),
  ...sample.sample.map(x => ['properties', x.property_external_id, x.property_source_version_id]),
  ...sample.sample.map(x => ['properties', x.customer_external_id, x.customer_source_version_id]),
];
const distinct = [...new Map(ids.map(([collection, externalId, versionId]) =>
  [`${collection}:${externalId}`, { collection, externalId, versionId }])).values()];
if (distinct.some(x => !versions.has(x.versionId))) fail('sample_version_missing');
const scopedIds = distinct.map(x => `(${q(x.collection)},${q(x.externalId)})`).join(',');
async function currentVersions() {
  const rows = await management(`with expected(collection,external_id) as (values ${scopedIds}), observed as (
    select v.id,v.collection,v.external_id,max(p.committed_at) committed_at
    from expected e join public.learn_business_input_versions v
     on v.collection=e.collection and v.external_id=e.external_id
    join public.learn_business_input_observations o on o.version_id=v.id
    join public.learn_business_input_pages p on p.id=o.page_id
     and (p.tenant_id,p.connection_id,p.provider,p.collection)=
       (v.tenant_id,v.connection_id,v.provider,v.collection)
    where v.tenant_id=${q(sample.tenant_id)}::uuid
      and v.connection_id=${q(sample.connection_id)}::uuid
      and v.provider='commusoft'
    group by v.id), current as (
     select observed.*,max(committed_at) over(partition by collection,external_id) latest
     from observed)
    select id::text id,collection,external_id,committed_at from current
    where committed_at=latest`);
  if (rows.length !== distinct.length || rows.some(x => !distinct.some(y =>
    y.versionId === x.id && y.collection === x.collection && y.externalId === x.external_id)))
    fail('saved_source_version_changed');
  return rows;
}
await currentVersions();
const provider = new Map();
for (const item of distinct) provider.set(`${item.collection}:${item.externalId}`,
  await get(item.collection === 'jobs' ? 'jobs' : 'properties', item.externalId));
await currentVersions();
const norm = x => String(x ?? '').trim();
const postal = x => norm(x).toUpperCase().replace(/\s+/g, '');
const results = [];
for (const [index, x] of sample.sample.entries()) {
  const jobSource = versions.get(x.job_source_version_id).source;
  const propertySource = versions.get(x.property_source_version_id).source;
  const customerSource = versions.get(x.customer_source_version_id).source;
  const job = provider.get(`jobs:${x.job_external_id}`);
  const property = provider.get(`properties:${x.property_external_id}`);
  const customer = provider.get(`properties:${x.customer_external_id}`);
  const checks = {
    job_id: norm(job.body?.id) === x.job_external_id,
    job_property: norm(job.body?.propertyID) === x.property_external_id &&
      norm(jobSource.propertyID) === x.property_external_id,
    property_id: norm(property.body?.id) === x.property_external_id,
    property_type: norm(property.body?.type) ===
      (x.shape === 'direct' ? 'customer' : 'workaddress'),
    property_postcode: postal(property.body?.postcode) === postal(propertySource.postcode),
    property_address: norm(property.body?.addressLine1) === norm(propertySource.addressLine1),
    parent_id: x.shape === 'direct' ? x.property_external_id === x.customer_external_id :
      norm(property.body?.parentPropertyID) === x.customer_external_id &&
      norm(propertySource.parentPropertyID) === x.customer_external_id,
    customer_id: norm(customer.body?.id) === x.customer_external_id,
    customer_type: norm(customer.body?.type) === 'customer',
    customer_category: norm(customer.body?.customerType) === norm(customerSource.customerType),
    customer_name: norm(customer.body?.companyName) === norm(customerSource.companyName),
    customer_postcode: postal(customer.body?.postcode) === postal(customerSource.postcode),
  };
  results.push({ ordinal: index + 1, shape: x.shape,
    checks, job_sha256: job.sha256, property_sha256: property.sha256,
    customer_sha256: customer.sha256, all_match: Object.values(checks).every(Boolean) });
}
providerKey = null;
const receipt = { version: ten ? 'new-dawn-m2-ten-link-spotcheck/1' :
  'new-dawn-m2-category-addendum/1',
  snapshot_sha256: snapshotHash, checked_at: new Date().toISOString(),
  direct: results.filter(x => x.shape === 'direct').length,
  workaddress: results.filter(x => x.shape === 'workaddress').length,
  all_match: results.every(x => x.all_match), results };
writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ checked: results.length, direct: receipt.direct,
  workaddress: receipt.workaddress, all_match: receipt.all_match,
  receipt_sha256: createHash('sha256').update(readFileSync(output)).digest('hex') }));
