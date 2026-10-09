/** Read-only catalog audit of the named existing TEST project. Never deploys,
 * bootstraps, changes grants, reads customer rows or fetches API key secrets.
 * Usage: LEARN_TEST_ALLOW_PROJECT_REF=saatxzwxvdvqevbnskxy node
 * scripts/verify/learn-test-readiness.mjs --existing-cli-login
 * Or supply SUPABASE_ACCESS_TOKEN through the existing secure environment.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { LAUNCH_METADATA_QUERY, assessLaunchMetadata } from './learn-launch-metadata-catalog.mjs';
export const TEST_PROJECT = 'saatxzwxvdvqevbnskxy';
export const TEST_ORGANIZATION = 'efqvhoxukklewruplpdp';

// This is the current release slice, not a claim to enumerate every dependency
// of ingestion, roster mutation or work transition. Keep in sync with readers.
export const READ_CONTRACT = {
  launch: {
    email_messages: 'id,tenant_id,created_at,raw_payload',
    phone_calls: 'id,tenant_id,created_at,provider_call_id,linked_id,direction,started_at,duration_seconds',
    phone_recordings: 'id,tenant_id,created_at,provider_call_id,linked_id',
    phone_transcripts: 'id,tenant_id,status',
    email_accounts: 'tenant_id,status',
    google_workspace_mailboxes: 'id,tenant_id,sync_enabled,status',
    email_sync_runs: 'tenant_id,status,sync_type,started_at,completed_at,records_processed,error_message',
    phone_sync_runs: 'tenant_id,status,sync_type,started_at,completed_at,records_processed,error_message',
  },
  cards: {
    customer_cards: 'id,tenant_id,title,summary,person_id,company_id,owner_id,updated_at',
    jobs: 'id,tenant_id,title,job_number,status,source_system,verified,updated_at',
    team_members: 'id,tenant_id,display_name,formal_role,org_unit_id,profile_id,confirmed_at,effective_to,updated_at',
    org_units: 'id,tenant_id,name',
    interactions: 'id,tenant_id,source_connector_id,source_type,source_table,source_id,occurred_at,subject,summary,body_preview,status,related_person_id,related_company_id,related_job_id',
    intelligence_objects: 'id,tenant_id,object_type,subject,status,deadline,responsible_ref,accountable_ref,waiting_on_ref,confidence,source_interactions,source_entities,attributes,created_at,updated_at',
    graph_nodes: 'id,tenant_id,source_table,source_id',
  },
};
export const REQUIRED_RPCS = [
  'learn_scorecard_save_draft', 'learn_scorecard_publish', 'learn_scorecard_policy_for_period',
  'learn_performance_review', 'learn_work_history_read', 'learn_member_history_read',
  'learn_work_handoffs_collect', 'learn_work_residence_collect', 'learn_slack_start_import',
];
export const TEST_LEDGER_QUERY = `select source_sha256,migration_name,project_ref,applied_at
 from of_test_deploy.migrations order by applied_at,migration_name limit 501`;

export const CATALOG_QUERY = `select jsonb_build_object(
 'observedAt',clock_timestamp(),
 'launchMetadata',(${LAUNCH_METADATA_QUERY}),
 'tables',(select coalesce(jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'name',c.relname,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
   'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
     'authenticatedSelect',pg_catalog.has_column_privilege('authenticated',c.oid,a.attnum,'SELECT')) order by a.attnum)
     from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
   'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.policyname,'roles',p.roles,'command',p.cmd,'using',p.qual,'check',p.with_check)),'[]')
     from pg_catalog.pg_policies p where p.schemaname=n.nspname and p.tablename=c.relname),
   'authenticatedSelect',pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT'),
   'anonSelect',pg_catalog.has_table_privilege('anon',c.oid,'SELECT')) order by n.nspname,c.relname),'[]')
   from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','of_test_deploy','supabase_migrations') and c.relkind in ('r','p')),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,
   'arguments',pg_catalog.pg_get_function_identity_arguments(p.oid),'securityDefiner',p.prosecdef,
   'authenticatedExecute',pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),
   'anonExecute',pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')) order by p.proname),'[]')
   from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
) as inventory`;

export function assessTestCatalog(inventory, functions) {
  if (!inventory || !Number.isFinite(Date.parse(inventory.observedAt)) || !Array.isArray(inventory.tables)
    || !Array.isArray(inventory.functions) || !Array.isArray(functions)) throw Error('Incomplete schema inventory');
  const names = new Set();
  for (const t of inventory.tables) {
    const key = `${t.schema}.${t.name}`;
    if (names.has(key) || !Array.isArray(t.columns) || !Array.isArray(t.policies)
      || typeof t.rls !== 'boolean' || typeof t.authenticatedSelect !== 'boolean') throw Error('Invalid table inventory');
    names.add(key);
  }
  const slices = {};
  for (const [slice, tables] of Object.entries(READ_CONTRACT)) {
    slices[slice] = Object.entries(tables).map(([name, raw]) => {
      const table = inventory.tables.find(t => t.schema === 'public' && t.name === name);
      if (!table) return { table: name, state: 'missing_table', missingColumns: raw.split(',') };
      const required = raw.split(',');
      const missingColumns = required.filter(c => !table.columns.some(v => v.name === c));
      // Column-level grants can legitimately satisfy a reader without granting
      // SELECT on full message/credential rows. Do not demand a broad table grant.
      const unreadableColumns = required.filter(c => !missingColumns.includes(c)
        && !table.authenticatedSelect && table.columns.find(v => v.name === c)?.authenticatedSelect !== true);
      const selectPolicyNames = table.policies.filter(p => ['SELECT', 'ALL'].includes(p.command)).map(p => p.name);
      return { table: name, state: missingColumns.length || unreadableColumns.length || !table.rls || !selectPolicyNames.length
        ? 'blocked' : 'needs_user_rls_verification', missingColumns, unreadableColumns,
        rls: table.rls, selectPolicyNames };
    });
  }
  const rpcs = REQUIRED_RPCS.map(name => ({ name, state: inventory.functions.some(f => f.name === name && f.authenticatedExecute === true)
    ? 'needs_signature_and_authority_verification' : 'missing_or_not_executable' }));
  const publicTables = inventory.tables.filter(t => t.schema === 'public');
  return {
    version: 'learn-test-readiness/2', projectRef: TEST_PROJECT, observedAt: inventory.observedAt,
    state: 'not_release_verified', publicTableCount: publicTables.length,
    rlsTableCount: publicTables.filter(t => t.rls).length,
    noPolicyTables: publicTables.filter(t => !t.policies.length).map(t => t.name),
    migrationLedgers: inventory.tables.filter(t => t.schema !== 'public').map(t => `${t.schema}.${t.name}`),
    edgeFunctions: functions.map(f => ({ name: f.slug, status: f.status, verifyJwt: f.verify_jwt ?? null })),
    launchFunctionPresent: functions.some(f => f.slug === 'learn-launch-status'), slices, rpcs,
    launchMetadata: assessLaunchMetadata(inventory.launchMetadata, READ_CONTRACT.launch),
    limitations: [
      'Catalog presence, grants and policy names do not prove ordinary-user access or tenant isolation.',
      'Policy roles/expressions, column types, function signatures, transitive dependencies and current migration ledgers need review.',
      'No customer rows, source completeness, backups, restore, OAuth consent or provider traffic are tested.',
      'Optional voicemail reads and the rest of the full application are outside this minimum read contract.',
      'This audit cannot authorize deployment or changes to grants/policies; no schema changes are performed.',
    ],
  };
}

export async function readTestCatalog({ allowProjectRef, token, fetcher = fetch }) {
  if (allowProjectRef !== TEST_PROJECT || typeof token !== 'string' || !/^sbp_(?:oauth_)?[a-f\d]{40}$/i.test(token))
    throw Error('Explicit TEST allowlist and existing management login required');
  async function request(path, query) {
    let response;
    try {
      response = await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}${path}`, {
        method: query ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(query ? { body: JSON.stringify({ query }) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw Error();
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > 8 * 1024 * 1024) throw Error();
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw Error(`TEST metadata read failed${response ? ` (HTTP ${response.status})` : ''}; response withheld`); }
  }
  const project = await request('');
  if (project.id !== TEST_PROJECT || project.organization_id !== TEST_ORGANIZATION || project.status !== 'ACTIVE_HEALTHY')
    throw Error('TEST identity or health does not match the intended existing environment');
  const rows = await request('/database/query/read-only', CATALOG_QUERY);
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.inventory) throw Error('Catalog result shape differs');
  const functions = await request('/functions');
  if (!Array.isArray(functions) || functions.some(f => !f || typeof f.slug !== 'string' || typeof f.status !== 'string'))
    throw Error('Function inventory could not be verified');
  const inventory = rows[0].inventory;
  const report = assessTestCatalog(inventory, functions);
  const ledger = inventory.tables.find(t => t.schema === 'of_test_deploy' && t.name === 'migrations');
  if (ledger && ['source_sha256','migration_name','project_ref','applied_at'].every(c => ledger.columns.some(v => v.name === c))) {
    const entries = await request('/database/query/read-only', TEST_LEDGER_QUERY);
    if (!Array.isArray(entries) || entries.length > 500 || entries.some(e => e.project_ref !== TEST_PROJECT
      || typeof e.migration_name !== 'string' || !/^[a-f\d]{64}$/i.test(e.source_sha256 ?? '') || !Number.isFinite(Date.parse(e.applied_at))))
      throw Error('TEST migration ledger could not be verified');
    report.customMigrationEntries = entries;
  } else report.customMigrationEntries = null;
  return { inventory, functions, report };
}

export function savedCliToken() {
  for (const account of ['supabase', 'access-token']) {
    try {
      const token = execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'Supabase CLI', '-a', account, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim();
      if (/^sbp_(?:oauth_)?[a-f\d]{40}$/i.test(token)) return token;
    } catch { /* No raw credential-tool output. */ }
  }
  throw Error('Existing Supabase CLI login is unavailable');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).some(a => a !== '--existing-cli-login')) throw Error('Unsupported audit option');
    if (process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT) throw Error('Explicit TEST allowlist required');
    const token = process.env.SUPABASE_ACCESS_TOKEN || (process.argv.includes('--existing-cli-login') ? savedCliToken() : null);
    const { report } = await readTestCatalog({ allowProjectRef: process.env.LEARN_TEST_ALLOW_PROJECT_REF, token });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
