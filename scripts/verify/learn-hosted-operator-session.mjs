/** Bounded TEST-only browser acceptance session. Prepare is read-only remotely.
 * Activate requires explicit approval of the saved plan. No existing identity is
 * replaced. Retire retains evidence and ends the grant even if Auth is unavailable.
 * Passwords and aggregate preservation evidence stay in the ignored private file.
 */
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TEST_PROJECT, savedCliToken } from './learn-test-readiness.mjs';
import { communicationQuery } from './learn-card-communication-catalog.mjs';
import { readOperatorHealthCatalog, OPERATOR_HEALTH_PRESERVED, OPERATOR_HEALTH_TABLES } from './learn-operator-health-catalog.mjs';
import { AUTH_CONTRACT_QUERY } from './learn-test-auth-contract.mjs';
import { actionAuthContractMatches } from './learn-test-actions-acceptance.mjs';

export const SESSION_EMAIL = 'chris@openfolk.ai';
// Release 035 changes the ledger only within this health catalog. Activation still
// rechecks all retained data and Auth identity absence from the saved plan.
export const HEALTH_FINGERPRINT = '46a59f9569b729bed69f1ed450f5eb4c';
const version = 'learn-hosted-operator-session/1';
const privateFile = new URL('../../.verification-results/hosted-operator-session.json', import.meta.url);
const base = `https://${TEST_PROJECT}.supabase.co`;
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const check = (ok, message) => { if (!ok) throw Error(message); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

export function newSessionPlan() {
  return { version, projectRef: TEST_PROJECT, email: SESSION_EMAIL,
    runId: randomUUID(), user: randomUUID(), tenant: randomUUID(), grant: randomUUID(),
    durationMinutes: 30, state: 'prepared', createdAt: new Date().toISOString(),
    purpose: 'Signed-in hosted directory, shared health and LEARN capture controls acceptance',
    restrictions: ['Only the marked synthetic company may be changed.',
      'No provider credential, provider call, import or schedule.',
      'Retain evidence; ban login, end grant and disable fixture flags after acceptance.'] };
}
export function validatePlan(plan) {
  check(plan?.version === version && plan.projectRef === TEST_PROJECT && plan.email === SESSION_EMAIL &&
    plan.durationMinutes === 30 && ['runId', 'user', 'tenant', 'grant'].every(k => uuid(plan[k])) &&
    new Set([plan.runId, plan.user, plan.tenant, plan.grant]).size === 4, 'Session plan differs');
}
export function preservationSql(plan) {
  validatePlan(plan);
  const tables = [...OPERATOR_HEALTH_PRESERVED, ...OPERATOR_HEALTH_TABLES.map(n => 'public.' + n)];
  return tables.map(name => {
    // Exclude only the exact fixture rows this acceptance can legitimately change.
    let filter = 'true';
    if (name === 'public.tenants') filter = `id<>${q(plan.tenant)}`;
    if (name === 'public.profiles') filter = `id<>${q(plan.user)}`;
    if (name === 'public.platform_authority_grants') filter = `id<>${q(plan.grant)}`;
    if (['public.feature_flags', 'public.learn_capture_control_requests', 'public.learn_operator_input_requests',
      ...OPERATOR_HEALTH_TABLES.map(n => 'public.' + n)].includes(name))
      filter = `(tenant_id is null or tenant_id<>${q(plan.tenant)})`;
    return `select '${name}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${name} s where ${filter}`;
  }).join(' union all ');
}
export function publicSummary(plan) {
  validatePlan(plan);
  return { version, projectRef: TEST_PROJECT, runId: plan.runId, email: plan.email,
    tenant: plan.tenant, durationMinutes: plan.durationMinutes, state: plan.state,
    expiresAt: plan.expiresAt ?? null, checks: plan.checks ?? null,
    preserved: plan.preserved ?? null, restrictions: plan.restrictions };
}

export async function runSession(mode, { token, approved = false, fetcher = fetch,
  read = () => readFile(privateFile, 'utf8').then(JSON.parse),
  save = (plan, exclusive = false) => writeFile(privateFile, JSON.stringify(plan, null, 2) + '\n',
    { mode: 0o600, flag: exclusive ? 'wx' : 'w' }),
  sql = (query, readOnly = true) => communicationQuery(token, query, { fetcher, readOnly }),
  catalog = () => readOperatorHealthCatalog(token),
} = {}) {
  check(['prepare', 'activate', 'status', 'retire'].includes(mode), 'Explicit session operation required');
  const plan = mode === 'prepare' ? newSessionPlan() : await read();
  validatePlan(plan);
  const persist = () => save(plan);
  async function preflight() {
    check((await catalog()).fingerprint === HEALTH_FINGERPRINT, 'Installed TEST health schema differs');
    const auth = await sql(AUTH_CONTRACT_QUERY);
    check(auth.length === 1 && actionAuthContractMatches(auth[0].contract), 'TEST Auth contract differs');
    const rows = await sql(`select (select count(*)::int from auth.users where lower(email)=${q(SESSION_EMAIL)} or id=${q(plan.user)}) as users,
      (select count(*)::int from public.profiles where lower(email)=${q(SESSION_EMAIL)} or id=${q(plan.user)}) as profiles,
      (select count(*)::int from public.tenants where id=${q(plan.tenant)}) as tenants,
      (select count(*)::int from public.platform_authority_grants where id=${q(plan.grant)}) as grants`);
    check(rows.length === 1 && Object.values(rows[0]).every(n => n === 0), 'Existing identity or fixture found; no replacement allowed');
  }
  const snapshot = async () => (await sql(preservationSql(plan))).sort((a,b) => a.name.localeCompare(b.name));
  async function request(url, headers, method = 'GET', body) {
    const r = await fetcher(url, { method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      redirect: 'error', signal: AbortSignal.timeout(30000) });
    check(r.ok, `TEST session request failed (HTTP ${r.status})`);
    return r.json();
  }
  async function adminHeaders() {
    const keys = await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`, {Authorization: `Bearer ${token}`});
    const selected = keys.filter(k => k.name === 'service_role');
    check(selected.length === 1, 'Unique existing TEST service key required');
    const key = selected[0].api_key;
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    check(claims.ref === TEST_PROJECT && claims.role === 'service_role', 'TEST key target differs');
    return {apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'};
  }
  if (mode === 'prepare') {
    await preflight();
    plan.before = await snapshot();
    await save(plan, true);
  } else if (mode === 'activate') {
    check(approved && plan.state === 'prepared', 'Explicit approval of an unused plan required');
    await preflight();
    check(JSON.stringify(await snapshot()) === JSON.stringify(plan.before), 'Retained data changed since preparation; review before activation');
    const admin = await adminHeaders();
    plan.password = randomBytes(36).toString('base64url');
    plan.state = 'activation_started'; // Durable before any remote mutation. Never replay blindly.
    await persist();
    const made = await request(`${base}/auth/v1/admin/users`, admin, 'POST', {
      id: plan.user, email: plan.email, password: plan.password, email_confirm: true,
      app_metadata: {learn_hosted_operator_session: plan.runId},
    });
    check(made.id === plan.user, 'Created TEST identity differs');
    plan.state = 'identity_created'; await persist();
    const rows = await sql(`begin;set local statement_timeout='15s';
      do $$begin if not exists(select 1 from auth.users where id=${q(plan.user)} and lower(email)=${q(plan.email)} and raw_app_meta_data->>'learn_hosted_operator_session'=${q(plan.runId)}) then raise exception 'Fixture identity mismatch';end if;end $$;
      insert into public.tenants(id,slug,display_name,status,metadata) values(${q(plan.tenant)},${q('learn-hosted-operator-'+plan.runId)},'SYNTHETIC Hosted operator acceptance','archived',jsonb_build_object('synthetic',true,'learn_hosted_operator_session',${q(plan.runId)}));
      update public.profiles set tenant_id=${q(plan.tenant)},role='viewer' where id=${q(plan.user)} and lower(email)=${q(plan.email)};
      do $$begin if not exists(select 1 from public.profiles where id=${q(plan.user)} and tenant_id=${q(plan.tenant)} and role='viewer') then raise exception 'Fixture profile mismatch';end if;end $$;
      insert into public.platform_authority_grants(id,profile_id,permission,effective_from,effective_to,granted_by,reason,source)
      values(${q(plan.grant)},${q(plan.user)},'platform.controlplane.admin',clock_timestamp(),clock_timestamp()+interval '30 minutes',${q('approved-test:'+plan.runId)},'Temporary hosted UI acceptance; synthetic company changes only','test');
      commit;select effective_to as expires_at from public.platform_authority_grants where id=${q(plan.grant)}`, false);
    check(rows.length === 1 && Number.isFinite(Date.parse(rows[0].expires_at)), 'Grant expiry unconfirmed');
    plan.expiresAt = rows[0].expires_at; plan.state = 'active'; await persist();
  } else if (mode === 'retire') {
    check(plan.state !== 'prepared', 'No activation attempted');
    // Terminate database authority first. Safe on partial setup and after lost replies.
    await sql(`begin;set local statement_timeout='15s';
      update public.platform_authority_grants set effective_to=least(coalesce(effective_to,clock_timestamp()),clock_timestamp()) where id=${q(plan.grant)} and profile_id=${q(plan.user)} and granted_by=${q('approved-test:'+plan.runId)};
      update public.profiles set role='viewer' where id=${q(plan.user)} and lower(email)=${q(plan.email)} and exists(select 1 from auth.users where id=${q(plan.user)} and raw_app_meta_data->>'learn_hosted_operator_session'=${q(plan.runId)});
      update public.feature_flags set value='false'::jsonb where tenant_id=${q(plan.tenant)} and exists(select 1 from public.tenants where id=${q(plan.tenant)} and metadata->>'learn_hosted_operator_session'=${q(plan.runId)});
      commit;`, false);
    plan.state = 'grant_retired'; await persist();
    const admin = await adminHeaders();
    const user = await request(`${base}/auth/v1/admin/users/${plan.user}`, admin);
    check(user.email === plan.email && user.app_metadata?.learn_hosted_operator_session === plan.runId, 'Retirement identity differs');
    const banned = await request(`${base}/auth/v1/admin/users/${plan.user}`, admin, 'PUT', {ban_duration: '876000h',password:randomBytes(48).toString('base64url')});
    check(Date.parse(banned.banned_until) > Date.now() + 86400000, 'Login ban unconfirmed');
    delete plan.password;
    plan.state = 'retired'; plan.retiredAt = new Date().toISOString(); await persist();
  }
  if (mode !== 'prepare') {
    const rows = await sql(`select
      (select count(*)::int from public.platform_authority_grants where profile_id=${q(plan.user)} and coalesce(effective_from,'-infinity')<=now() and coalesce(effective_to,'infinity')>now()) as active_grants,
      (select count(*)::int from auth.users where id=${q(plan.user)} and banned_until>now()) as banned_logins,
      (select count(*)::int from public.platform_jobs where tenant_id=${q(plan.tenant)} and status in ('queued','running','retrying')) as active_jobs,
      (select count(*)::int from public.provider_connections where tenant_id=${q(plan.tenant)}) as connections`);
    plan.checks = rows[0];
    plan.preserved = JSON.stringify(await snapshot()) === JSON.stringify(plan.before);
    await persist();
    check(plan.preserved && plan.checks.active_jobs === 0 && plan.checks.connections === 0, 'Acceptance boundary differs; inspect before continuing');
    if (plan.state === 'retired') check(plan.checks.active_grants === 0 && plan.checks.banned_logins === 1, 'Retirement unconfirmed');
  }
  return publicSummary(plan);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [mode, approval, ...extra] = process.argv.slice(2);
    check(process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT && extra.length === 0 &&
      (mode === 'activate' ? approval === '--approved' : approval === undefined), 'Explicit TEST session arguments required');
    if (mode !== 'prepare') { const s = await stat(privateFile); check(s.isFile() && !(s.mode & 0o077), 'Private manifest permissions required'); }
    console.log(JSON.stringify(await runSession(mode, {token:savedCliToken(), approved:approval === '--approved'}), null, 2));
  } catch (error) {
    // All errors originate from fixed checks or runtime plumbing, but do not print
    // arbitrary provider/transport errors (which can contain credential details).
    console.error('TEST operator session stopped. Inspect the private journal before another action.');
    process.exitCode = 1;
  }
}
