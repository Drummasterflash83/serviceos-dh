/** Counts-only classification of legacy Email interaction/source equality.
 * Uses bounded read-only transactions because the existing source-fields helper
 * is private to the database owner. Never prints or saves source identifiers.
 */
import assert from 'node:assert/strict';
import { savedCliToken } from './learn-test-readiness.mjs';

if (process.argv.slice(2).join(' ') !== '--live-read-only')
  throw Error('Exact LIVE read-only mode required');
const project = 'tgbnakbxwcqjeimygroz';
const tenant = '00000000-0000-0000-0000-000000000001';
const pageSize = 500;
const uuid = value => typeof value === 'string' &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
let cursor = null;
const totals = { linked: 0, missingSource: 0, exactAll: 0,
  exactExceptConnector: 0, legacyGoogleLabel: 0, campaignLinked: 0,
  partialProjectionMetadata: 0 };
let pages = 0;
while (pages < 100) {
  const after = cursor ? `and i.id>'${cursor}'::uuid` : '';
  const sql = `with ids as materialized (
 select i.id from public.interactions i
 where i.tenant_id='${tenant}'::uuid and i.source_table='email_messages'
  and i.metadata#>>'{source_projection,revision}' is null ${after}
 order by i.id limit ${pageSize}
), classified as materialized (
 select i.id,i.source_connector_id,i.metadata,
  m.id is null source_missing,
  to_jsonb(m)->>'origin_campaign_id' campaign,
  case when m.id is not null then public.learn_email_source_fields(m) end source_fields,
  to_jsonb(i) canonical
 from ids x join public.interactions i on i.id=x.id
 left join public.email_messages m on m.tenant_id=i.tenant_id and m.id=i.source_id
)
select count(*)::int linked,max(id::text) last_id,
 count(*) filter(where source_missing)::int missing_source,
 count(*) filter(where canonical @> source_fields)::int exact_all,
 count(*) filter(where canonical @> (source_fields-'source_connector_id'))::int exact_except_connector,
 count(*) filter(where source_connector_id='google-workspace')::int legacy_google_label,
 count(*) filter(where campaign is not null)::int campaign_linked,
 count(*) filter(where metadata ? 'source_projection')::int partial_projection_metadata
from classified`;
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `begin read only;set local statement_timeout='25s';${sql};rollback;`,
      read_only: false }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = String(error.message ?? '').split('\n')[0].slice(0, 160);
    throw Error(`Legacy Email read-only page HTTP ${response.status}: ${message}`);
  }
  const rows = await response.json();
  assert(Array.isArray(rows) && rows.length === 1 && rows[0],
    'Legacy Email page shape changed');
  const row = rows[0];
  for (const [key, column] of Object.entries({ linked: 'linked',
    missingSource: 'missing_source', exactAll: 'exact_all',
    exactExceptConnector: 'exact_except_connector',
    legacyGoogleLabel: 'legacy_google_label', campaignLinked: 'campaign_linked',
    partialProjectionMetadata: 'partial_projection_metadata' })) {
    assert(Number.isInteger(row[column]) && row[column] >= 0 &&
      row[column] <= pageSize, `Legacy Email count changed: ${column}`);
    totals[key] += row[column];
  }
  assert(row.linked === 0 ? row.last_id === null : uuid(row.last_id),
    'Legacy Email keyset cursor changed');
  pages++;
  if (row.linked < pageSize) break;
  assert(cursor === null || row.last_id > cursor,
    'Legacy Email keyset cursor did not advance');
  cursor = row.last_id;
}
assert(pages < 100, 'Legacy Email readback exceeded page budget');
assert(totals.exactAll <= totals.exactExceptConnector &&
  totals.exactExceptConnector <= totals.linked);
console.log(JSON.stringify({ version: 'learn-build01-email-legacy-alias-classify/1',
  observedAtUtc: new Date().toISOString(), project, tenant, pageSize, pages,
  ...totals, sourceIdsReturned: false, messageContentReturned: false,
  productionDataWrites: false,
  limitation: 'Read-only equality classification does not authorize changing retained interactions or their connector provenance.' }));
