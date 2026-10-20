/** Exact, one-time Drummonds M2 batch release. Never prints credentials or source IDs. */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';

const PROJECT = 'tgbnakbxwcqjeimygroz';
const TENANT = '00000000-0000-0000-0000-000000000001';
const BATCH = '64af841f-a84b-400b-8fed-669f8ec32747';
const DIGEST = 'a287b8a1b76686111f40b2ddf4761e5d212961b8556329c9b4ab9d54889f096e';
const FLAG = 'new_dawn.m2_staged_batch_apply';
const BASE = `https://api.supabase.com/v1/projects/${PROJECT}`;
const sqlLiteral = value => `'${value.replaceAll("'", "''")}'`;

async function management(path, query, readOnly = true) {
  const response = await fetch(`${BASE}${path}`, {
    method: query ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(75_000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      ...(query ? { 'Content-Type': 'application/json' } : {}) },
    ...(query ? { body: JSON.stringify({ query, read_only: readOnly }) } : {}),
  });
  if (!response.ok) throw Error(`management_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1_000_000) throw Error('management_response_too_large');
  return JSON.parse(bytes.toString('utf8'));
}

const scopeSql = `select b.id::text batch_id,b.tenant_id::text tenant_id,
 b.item_count,b.manifest_sha256,b.expires_at>clock_timestamp()+interval '30 minutes' expiry_ok,
 (select count(*)::int from public.new_dawn_m2_identity_items i where i.batch_id=b.id and kind='customer') customers,
 (select count(*)::int from public.new_dawn_m2_identity_items i where i.batch_id=b.id and kind='site') sites,
 (select count(*)::int from public.new_dawn_m2_identity_items i where i.batch_id=b.id and kind='job') jobs,
 (select count(*)::int from public.new_dawn_m2_identity_items i where i.batch_id=b.id and state='prepared') prepared,
 (select count(*)::int from public.new_dawn_m2_identity_items i where i.batch_id=b.id and state='linked') linked,
 (select count(*)::int from public.new_dawn_m2_identity_items i where i.batch_id=b.id and state='held') held,
 (select count(*)::int from public.new_dawn_m2_identity_items i where i.batch_id=b.id and state='reversed') reversed,
 (select count(*)::int from public.feature_flags where tenant_id=b.tenant_id and flag='${FLAG}' and value='true'::jsonb) flag_on,
 (select count(*)::int from public.feature_flags where flag='${FLAG}' and tenant_id is distinct from b.tenant_id and value='true'::jsonb) other_flag_on,
 (select count(*)::int from public.feature_flags where tenant_id=b.tenant_id and flag in ('learn.enabled','learn.inputs.commusoft.enabled') and value='true'::jsonb) input_flags_on,
 (select count(*)::int from public.provider_connections c where c.id=b.connection_id and c.tenant_id=b.tenant_id and c.provider='commusoft' and c.status='configured' and c.revoked_at is null) connection_ok,
 (select count(*)::int from public.controlplane_change_log a where a.tenant_id=b.tenant_id and a.actor=b.actor_id::text and a.action='client_identity.staged_batch_registered' and a.resource_id=b.id::text and a.source='new-dawn-staged-identity') registration_audits,
 (select count(*)::int from supabase_migrations.schema_migrations where version::text in ('20261111100000','20261111110000','20261111120000','20261111130000','20261111140000')) migration_count,
 (select count(*)::bigint from public.companies where tenant_id=b.tenant_id) company_count,
 (select count(*)::bigint from public.sites where tenant_id=b.tenant_id) site_count,
 (select count(*)::bigint from public.jobs where tenant_id=b.tenant_id) job_count
 from public.new_dawn_m2_identity_batches b where b.id='${BATCH}'::uuid`;

async function scope() {
  const rows = await management('/database/query/read-only', scopeSql);
  if (!Array.isArray(rows) || rows.length !== 1) throw Error('batch_scope_missing');
  const s = rows[0];
  if (s.batch_id !== BATCH || s.tenant_id !== TENANT || s.manifest_sha256 !== DIGEST ||
    s.item_count !== 1044 || s.customers !== 112 || s.sites !== 128 || s.jobs !== 804 ||
    s.other_flag_on !== 0 || s.input_flags_on !== 2 || s.connection_ok !== 1 ||
    s.registration_audits !== 1 || s.migration_count !== 5 || !s.expiry_ok ||
    s.prepared + s.linked + s.held + s.reversed !== 1044 || ![0, 1].includes(s.flag_on))
    throw Error('batch_scope_changed');
  return s;
}

async function groups() {
  const rows = await management('/database/query/read-only',
    `select external_id from public.new_dawn_m2_identity_items where batch_id='${BATCH}'::uuid and kind='customer' order by ordinal`);
  if (!Array.isArray(rows) || rows.length !== 112 ||
    new Set(rows.map(x => x.external_id)).size !== 112 ||
    rows.some(x => typeof x.external_id !== 'string' || !/^[1-9][0-9]{0,15}$/.test(x.external_id)))
    throw Error('batch_groups_changed');
  return rows.map(x => x.external_id);
}

function flagSql(on, auditId) {
  const before = on ? 'false' : 'true';
  const after = on ? 'true' : 'false';
  return `begin;
set local lock_timeout='3s';set local statement_timeout='30s';
lock table public.feature_flags in share row exclusive mode;
do $release$ begin
 if not exists(select 1 from public.new_dawn_m2_identity_batches where id='${BATCH}'::uuid and tenant_id='${TENANT}'::uuid and manifest_sha256='${DIGEST}' and expires_at>clock_timestamp()+interval '30 minutes')
 or (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${FLAG}')<>
    (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='${before}'::jsonb)
 or (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='${before}'::jsonb)${on ? '>1' : '<>1'}
 or (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='${after}'::jsonb)<>0
 or exists(select 1 from public.feature_flags where flag='${FLAG}' and tenant_id is distinct from '${TENANT}'::uuid and value='true'::jsonb)
 then raise exception 'm2_release_flag_preflight_changed'; end if;
 ${on ? `if exists(select 1 from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${FLAG}') then
  update public.feature_flags set value='true'::jsonb where tenant_id='${TENANT}'::uuid and flag='${FLAG}';
 else insert into public.feature_flags(tenant_id,flag,value) values('${TENANT}'::uuid,'${FLAG}','true'::jsonb); end if;` :
 `update public.feature_flags set value='false'::jsonb where tenant_id='${TENANT}'::uuid and flag='${FLAG}';`}
 if (select count(*) from public.feature_flags where tenant_id='${TENANT}'::uuid and flag='${FLAG}' and value='${after}'::jsonb)<>1
 then raise exception 'm2_release_flag_postcheck_changed'; end if;
 insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,before,after,reason,correlation_id,view_as_active,source)
 values('${auditId}'::uuid,'${TENANT}'::uuid,'codex:release-service-role','client_identity.staged_batch_apply_${on ? 'enable' : 'disable'}',
 'feature_flag','${FLAG}',jsonb_build_object('enabled',${!on}),jsonb_build_object('enabled',${on}),
 'Approved exact Drummonds company identity batch ${BATCH}','${auditId}',false,'codex-release');
end $release$;
select 'm2-flag-${after}' state;
commit;`;
}

async function switchFlag(on) {
  const id = randomUUID();
  let acknowledged = false;
  try {
    const rows = await management('/database/query', flagSql(on, id), false);
    acknowledged = rows?.some?.(x => x.state === `m2-flag-${on}`) === true;
  } catch { /* Outcome must be resolved by readback; never blindly replay. */ }
  const s = await scope();
  const audit = await management('/database/query/read-only',
    `select id::text,action,source from public.controlplane_change_log where id=${sqlLiteral(id)}::uuid`);
  if (s.flag_on !== Number(on) || !Array.isArray(audit) || audit.length !== 1 ||
    audit[0].id !== id || audit[0].action !== `client_identity.staged_batch_apply_${on ? 'enable' : 'disable'}` ||
    audit[0].source !== 'codex-release') throw Error('m2_flag_outcome_unverified');
  return { auditId: id, acknowledged };
}

async function serviceKey() {
  const keys = await management('/api-keys?reveal=true', null);
  const key = Array.isArray(keys) ? keys.filter(x => x.type === 'legacy' && x.name === 'service_role') : [];
  if (key.length !== 1 || typeof key[0].api_key !== 'string') throw Error('service_key_unavailable');
  const jwt = key[0].api_key;
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8'));
  if (claims.role !== 'service_role' || claims.ref !== PROJECT ||
    !Number.isInteger(claims.exp) || claims.exp < Date.now() / 1000 + 3600)
    throw Error('service_key_wrong_project_or_expired');
  return jwt;
}

async function applyGroup(key, externalId) {
  const response = await fetch(`https://${PROJECT}.supabase.co/rest/v1/rpc/new_dawn_m2_identity_apply_group`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(75_000),
    headers: { apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ p_batch: BATCH, p_customer_external: externalId }),
  });
  if (!response.ok) throw Error(`m2_group_http_${response.status}`);
  const value = await response.json();
  if (!value || value.batch_id !== BATCH || !['linked', 'held', 'already_linked'].includes(value.state) ||
    !Number.isInteger(value.item_count) || value.item_count < 2 || value.item_count > 500)
    throw Error('m2_group_receipt_invalid');
  return { state: value.state, itemCount: value.item_count };
}

async function run(mode) {
  const info = await management('', null);
  if (info?.id !== PROJECT || info.status !== 'ACTIVE_HEALTHY') throw Error('project_not_healthy');
  const before = await scope();
  if (mode === '--read-only') return { state: 'readback', ...before };
  if (mode === '--disable-apply') {
    if (before.flag_on !== 1) throw Error('apply_flag_not_on');
    const disabled = await switchFlag(false);
    return { state: 'apply_flag_disabled', ...disabled, flagOn: 0 };
  }
  if (mode !== '--apply-exact-batch' || process.env.NEW_DAWN_M2_PROJECT !== PROJECT ||
    process.env.NEW_DAWN_M2_BATCH !== BATCH || before.flag_on !== 0 ||
    before.prepared !== 1044 || before.linked !== 0 || before.held !== 0 || before.reversed !== 0)
    throw Error('exact_apply_scope_required');
  const ids = await groups();
  const key = await serviceKey();
  let tally = { groupsLinked: 0, groupsHeld: 0, itemsLinked: 0, itemsHeld: 0 };
  try {
    await switchFlag(true);
    for (let i = 0; i < ids.length; i++) {
      const result = await applyGroup(key, ids[i]);
      if (result.state === 'linked') { tally.groupsLinked++; tally.itemsLinked += result.itemCount; }
      else if (result.state === 'held') { tally.groupsHeld++; tally.itemsHeld += result.itemCount; }
      else throw Error('unexpected_already_linked_group');
      if ((i + 1) % 20 === 0 || i + 1 === ids.length)
        console.log(JSON.stringify({ state: 'm2_apply_progress', groupsDone: i + 1,
          groupsTotal: ids.length, groupsLinked: tally.groupsLinked, groupsHeld: tally.groupsHeld }));
    }
  } finally {
    const current = await scope();
    if (current.flag_on === 1) await switchFlag(false);
  }
  const after = await scope();
  if (after.flag_on !== 0 || after.prepared !== 0 ||
    after.linked !== tally.itemsLinked || after.held !== tally.itemsHeld ||
    after.linked + after.held !== 1044) throw Error('m2_apply_readback_mismatch');
  return { state: 'm2_batch_applied_readback_verified', batchId: BATCH,
    groups: ids.length, ...tally, before: { companies: before.company_count,
      sites: before.site_count, jobs: before.job_count },
    after: { companies: after.company_count, sites: after.site_count, jobs: after.job_count },
    flagOn: after.flag_on, providerRequests: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const mode = process.argv.slice(2).join(' ');
    if (!['--read-only', '--apply-exact-batch', '--disable-apply'].includes(mode))
      throw Error('exact_mode_required');
    console.log(JSON.stringify(await run(mode)));
  } catch (error) {
    console.error(JSON.stringify({ state: 'm2_batch_release_stopped',
      reason: error instanceof Error ? error.message : 'unknown' }));
    process.exitCode = 1;
  }
}
