/** Exact guarded TEST/LIVE schema release; does not adopt any Email rows. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const mode = process.argv.slice(2).join(' ');
if (!['--test-apply', '--live-apply',
      '--test-held-apply', '--live-held-apply'].includes(mode))
  throw Error('Exact release mode required');
const testMode = mode.startsWith('--test');
const heldMode = mode.includes('held');
const project = testMode ? TEST_PROJECT : 'tgbnakbxwcqjeimygroz';
const allowName = testMode ? 'LEARN_TEST_ALLOW_PROJECT_REF' :
  'LEARN_LIVE_ALLOW_PROJECT_REF';
if (process.env[allowName] !== project) throw Error('Exact project allowlist required');
const migration = readFileSync(new URL(heldMode ?
  '../../supabase/migrations/20261104223100_learn_email_equivalent_legacy_hold_adoption.sql' :
  '../../supabase/migrations/20261104223000_learn_email_legacy_equivalent_adoption.sql', import.meta.url), 'utf8');
assert(migration.startsWith(heldMode ? '-- Supersede only automated' : '-- One-time Drummonds adoption'));
assert(migration.includes(heldMode ? '7098da590fbbb277fb45713e41feae12' : "session_user<>'postgres'"));
const migrationSha256 = createHash('sha256').update(migration).digest('hex');
const headers = { Authorization: `Bearer ${savedCliToken()}`,
  'Content-Type': 'application/json' };
async function query(sql, readOnly = false) {
  const path = readOnly ? '/database/query/read-only' : '/database/query';
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000), headers,
    body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw Error(`Email legacy schema HTTP ${response.status}: ${String(detail.message ?? detail.code ?? '').slice(0, 240)}`);
  }
  return response.json();
}
const before = await query(`select to_regprocedure('public.learn_email_adopt_equivalent_legacy(uuid,uuid,integer)') is null helper_absent,
 case when to_regprocedure('public.learn_email_adopt_equivalent_legacy(uuid,uuid,integer)') is not null
  then md5(pg_get_functiondef(to_regprocedure('public.learn_email_adopt_equivalent_legacy(uuid,uuid,integer)'))) end helper_md5`, true);
assert(heldMode ? before?.[0]?.helper_md5 === '7098da590fbbb277fb45713e41feae12' :
  before?.[0]?.helper_absent === true,
  'Legacy adoption helper baseline changed; inspect before repeating');
await query(migration);
const after = await query(`select to_regprocedure('public.learn_email_adopt_equivalent_legacy(uuid,uuid,integer)') is not null helper_present,
 not has_function_privilege('service_role','public.learn_email_adopt_equivalent_legacy(uuid,uuid,integer)','EXECUTE') service_role_denied,
 not has_function_privilege('authenticated','public.learn_email_adopt_equivalent_legacy(uuid,uuid,integer)','EXECUTE') authenticated_denied,
 md5(pg_get_functiondef('public.learn_email_adopt_equivalent_legacy(uuid,uuid,integer)'::regprocedure)) helper_md5,
 md5(pg_get_functiondef('public.learn_project_interaction(uuid,uuid,text,uuid,text,text)'::regprocedure)) projector_md5`, true);
assert(after?.[0]?.helper_present === true &&
  after[0].service_role_denied === true && after[0].authenticated_denied === true &&
  (!heldMode || after[0].helper_md5 !== before[0].helper_md5) &&
  typeof after[0].projector_md5 === 'string' && after[0].projector_md5.length === 32,
  'Legacy adoption schema readback failed');
console.log(JSON.stringify({ state: heldMode ? 'email_legacy_held_adoption_schema_installed' : 'email_legacy_adoption_schema_installed',
  environment: testMode ? 'TEST' : 'LIVE', project,
  migrationSha256, helperPresent: true, helperMd5: after[0].helper_md5,
  projectorMd5: after[0].projector_md5,
  existingInteractionsUpdated: 0, providerRequests: 0 }));
