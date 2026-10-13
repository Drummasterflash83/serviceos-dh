// Exact compiled handlers, isolated synthetic Auth/PostgREST. This proves caller
// admission and tenant binding, not the hosted JWT gateway or provider processing.
const { endpoints } = JSON.parse(await Deno.readTextFile('/probe/config.json'));
const tenant = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const actor = '33333333-3333-4333-8333-333333333333';
const record = '44444444-4444-4444-8444-444444444444';
const jobId = '55555555-5555-4555-8555-555555555555';
const service = 'synthetic-service-caller-credential';
const user = 'synthetic-verified-user-credential';
let endpoint = '', scenario = '', requests: any[] = [], violations: string[] = [], job: any;
const json = (v: unknown, status = 200) => Response.json(v, { status });
async function database(req: Request) {
  const u = new URL(req.url); let body: any; try { body = await req.json(); } catch {}
  requests.push({ method: req.method, path: u.pathname, query: u.search, body });
  const bearer = req.headers.get('authorization');
  if (u.pathname === '/auth/v1/user') {
    return bearer === 'Bearer ' + user ? json({ id: actor, email: 'actor@example.invalid' }) : json({ message: 'Invalid JWT' }, 401);
  }
  if (u.pathname === '/rest/v1/receptionist_voicemails') {
    if (bearer !== 'Bearer ' + user || u.searchParams.get('tenant_id') !== 'eq.' + tenant || u.searchParams.get('id') !== 'eq.' + record) violations.push('voicemail_rls_scope');
    return json(null);
  }
  if (bearer !== 'Bearer ' + service || req.headers.get('apikey') !== service) violations.push('database_auth');
  if (u.pathname === '/rest/v1/profiles') {
    if (u.searchParams.get('id') !== 'eq.' + actor) violations.push('profile_binding');
    return json({ tenant_id: tenant, role: scenario === 'viewer' ? 'viewer' : 'admin', email: 'actor@example.invalid' });
  }
  if (u.pathname === '/rest/v1/rpc/learn_capture_admission') {
    if (body.p_tenant !== tenant || body.p_source !== 'phone') violations.push('capture_binding');
    return json({ version: 'learn-capture-admission/1', tenant_id: tenant, source: 'phone', allowed: false, checked_at: new Date().toISOString() });
  }
  if (u.pathname === '/rest/v1/rpc/learn_email_enqueue') {
    if (body.p_tenant !== tenant || body.p_account !== record || body.p_type !== 'email.gmail_sync') violations.push('email_binding');
    return json({ version: 'learn-email-enqueue/1', success: true, state: 'queued', provider: 'gmail', email_account_id: record, job_id: jobId, duplicate: false });
  }
  if (u.pathname === '/rest/v1/platform_jobs') {
    if (req.method === 'POST') {
      if (body.tenant_id !== tenant || body.created_by !== (scenario === 'service' ? null : actor)) violations.push('job_actor_binding');
      job = { ...body, id: jobId };
      if (endpoint === 'phone-process-pending') return json({ code: '23505', message: 'existing active job' }, 409);
      return json({ id: jobId }, 201);
    }
    if (req.method === 'PATCH') return json(null);
    if (u.searchParams.get('tenant_id') !== 'eq.' + tenant) violations.push('job_read_binding');
    return json(endpoint === 'phone-process-pending' ? [{ id: jobId }] : job);
  }
  if (u.pathname === '/rest/v1/view_as_context') return json(null);
  if (['phone_recordings', 'phone_transcripts', 'intelligence_objects', 'customer_cards'].some(t => u.pathname === '/rest/v1/' + t)) {
    if (u.searchParams.get('tenant_id') !== 'eq.' + tenant) violations.push('record_tenant_binding');
    return json(u.pathname.endsWith('customer_cards') ? [] : null);
  }
  violations.push('unexpected_database_request:' + u.pathname); return json({ message: 'unexpected fixture request' }, 500);
}
const envVars = [['SUPABASE_URL', 'http://127.0.0.1:9000'], ['SUPABASE_SERVICE_ROLE_KEY', service], ['SUPABASE_ANON_KEY', 'synthetic-anon']];
Deno.serve({ port: 9000, hostname: '127.0.0.1' }, async req => {
  const path = new URL(req.url).pathname;
  if (path.startsWith('/rest/') || path.startsWith('/auth/')) return database(req);
  const name = path.slice(1);
  const worker = await EdgeRuntime.userWorkers.create({ servicePath: '/work/supabase/functions/' + name,
    memoryLimitMb: 128, maybeEszip: await Deno.readFile('/artifacts/' + name + '.eszip'),
    maybeEntrypoint: 'file:///work/supabase/functions/' + name + '/index.ts', workerTimeoutMs: 10000,
    cpuTimeSoftLimitMs: 3000, cpuTimeHardLimitMs: 3000, envVars, forceCreate: true });
  return worker.fetch(req);
});
for (const spec of endpoints) for (const mode of ['user', 'service', 'bad_auth', 'foreign_tenant', 'viewer']) {
  endpoint = spec.name; scenario = mode; requests = []; violations = []; job = null;
  // Work transitions ignore caller-supplied tenant: scope comes from Auth. Voicemail
  // uses the caller's RLS. Their record-bound negative case is the absent foreign record.
  if (['work-transition', 'receptionist-voicemail-recording'].includes(endpoint) && mode === 'foreign_tenant') continue;
  let body: any = { tenant_id: mode === 'foreign_tenant' ? foreign : tenant };
  if (['identity-resolve', 'interactions-sync', 'customer-card-sync', 'phone-process-pending'].includes(endpoint)) body.limit = 1;
  if (endpoint === 'gmail-sync-messages') body.email_account_id = record;
  if (['phone-process-pipeline', 'phone-transcribe-recording', 'simwood-download-recording'].includes(endpoint)) body.recording_id = record;
  if (endpoint === 'phone-analyse-transcript') body.transcript_id = record;
  if (endpoint === 'work-transition') body = { object_id: record, expected_version: 1, verb: 'acknowledge' };
  if (endpoint === 'receptionist-voicemail-recording') body = { tenantId: tenant, messageId: record };
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: 'Bearer ' + (mode === 'service' ? service : mode === 'bad_auth' ? 'wrong' : user) };
  if (mode === 'service') headers['x-internal-tenant-id'] = tenant;
  let expected = spec.status;
  if (mode === 'bad_auth') expected = 401;
  if (mode === 'foreign_tenant' || mode === 'viewer' && !['work-transition', 'receptionist-voicemail-recording'].includes(endpoint)) expected = 403;
  if (mode === 'service' && endpoint === 'work-transition') expected = 403;
  if (mode === 'service' && endpoint === 'receptionist-voicemail-recording') expected = 401;
  try {
    const r = await fetch('http://127.0.0.1:9000/' + endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    const response = await r.json();
    const denied = expected === 401 || expected === 403;
    const substantive = requests.filter(r => !['/auth/v1/user', '/rest/v1/profiles'].includes(r.path));
    const passed = r.status === expected && violations.length === 0 && (denied ? substantive.length === 0 : substantive.length > 0);
    console.log('SCHEDULER_CASE=' + JSON.stringify({ endpoint, scenario: mode, passed, status: r.status, expectedStatus: expected,
      databaseRequests: requests.length, violations, response }));
  } catch (error) { console.log('SCHEDULER_CASE=' + JSON.stringify({ endpoint, scenario: mode, passed: false, error: String(error.message).slice(0, 200) })); }
}
console.log('SCHEDULER_CALLERS_DONE');
