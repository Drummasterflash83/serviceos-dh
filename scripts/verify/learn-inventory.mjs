/** Read-only LEARN preservation baseline. No sync, migration, fixture or storage write.
 * Credentials stay in process environment; output contains aggregate counts only.
 * Run with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VERIFY_ALLOW_PROJECT_REF,
 * VERIFY_TENANT from the existing secure verification configuration.
 */
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VERIFY_ALLOW_PROJECT_REF, VERIFY_TENANT } = process.env;
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
let origin;
try { origin = new URL(SUPABASE_URL); } catch { throw new Error('Missing Supabase configuration'); }
if (!/^[a-z0-9]{20}$/.test(VERIFY_ALLOW_PROJECT_REF ?? '') || origin.origin !== `https://${VERIFY_ALLOW_PROJECT_REF}.supabase.co` || origin.pathname !== '/' || !uuid.test(VERIFY_TENANT ?? '') || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Inventory scope not explicitly configured');
const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Prefer: 'count=exact' };
async function read(table, filters, method = 'HEAD', select = 'id') {
  const url = new URL(`/rest/v1/${table}`, origin);
  url.searchParams.set('select', select);
  url.searchParams.set(table === 'tenants' ? 'id' : 'tenant_id', `eq.${VERIFY_TENANT}`);
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
  try {
    const r = await fetch(url, { method, headers, signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (!r.ok) return { status: 'unavailable', http_status: r.status, count: null };
    const raw = r.headers.get('content-range')?.split('/')[1];
    const count = raw && /^\d+$/.test(raw) ? Number(raw) : null;
    if (method === 'GET') { const data = await r.json(); return { status: 'ok', rows: data }; }
    return { status: count === null ? 'unavailable' : 'ok', count };
  } catch { return { status: 'unavailable', count: null }; }
}
const tenant = await read('tenants', { limit: '1' }, 'GET', 'id,display_name');
if (tenant.status !== 'ok' || tenant.rows.length !== 1) throw new Error('Tenant identity could not be verified; no inventory reads performed');
const checks = [
  ['emails', 'email_messages', {}], ['calls', 'phone_calls', {}],
  ['recording_rows', 'phone_recordings', {}],
  ['recordings_with_storage_pointer', 'phone_recordings', { storage_path: 'not.is.null' }],
  ['recordings_without_storage_pointer', 'phone_recordings', { storage_path: 'is.null' }],
  ['transcripts', 'phone_transcripts', {}], ['interactions', 'interactions', {}],
  ['customers', 'customer_cards', {}], ['jobs', 'jobs', {}],
  ['team_members', 'team_members', {}], ['voicemails', 'receptionist_voicemails', {}],
];
const counts = {};
// Bounded batches avoid putting every exact-count query on the database at once.
for (let i = 0; i < checks.length; i += 3) {
  const batch = await Promise.all(checks.slice(i, i + 3).map(async ([key, table, filters]) => [key, await read(table, filters)]));
  for (const [key, result] of batch) counts[key] = result;
}
console.log(JSON.stringify({ version: 'learn-inventory/1', observed_at: new Date().toISOString(), project_ref: VERIFY_ALLOW_PROJECT_REF, tenant: tenant.rows[0], counts, limitations: ['Database rows and storage pointers do not prove playable audio or provider completeness.', 'This read creates no backup and does not test restore.', 'Unavailable tables are not zero. No provider sync or processing was started.'] }, null, 2));
