/** One approved real TEST email page; no automatic replay of uncertain operations. */
import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
import { communicationQuery } from './learn-card-communication-catalog.mjs';
import { readSupervisorMetadata, SCOPE } from './learn-commusoft-operator-run.mjs';
import { matchesEmailSourceAuthority } from './learn-email-source-authority.mjs';

const mode = process.argv[2], file = '.verification-results/email-real-test-20261012.json';
const check = (v, m) => { if (!v) throw Error(m); };
const quote = v => "'" + String(v).replaceAll("'", "''") + "'";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = a => [...a].sort((x, y) => x.name.localeCompare(y.name));
check(['rehearse', 'capture', 'pause', 'inspect'].includes(mode) && process.argv.length === 3 &&
  process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT, 'Explicit TEST mode required');
const p = JSON.parse(readFileSync(file));
check(p.project === TEST_PROJECT && p.tenant === SCOPE.tenant &&
  p.mailbox === 'heidi@drummondheating.co.uk' && p.limits.pages === 1 && p.limits.messages === 20,
  'Prepared scope differs');
for (const id of [p.run, p.connection, p.mailboxId, p.account])
  check(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id), 'Invalid prepared identity');
if (['capture', 'pause'].includes(mode))
  check(process.env.LEARN_REAL_EMAIL_APPROVED_RUN === p.run, 'Exact real mailbox capture approval required');
const token = savedCliToken(), q = s => readSupervisorMetadata(token, s);
const lock = openSync(file + '.lock', 'wx', 0o600);
const write = s => communicationQuery(token, s, { readOnly: false });
const save = () => writeFileSync(file, JSON.stringify(p, null, 2) + '\n', { mode: 0o600 });
async function mgmt(project, path, query) {
  check([TEST_PROJECT, 'tgbnakbxwcqjeimygroz'].includes(project), 'Wrong project');
  const r = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(query ? { 'Content-Type': 'application/json' } : {}) },
    ...(query ? { body: JSON.stringify({ query }) } : {}),
    redirect: 'error', signal: AbortSignal.timeout(45000),
  });
  check(r.ok, `Scoped metadata read failed HTTP ${r.status}`);
  return r.json();
}
const newTenantTables = ['email_accounts', 'google_workspace_connections', 'google_workspace_mailboxes',
  'email_messages', 'email_threads', 'email_sync_runs', 'email_ingestion_checkpoints',
  'email_ingestion_transitions', 'learn_email_transition_requests', 'learn_email_job_attempts',
  'learn_email_source_versions'];
function preservation() {
  return p.baseQuery.split(' union all ').map(part => {
    const table = / from ([a-z_.]+) s where /.exec(part)?.[1];
    let predicate;
    if (newTenantTables.includes(table?.replace('public.', '')))
      predicate = `s.tenant_id<>${quote(p.tenant)}`;
    if (table === 'public.learn_email_transition_settlements')
      predicate = `not exists(select 1 from public.learn_email_transition_requests r where r.id=s.request_id and r.tenant_id=${quote(p.tenant)})`;
    if (table === 'public.system_health_checks')
      predicate = `not(s.tenant_id=${quote(p.tenant)} and s.component='email_sync')`;
    if (table === 'public.audit_logs')
      predicate = `(s.tenant_id<>${quote(p.tenant)} or s.created_at<=${quote(p.preparedAt)}::timestamptz)`;
    return predicate ? part.replace(`from ${table} s where `, `from ${table} s where (${predicate}) and `) : part;
  }).join(' union all ');
}
const registration = `
select pg_advisory_xact_lock(hashtextextended('learn-input-setup:${p.tenant}',0));
do $$begin
 if not exists(select 1 from public.feature_flags where tenant_id=${quote(p.tenant)} and flag='learn.inputs.email.enabled' and value='false'::jsonb)
 or not exists(select 1 from public.feature_flags where tenant_id=${quote(p.tenant)} and flag='learn.enabled' and value='true'::jsonb)
 or exists(select 1 from public.email_accounts where tenant_id=${quote(p.tenant)})
 or exists(select 1 from public.google_workspace_connections where tenant_id=${quote(p.tenant)})
 then raise exception 'email_test_scope_changed';end if;
end $$;
insert into public.google_workspace_connections(id,tenant_id,domain,status,service_account_email,service_account_client_id,last_verified_at,delegated_scopes)
 values(${quote(p.connection)},${quote(p.tenant)},${quote(p.source.domain)},'active',${quote(p.source.service_account_email)},${quote(p.source.service_account_client_id)},${quote(p.source.last_verified_at)},array['https://www.googleapis.com/auth/gmail.readonly']);
insert into public.google_workspace_mailboxes(id,tenant_id,connection_id,email_address,mailbox_type,status,sync_enabled)
 values(${quote(p.mailboxId)},${quote(p.tenant)},${quote(p.connection)},${quote(p.mailbox)},'user','active',true);
insert into public.email_accounts(id,tenant_id,provider,email_address,status)
 values(${quote(p.account)},${quote(p.tenant)},'gmail',${quote(p.mailbox)},'active_dwd');
update public.feature_flags set value='true'::jsonb where tenant_id=${quote(p.tenant)} and flag='learn.inputs.email.enabled';
insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,resource_id,reason,source,view_as_active,after)
 values(${quote(p.tenant)},'serviceos:email-test-acceptance','email_test.register','email_accounts',${quote(p.account)},${quote('Bounded real email TEST run ' + p.run)},'learn-email-real-test',false,jsonb_build_object('run',${quote(p.run)},'max_messages',20,'read_only_provider',true));
set local role service_role;
select public.learn_email_enqueue(${quote(p.tenant)},${quote(p.account)},'email.workspace_sync','{"max_results":20}'::jsonb) receipt;
reset role;`;
const registrationSha256 = createHash('sha256').update(registration).digest('hex');
async function pause() {
  await write(`begin;
  update public.feature_flags set value='false'::jsonb where tenant_id=${quote(p.tenant)} and flag='learn.inputs.email.enabled';
  update public.email_accounts set status='disabled' where tenant_id=${quote(p.tenant)} and id=${quote(p.account)};
  update public.google_workspace_mailboxes set sync_enabled=false,status='disabled' where tenant_id=${quote(p.tenant)} and id=${quote(p.mailboxId)};
  update public.google_workspace_connections set status='disabled' where tenant_id=${quote(p.tenant)} and id=${quote(p.connection)};
  commit;`);
  p.pauseRequestedAt = new Date().toISOString(); save();
}
async function observe() {
  const rows = await q(`select jsonb_build_object('at',clock_timestamp(),
    'messages',(select count(*)::int from public.email_messages where tenant_id=${quote(p.tenant)}),
    'threads',(select count(*)::int from public.email_threads where tenant_id=${quote(p.tenant)}),
    'ai',(select count(*)::int from public.email_ai_insights where tenant_id=${quote(p.tenant)}),
    'enabled',(select value from public.feature_flags where tenant_id=${quote(p.tenant)} and flag='learn.inputs.email.enabled'),
    'accountStatus',(select status from public.email_accounts where id=${quote(p.account)}),
    'mailboxEnabled',(select sync_enabled from public.google_workspace_mailboxes where id=${quote(p.mailboxId)}),
    'connectionStatus',(select status from public.google_workspace_connections where id=${quote(p.connection)}),
    'jobs',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'attempt',attempt_count,'lease',lease_expires_at,'errorCode',error_code)),'[]') from public.platform_jobs where tenant_id=${quote(p.tenant)} and payload->>'email_account_id'=${quote(p.account)}),
    'attempts',(select count(*)::int from public.learn_email_job_attempts where tenant_id=${quote(p.tenant)} and email_account_id=${quote(p.account)}),
    'runs',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'records',records_processed)),'[]') from public.email_sync_runs where tenant_id=${quote(p.tenant)}),
    'checkpoints',(select coalesce(jsonb_agg(jsonb_build_object('stream',stream,'state',state)),'[]') from public.email_ingestion_checkpoints where tenant_id=${quote(p.tenant)} and email_account_id=${quote(p.account)})
  ) observation`);
  const after = await q(preservation());
  const changed = after.filter(a => !same(a, p.before.find(b => b.name === a.name))).map(a => a.name);
  p.latest = { ...rows[0].observation, preserved: changed.length === 0, changedDatasets: changed };
  save(); return p.latest;
}
try {
  if (mode === 'pause') { await pause(); console.log(JSON.stringify(await observe(), null, 2)); }
  else if (mode === 'inspect') console.log(JSON.stringify(await observe(), null, 2));
  else {
    check(p.state === 'prepared' && !p.pending, 'Run already attempted; inspect before continuing');
    const pins = (await mgmt(TEST_PROJECT, '/functions'))
      .filter(f => p.pins.some(x => x.name === f.slug))
      .map(f => ({ name: f.slug, id: f.id, version: f.version, hash: f.ezbr_sha256, jwt: f.verify_jwt, status: f.status }))
      .sort((a, b) => a.name.localeCompare(b.name));
    check(same(pins, p.pins), 'Prepared runtime changed');
    const secrets = await mgmt(TEST_PROJECT, '/secrets');
    check(Object.entries(p.credentialDigests).every(([name, hash]) => secrets.filter(s => s.name === name && (s.digest ?? s.value) === hash).length === 1), 'Credential binding changed');
    const source = await mgmt('tgbnakbxwcqjeimygroz', '/database/query/read-only', p.sourceQuery);
    check(source.length === 1 && matchesEmailSourceAuthority(p.source, source[0]), 'Production source authority changed');
    check(same(sorted(await q(p.baseQuery)), sorted(p.before)), 'Protected data changed since preparation');
    check(same(sorted(await q(preservation())), sorted(p.before)), 'Preservation exclusions would omit prior records');
    if (mode === 'rehearse') {
      const rows = await write('begin;' + registration + 'rollback;');
      const receipt = rows.find(r => r.receipt)?.receipt;
      check(receipt?.success === true && receipt.duplicate === false && receipt.email_account_id === p.account, 'Rehearsal enqueue did not match');
      check(same(sorted(await q(p.baseQuery)), sorted(p.before)), 'Rehearsal did not preserve all original data');
      check((await q(`select count(*)::int n from public.email_accounts where tenant_id=${quote(p.tenant)}`))[0].n === 0, 'Rehearsal registration persisted');
      p.rehearsal = { at: new Date().toISOString(), registrationSha256, preservedDatasets: p.before.length, queuedInsideRollback: true, providerRequests: 0 };
      save(); console.log(JSON.stringify({ run: p.run, rehearsal: p.rehearsal }, null, 2));
    } else {
      check(p.rehearsal?.queuedInsideRollback === true && p.rehearsal.registrationSha256 === registrationSha256, 'Exact full-schema registration rehearsal required');
      check(!existsSync('.verification-results/commusoft-operator-2026-10-12.lock'), 'Commusoft supervisor must be stopped first');
      check((await q("select count(*)::int n from public.platform_jobs where status in ('queued','running','retrying') and not(job_type='commusoft.source_sync' and status in ('queued','retrying') and lease_expires_at is null)"))[0].n === 0, 'Finish or settle existing workers first');
      const cron = await q("select to_regclass('cron.job') is not null present");
      if (cron[0].present) check((await q('select count(*)::int n from cron.job where active'))[0].n === 0, 'Active schedule detected');
      const keys = await mgmt(TEST_PROJECT, '/api-keys?reveal=true');
      const matches = keys.filter(k => k.name === 'service_role'); check(matches.length === 1, 'Unique existing service key required');
      const key = matches[0].api_key, claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url'));
      check(claims.ref === TEST_PROJECT && claims.role === 'service_role', 'Wrong service credential');
      const internalDigest = createHash('sha256').update(key).digest('hex');
      check(secrets.some(s => s.name === 'SERVICEOS_INTERNAL_KEY' && (s.digest ?? s.value) === internalDigest), 'Internal credential binding differs');
      p.state = 'registration_started'; p.pending = { kind: 'registration', at: new Date().toISOString() }; save();
      try {
        const rows = await write('begin;' + registration + 'commit;');
        const receipt = rows.find(r => r.receipt)?.receipt;
        check(receipt?.success === true && receipt.duplicate === false && receipt.email_account_id === p.account, 'Registration outcome unconfirmed');
        p.job = receipt.job_id; p.pending = { kind: 'worker', job: p.job, at: new Date().toISOString() }; p.state = 'capture_started'; save();
        const r = await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/platform-worker`, {
          method: 'POST', headers: { Authorization: `Bearer ${key}`, apikey: key, 'x-serviceos-internal-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch_size: 1, job_types: ['email.workspace_sync'] }),
          redirect: 'error', signal: AbortSignal.timeout(105000),
        });
        check(r.ok, `Worker outcome unconfirmed HTTP ${r.status}`);
        const result = await r.json();
        p.history.push({ status: r.status, at: new Date().toISOString(), claimed: result.claimed, succeeded: result.succeeded, unconfirmed: result.unconfirmed, failed: result.failed, retrying: result.retrying, deadLettered: result.dead_lettered });
        check(result.claimed === 1 && result.unconfirmed === 0, 'Exact worker result requires inspection');
        p.pending = null; p.state = result.succeeded === 1 ? 'page_captured' : 'capture_requires_review'; save();
      } finally { await pause(); }
      const o = await observe();
      check(o.preserved && o.messages <= 20 && o.ai === 0 && o.enabled === false && o.mailboxEnabled === false && o.accountStatus === 'disabled' && o.connectionStatus === 'disabled', 'Capture bound, pause or preservation requires review');
      console.log(JSON.stringify({ run: p.run, state: p.state, latest: o }, null, 2));
    }
  }
} finally { closeSync(lock); unlinkSync(file + '.lock'); }
