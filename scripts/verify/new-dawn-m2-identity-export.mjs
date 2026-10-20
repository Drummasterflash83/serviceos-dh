/** Private read-only LIVE snapshot through the saved Supabase CLI login.
 * No provider call, registration, canonical write, or credential logging.
 * The source page cutoff is pinned; mutable canonical/link data is fingerprinted
 * before and after paging. A changing source or canonical view discards output.
 */
import { createHash } from 'node:crypto';
import { openSync, writeSync, closeSync, unlinkSync, renameSync, statSync, realpathSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { savedCliToken } from './learn-test-readiness.mjs';
import { nextSourceCursor } from './new-dawn-m2-identity-page.mjs';

const root = resolve(import.meta.dirname, '../..');
const privateRoot = join(root, '.verification-results') + sep;
const args = Object.fromEntries(process.argv.slice(2).map((x, i, all) =>
  x.startsWith('--') ? [x.slice(2), all[i + 1]] : null).filter(Boolean));
const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const tenant = args.tenant, project = args.project;
let connection = args.connection;
if (!uuid(tenant) || !(uuid(connection) || connection === 'auto') ||
  !/^[a-z]{20}$/.test(project ?? ''))
  throw Error('A tenant, connection and project ref are required');
const output = resolve(args.out ?? '');
if (!output.startsWith(privateRoot) ||
  !realpathSync(resolve(output, '..')).startsWith(privateRoot) ||
  statSync(resolve(output, '..')).mode & 0o002)
  throw Error('Output must be under a private ignored .verification-results directory');
const quote = x => `'${String(x).replaceAll("'", "''")}'`;
const scoped = `tenant_id=${quote(tenant)}::uuid`;
const token = savedCliToken();
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw Error(`Read-only snapshot query failed: HTTP ${r.status}`);
  const rows = await r.json();
  if (!Array.isArray(rows)) throw Error('Read-only snapshot response shape changed');
  return rows;
}
if (connection === 'auto') {
  const candidates = await sql(`select id::text id from public.provider_connections
    where ${scoped} and provider='commusoft' and status='configured'
      and revoked_at is null order by id`);
  if (candidates.length !== 1 || !uuid(candidates[0].id))
    throw Error('One configured Commusoft connection is required');
  connection = candidates[0].id;
}
const connected = `${scoped} and connection_id=${quote(connection)}::uuid`;
const sourceFilter = `v.tenant_id=${quote(tenant)}::uuid and v.connection_id=${quote(connection)}::uuid
  and v.provider='commusoft' and v.collection in ('jobs','properties')`;
const hashes = {
  source: `select count(*)::int n,md5(coalesce(string_agg(
    v.id::text||':'||v.content_hash||':'||p.id::text,'' order by v.id,p.id),'')) hash
    from public.learn_business_input_versions v
    join public.learn_business_input_observations o on o.version_id=v.id
    join public.learn_business_input_pages p on p.id=o.page_id
    where ${sourceFilter} and p.committed_at <= :cutoff
      and (p.tenant_id,p.connection_id,p.provider,p.collection)=
        (v.tenant_id,v.connection_id,v.provider,v.collection)`,
  canonical: `with x as (
    select 'person:'||id::text key,coalesce(display_name,'')||'|'||coalesce(postcode,'') value
      from public.people where ${scoped}
    union all select 'company:'||id::text,coalesce(name,'')||'|'||coalesce(postcode,'')
      from public.companies where ${scoped}
    union all select 'site:'||id::text,coalesce(source_system,'')||'|'||coalesce(external_id,'')||'|'||coalesce(postcode,'')
      from public.sites where ${scoped}
    union all select 'job:'||id::text,coalesce(source_system,'')||'|'||coalesce(external_id,'')
      from public.jobs where ${scoped})
    select count(*)::int n,md5(coalesce(string_agg(key||':'||value,'' order by key),'')) hash from x`,
  links: `with x as (
    select 'source:'||l.id::text key,l.collection||'|'||l.external_id||'|'||l.entity_kind||'|'||
      case when cl.id is null then '0' else '1' end value
      from public.learn_business_input_links l
      left join public.learn_business_input_current_links cl on cl.id=l.id
      where l.tenant_id=${quote(tenant)}::uuid and l.connection_id=${quote(connection)}::uuid
       and l.provider='commusoft'
    union all select 'legacy:'||id::text,entity_kind||'|'||external_id
      from public.import_entity_links where ${scoped} and source_system='commusoft')
    select count(*)::int n,md5(coalesce(string_agg(key||':'||value,'' order by key),'')) hash from x`,
};
async function fingerprint(cutoff) {
  const result = {};
  for (const [key, template] of Object.entries(hashes)) {
    const rows = await sql(template.replaceAll(':cutoff', quote(cutoff) + '::timestamptz'));
    if (rows.length !== 1 || !/^[a-f0-9]{32}$/.test(rows[0].hash))
      throw Error('Snapshot fingerprint unavailable');
    result[key] = rows[0];
  }
  return result;
}
const cutoffRows = await sql(`select max(committed_at) cutoff from public.learn_business_input_pages
  where ${connected} and provider='commusoft' and collection in ('jobs','properties')`);
const cutoff = cutoffRows[0]?.cutoff;
if (cutoffRows.length !== 1 || !Number.isFinite(Date.parse(cutoff)))
  throw Error('No committed source cutoff');
const baseline = await fingerprint(cutoff);
const fd = openSync(output + '.partial', 'wx', 0o600);
let bytes = 0, sourceRows = 0, otherRows = 0;
const snapshotDigest = createHash('sha256');
function emit(row) {
  const line = JSON.stringify(row) + '\n';
  bytes += Buffer.byteLength(line);
  if (bytes > 128 * 1024 * 1024) throw Error('Private snapshot size ceiling exceeded');
  snapshotDigest.update(line);
  writeSync(fd, line);
}
async function page(table, filter, fields, kind) {
  let cursor = null;
  for (;;) {
    const after = cursor ? ` and id > ${quote(cursor)}::uuid` : '';
    const rows = await sql(`select id::text cursor,jsonb_build_object('kind',${quote(kind)},${fields}) row
      from public.${table} where ${filter}${after} order by id limit 500`);
    if (!rows.length) break;
    if (rows.length > 500 || rows.some(x => !uuid(x.cursor) || !x.row))
      throw Error('Paged snapshot response invalid');
    for (const x of rows) { emit(x.row); otherRows++; }
    cursor = rows.at(-1).cursor;
    if (rows.length < 500) break;
  }
}
try {
  emit({ kind: 'scope', tenant_id: tenant, connection_id: connection,
    cutoff_committed_at: cutoff });
  let cursor = null;
  for (;;) {
    const after = cursor ? `and (v.collection,v.external_id) > (${quote(cursor.collection)},${quote(cursor.external_id)})` : '';
    const rows = await sql(`with keys as (
      select distinct v.collection,v.external_id from public.learn_business_input_versions v
      join public.learn_business_input_observations o on o.version_id=v.id
      join public.learn_business_input_pages p on p.id=o.page_id
      where ${sourceFilter} and p.committed_at <= ${quote(cutoff)}::timestamptz ${after}
       and (p.tenant_id,p.connection_id,p.provider,p.collection)=
         (v.tenant_id,v.connection_id,v.provider,v.collection)
      order by v.collection,v.external_id limit 200
    ), latest as (
      select v.collection,v.external_id,v.id version_id,v.payload,
        max(p.committed_at) committed_at
      from keys k join public.learn_business_input_versions v
        on v.collection=k.collection and v.external_id=k.external_id
      join public.learn_business_input_observations o on o.version_id=v.id
      join public.learn_business_input_pages p on p.id=o.page_id
      where ${sourceFilter} and p.committed_at <= ${quote(cutoff)}::timestamptz
       and (p.tenant_id,p.connection_id,p.provider,p.collection)=
         (v.tenant_id,v.connection_id,v.provider,v.collection)
      group by v.collection,v.external_id,v.id,v.payload
    ), ranked as (
      select latest.*,max(committed_at) over(partition by collection,external_id) newest from latest
    ) select collection,external_id,version_id,committed_at,
      jsonb_build_object('id',payload->'id','type',payload->'type',
       'customerType',payload->'customerType','companyName',payload->'companyName',
       'firstName',payload->'contact'->'firstName',
       'lastName',payload->'contact'->'lastName',
       'addressLine1',payload->'addressLine1','postcode',payload->'postcode',
       'parentPropertyID',payload->'parentPropertyID','propertyID',payload->'propertyID') source
      from ranked where committed_at=newest order by collection,external_id,version_id`);
    if (!rows.length) break;
    if (rows.length > 400 || rows.some(x => !uuid(x.version_id) ||
      !['jobs','properties'].includes(x.collection) || !x.external_id))
      throw Error('Source page invalid');
    for (const x of rows) {
      emit({ kind: 'source_version', collection: x.collection, external_id: x.external_id,
        version_id: x.version_id, source: x.source });
      emit({ kind: 'source_observation', collection: x.collection,
        external_id: x.external_id, version_id: x.version_id,
        committed_at: x.committed_at });
      sourceRows++;
    }
    cursor = nextSourceCursor(rows, cursor);
    if (rows.length < 200) break;
  }
  await page('people', scoped, "'name',display_name,'postcode',postcode", 'person');
  await page('companies', scoped, "'name',name,'postcode',postcode", 'company');
  await page('sites', scoped,
    "'source_system',source_system,'external_id',external_id,'postcode',postcode", 'site');
  await page('jobs', scoped, "'source_system',source_system,'external_id',external_id", 'job');
  await page('learn_business_input_links', `${connected} and provider='commusoft'`,
    "'collection',collection,'external_id',external_id,'entity_kind',entity_kind," +
    "'current',exists(select 1 from public.learn_business_input_current_links cl where cl.id=learn_business_input_links.id)", 'link');
  await page('import_entity_links', `${scoped} and source_system='commusoft'`,
    "'entity_kind',entity_kind,'external_id',external_id", 'legacy_link');
  const final = await fingerprint(cutoff);
  if (JSON.stringify(final) !== JSON.stringify(baseline))
    throw Error('Saved source, canonical or link state changed during snapshot');
  emit({ kind: 'end', tenant_id: tenant, connection_id: connection,
    cutoff_committed_at: cutoff });
  closeSync(fd);
  renameSync(output + '.partial', output);
  console.log(JSON.stringify({ source_rows: sourceRows, other_rows: otherRows,
    bytes, cutoff_committed_at: cutoff,
    snapshot_sha256: snapshotDigest.digest('hex') }));
} catch (error) {
  closeSync(fd);
  unlinkSync(output + '.partial');
  throw error;
}
