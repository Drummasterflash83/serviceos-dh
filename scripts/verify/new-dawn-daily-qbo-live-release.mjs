/** Exact LIVE daily QuickBooks release. Each write is staged and independently read back. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { savedCliToken } from './learn-test-readiness.mjs';

const PROJECT = 'tgbnakbxwcqjeimygroz';
const EDGE = 'learn-quickbooks-daily-reports';
export const SCHEMA = ['20261112170000', 'new_dawn_daily_quickbooks_reports',
  '37d53ae3809d31471c5541b94e2d548837d98f27c01b4a01e61f1a9cdc6be6b1'];
export const SCHEDULE = ['20261112180000', 'new_dawn_daily_quickbooks_schedule',
  '0caf06d819e49ce459110b8692e8b36cff532e9e0bdfd15f282c71f392404ed1'];
const EZBR_SHA = '573ee0fb0133f1e9eae766a8bad10144d7af9941cb3a4ec92c8e94302d5e005a';
const ESZIP_SHA = '0df3e5f3e99260f3e2a4d13c2a946d9bbde06793b4a78db9898b57697fda5d59';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = value => `'${value.replaceAll("'", "''")}'`;
const base = `https://api.supabase.com/v1/projects/${PROJECT}`;

export function reviewedSource(pin) {
  const text = readFileSync(new URL(`../../supabase/migrations/${pin[0]}_${pin[1]}.sql`,
    import.meta.url), 'utf8');
  if (sha(text) !== pin[2] || !/\nbegin;\s*\n/i.test(text) || !/\ncommit;\s*$/i.test(text))
    throw Error('daily_release_source_changed');
  return { text, body: text.slice(text.search(/\nbegin;\s*\n/i) + 8,
    text.lastIndexOf('\ncommit;')) };
}
async function api(path, { method = 'GET', body, contentType } = {}) {
  const response = await fetch(`${base}${path}`, { method, redirect: 'error',
    signal: AbortSignal.timeout(90000), headers: { Authorization: `Bearer ${savedCliToken()}`,
      ...(contentType ? { 'Content-Type': contentType } : {}) },
    ...(body === undefined ? {} : { body }) });
  if (!response.ok) throw Error(`daily_release_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) throw Error('daily_release_response_oversized');
  return bytes;
}
async function sql(query, readOnly = true) {
  const bytes = await api(`/database/query${readOnly ? '/read-only' : ''}`, {
    method: 'POST', body: JSON.stringify({ query, read_only: readOnly }),
    contentType: 'application/json' });
  const rows = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(rows)) throw Error('daily_release_sql_unconfirmed');
  return rows;
}
async function stage() {
  const rows = await sql(`select
    (select count(*)::int from supabase_migrations.schema_migrations where version::text='${SCHEMA[0]}') schema_ledger,
    (select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version::text='${SCHEMA[0]}') schema_hash,
    (select count(*)::int from supabase_migrations.schema_migrations where version::text='${SCHEDULE[0]}') schedule_ledger,
    (select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version::text='${SCHEDULE[0]}') schedule_hash,
    to_regclass('public.learn_quickbooks_daily_reports') is not null policy_table,
    to_regprocedure('public.learn_quickbooks_daily_report_claim()') is not null claim_function,
    (select count(*)::int from vault.secrets where name='LEARN_QUICKBOOKS_DAILY_REPORT_KEY') vault_key_count,
    (select count(*)::int from cron.job where jobname='openfolk-quickbooks-daily-reports') schedule_count,
    (select count(*)::int from cron.job where jobname='openfolk-quickbooks-daily-reports'
      and active and schedule='5 4 * * *' and command like '%LEARN_QUICKBOOKS_DAILY_REPORT_KEY%') schedule_valid`);
  if (rows.length !== 1) throw Error('daily_release_stage_unconfirmed');
  const row = rows[0];
  const policy = row.policy_table ? await sql('select count(*)::int n, count(*) filter(where enabled)::int enabled from public.learn_quickbooks_daily_reports') : [];
  const functions = JSON.parse((await api('/functions')).toString('utf8'));
  if (!Array.isArray(functions) || (row.policy_table && policy.length !== 1))
    throw Error('daily_release_catalog_unconfirmed');
  return { ...row, policy_count: policy[0]?.n ?? 0, enabled_count: policy[0]?.enabled ?? 0,
    edge: functions.find(item => item.slug === EDGE) ?? null };
}
export function assessLiveStage(s, phase) {
  const schema = phase !== 'before', edge = ['edge', 'key', 'schedule'].includes(phase);
  const schedule = phase === 'schedule';
  if (s.schema_ledger !== (schema ? 1 : 0) ||
    s.schema_hash !== (schema ? SCHEMA[2] : null) ||
    s.policy_table !== schema || s.claim_function !== schema ||
    s.schedule_ledger !== (schedule ? 1 : 0) ||
    s.schedule_hash !== (schedule ? SCHEDULE[2] : null) ||
    s.schedule_count !== (schedule ? 1 : 0) ||
    s.schedule_valid !== (schedule ? 1 : 0) ||
    s.policy_count !== 0 || s.enabled_count !== 0 ||
    (edge ? s.edge?.status !== 'ACTIVE' || s.edge.verify_jwt !== false ||
      s.edge.ezbr_sha256 !== EZBR_SHA : s.edge !== null) ||
    (phase === 'before' && s.vault_key_count !== 0) ||
    (['key', 'schedule'].includes(phase) && s.vault_key_count !== 1))
    throw Error('daily_release_live_stage_changed');
  return { state: phase, project: PROJECT, schemaHash: SCHEMA[2],
    edgeHash: edge ? EZBR_SHA : null, scheduleHash: schedule ? SCHEDULE[2] : null,
    policyEnabled: false, providerRequests: 0 };
}
async function installSchema() {
  const { text, body } = reviewedSource(SCHEMA); reviewedSource(SCHEDULE);
  assessLiveStage(await stage(), 'before');
  const query = `begin;set local lock_timeout='3s';set local statement_timeout='90s';
    lock table supabase_migrations.schema_migrations in share row exclusive mode;
    do $gate$ begin if to_regclass('public.learn_quickbooks_daily_reports') is not null
      or exists(select 1 from supabase_migrations.schema_migrations where version::text='${SCHEMA[0]}')
      then raise exception 'daily_schema_precondition_changed';end if;end $gate$;
    ${body}
    insert into supabase_migrations.schema_migrations(version,name,statements)
      values('${SCHEMA[0]}','${SCHEMA[1]}',array[${quote(text)}]);commit;`;
  try { await sql(query, false); } catch { /* Exact ledger and object readback controls uncertainty. */ }
  return assessLiveStage(await stage(), 'schema');
}
function artifact(path) {
  const full = resolve(path), privateRoot = resolve('.verification-results') + '/';
  if (!full.startsWith(privateRoot) || !full.endsWith(`/artifacts/${EDGE}.ezbr`))
    throw Error('daily_release_private_artifact_required');
  const wire = readFileSync(full);
  if (wire.subarray(0, 4).toString() !== 'EZBR' || sha(wire) !== EZBR_SHA)
    throw Error('daily_release_edge_wire_changed');
  const body = brotliDecompressSync(wire.subarray(4), { maxOutputLength: 20 * 1024 * 1024 });
  if (body.subarray(0, 5).toString() !== 'ESZIP' || sha(body) !== ESZIP_SHA)
    throw Error('daily_release_edge_body_changed');
  return wire;
}
async function deployEdge(path) {
  const wire = artifact(path);
  assessLiveStage(await stage(), 'schema');
  const params = new URLSearchParams({ verify_jwt: 'false',
    entrypoint_path: `file:///work/supabase/functions/${EDGE}/index.ts`,
    ezbr_sha256: EZBR_SHA, slug: EDGE, name: EDGE });
  try { await api(`/functions?${params}`, { method: 'POST', body: wire,
    contentType: 'application/vnd.denoland.eszip' }); }
  catch { /* No automatic replay after uncertain deployment. */ }
  const current = assessLiveStage(await stage(), 'edge');
  const body = await api(`/functions/${EDGE}/body`);
  if (sha(body) !== ESZIP_SHA) throw Error('daily_release_edge_body_unconfirmed');
  return current;
}
async function installSchedule() {
  const { text, body } = reviewedSource(SCHEDULE); reviewedSource(SCHEMA);
  assessLiveStage(await stage(), 'key');
  const query = `begin;set local lock_timeout='3s';set local statement_timeout='30s';
    lock table supabase_migrations.schema_migrations in share row exclusive mode;
    do $gate$ begin if exists(select 1 from supabase_migrations.schema_migrations
      where version::text='${SCHEDULE[0]}') or exists(select 1 from cron.job
      where jobname='openfolk-quickbooks-daily-reports') then
      raise exception 'daily_schedule_precondition_changed';end if;end $gate$;
    ${body}
    insert into supabase_migrations.schema_migrations(version,name,statements)
      values('${SCHEDULE[0]}','${SCHEDULE[1]}',array[${quote(text)}]);commit;`;
  try { await sql(query, false); } catch { /* Readback resolves the one exact write. */ }
  return assessLiveStage(await stage(), 'schedule');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, artifactArg] = process.argv.slice(2);
    if (process.env.NEW_DAWN_QBO_PROJECT !== PROJECT) throw Error('daily_release_project_required');
    if (mode === '--read-only' && !artifactArg) console.log(JSON.stringify(await stage()));
    else if (mode === '--install-schema-exact' && artifactArg === SCHEMA[2] &&
      process.env.NEW_DAWN_QBO_SOURCE_SHA === SCHEMA[2]) console.log(JSON.stringify(await installSchema()));
    else if (mode === '--deploy-edge-exact' && artifactArg?.startsWith('--artifact=' ) &&
      process.env.NEW_DAWN_QBO_EDGE_SHA === EZBR_SHA)
      console.log(JSON.stringify(await deployEdge(artifactArg.slice(11))));
    else if (mode === '--install-schedule-exact' && artifactArg === SCHEDULE[2] &&
      process.env.NEW_DAWN_QBO_SCHEDULE_SHA === SCHEDULE[2]) console.log(JSON.stringify(await installSchedule()));
    else throw Error('daily_release_exact_scope_required');
  } catch (error) {
    console.error(JSON.stringify({ state: 'stopped', reason: error instanceof Error ? error.message : 'unknown' }));
    process.exitCode = 1;
  }
}
