/** Prepare/verify an inert production SQL artifact. There is deliberately no install command. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const project = 'tgbnakbxwcqjeimygroz';
export const files = [
  '20261102000000_learn_quickbooks_oauth.sql',
  '20261102010000_learn_quickbooks_import.sql',
  '20261102020000_learn_quickbooks_customer_finance.sql',
  '20261102030000_learn_quickbooks_disconnect.sql',
];
const signatures = [
  'public.learn_operator_input_immutable()', 'public.learn_operator_input_access(uuid,uuid,boolean)',
  'public.current_user_is_openfolk_operator(text)', 'public.provider_secret_name(uuid,text,text)',
  'public.provider_secret_store(uuid,text,text,text)', 'vault.create_secret(text,text,text,uuid)',
  'vault.update_secret(uuid,text,text,text,uuid)', 'auth.uid()', 'auth.role()',
  'public.learn_import_batch_authority(uuid,uuid)',
];
const requiredColumns = {
  'public.tenants': { id: 'uuid', status: 'text' },
  'public.profiles': { id: 'uuid', tenant_id: 'uuid', role: 'text' },
  'public.customer_cards': { id: 'uuid', tenant_id: 'uuid' },
  'public.platform_authority_grants': { profile_id: 'uuid', permission: 'text', effective_from: 'timestamp with time zone', effective_to: 'timestamp with time zone' },
  'public.view_as_context': { actor_user_id: 'uuid', ended_at: 'timestamp with time zone', expires_at: 'timestamp with time zone' },
  'public.feature_flags': { tenant_id: 'uuid', flag: 'text', value: 'jsonb' },
  'auth.users': { id: 'uuid', deleted_at: 'timestamp with time zone', banned_until: 'timestamp with time zone' },
  'vault.decrypted_secrets': { id: 'uuid', name: 'text', decrypted_secret: 'text' },
};
const sha = text => createHash('sha256').update(text).digest('hex');
const quote = text => "'" + String(text).replaceAll("'", "''") + "'";
const root = new URL('../../', import.meta.url);
const directory = new URL('supabase/release/quickbooks-production/', root);
export function buildPackage(catalog, sources, now = Date.now()) {
  if (catalog.project !== project || !Number.isFinite(Date.parse(catalog.checkedAt)) ||
      now - Date.parse(catalog.checkedAt) > 3600000 || Date.parse(catalog.checkedAt) > now + 60000)
    throw Error('Production catalog must be current and target the exact project');
  if (!Array.isArray(catalog.existingQuickBooksObjects) || catalog.existingQuickBooksObjects.length ||
      !Array.isArray(catalog.functions) || catalog.functions.length !== signatures.length)
    throw Error('Production catalog is incomplete or QuickBooks is already present');
  const helpers = signatures.map(signature => {
    const matches = catalog.functions.filter(f => f.signature === signature);
    if (matches.length !== 1) throw Error('Production helper missing or duplicated');
    const f = matches[0];
    if (f.exists !== true || !/^[a-f0-9]{32}$/.test(f.bodyHash) || typeof f.owner !== 'string' || !f.owner ||
        typeof f.securityDefiner !== 'boolean' || typeof f.authenticatedExecute !== 'boolean' ||
        typeof f.serviceExecute !== 'boolean' || !(f.settings === null ||
          (Array.isArray(f.settings) && f.settings.every(s => typeof s === 'string'))))
      throw Error('Production helper metadata incomplete');
    return f;
  });
  const columns = [];
  for (const [relation, expected] of Object.entries(requiredColumns)) {
    const tables = catalog.tables?.filter(t => t.schema + '.' + t.name === relation);
    if (tables?.length !== 1) throw Error('Production prerequisite relation missing or duplicated');
    for (const [name, type] of Object.entries(expected)) {
      const matches = tables[0].columns?.filter(c => c.name === name && c.type === type);
      if (matches?.length !== 1) throw Error('Production prerequisite column differs');
      columns.push({ relation, name, type });
    }
  }
  if (!Array.isArray(sources) || sources.length !== files.length) throw Error('Expected four migration sources');
  const bodies = sources.map(source => {
    if ((source.match(/^begin;$/gm) || []).length !== 1 || (source.match(/^commit;$/gm) || []).length !== 1 ||
        !/commit;\s*$/.test(source)) throw Error('Migration transaction boundaries changed');
    return source.replace(/^begin;$/m, '').replace(/^commit;$/m, '');
  });
  const sourceHashes = files.map((name, index) => ({ name, sha256: sha(sources[index]) }));
  const guard = helpers.map(f => `if not exists(select 1 from pg_proc where oid=to_regprocedure(${quote(f.signature)}) and md5(prosrc)=${quote(f.bodyHash)} and pg_get_userbyid(proowner)=${quote(f.owner)} and prosecdef=${f.securityDefiner} and to_jsonb(proconfig) is not distinct from ${f.settings === null ? 'null::jsonb' : quote(JSON.stringify(f.settings)) + '::jsonb'} and has_function_privilege('authenticated',oid,'execute')=${f.authenticatedExecute} and has_function_privilege('service_role',oid,'execute')=${f.serviceExecute}) then raise exception 'QuickBooks production helper changed';end if;`).join('\n') + '\n' +
    columns.map(c => `if not exists(select 1 from pg_attribute where attrelid=to_regclass(${quote(c.relation)}) and attname=${quote(c.name)} and not attisdropped and format_type(atttypid,atttypmod)=${quote(c.type)}) then raise exception 'QuickBooks production column changed';end if;`).join('\n');
  const bundle = `-- Prepared production artifact; NOT INSTALLED. No credentials, grants, data or capture seeded.
-- The target setting is an operator guard, not cryptographic proof of the database identity.
begin;
set local lock_timeout='5s';
set local statement_timeout='40s';
do $guard$ begin
if current_setting('serviceos.quickbooks_target',true) is distinct from '${project}' then raise exception 'QuickBooks production target required';end if;
${guard}
if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'learn_quickbooks_%') or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'learn_quickbooks_%') then raise exception 'QuickBooks production objects already exist';end if;
end $guard$;
${bodies.join('\n')}
create table public.learn_quickbooks_release_receipts(release_id text primary key,source_hashes jsonb not null,installed_at timestamptz not null default clock_timestamp());
alter table public.learn_quickbooks_release_receipts enable row level security;
revoke all on public.learn_quickbooks_release_receipts from public,anon,authenticated,service_role;
insert into public.learn_quickbooks_release_receipts(release_id,source_hashes) values('quickbooks_production_v1',${quote(JSON.stringify(sourceHashes))}::jsonb);
notify pgrst,'reload schema';
commit;
`;
  return { bundle, manifest: { project, release: 'quickbooks_production_v1', status: 'prepared_not_installed', preparedAt: new Date(now).toISOString(), catalogCheckedAt: catalog.checkedAt, sourceHashes, bundleSha256: sha(bundle), helpers, columns,
    effects: ['Add QuickBooks tables, guarded RPCs and a private release receipt.', 'Use existing authenticated authority; create no user or operator grants.', 'Seed no apps, credentials, connections, source records, flags, imports or schedules.'],
    outstanding: ['Real sandbox provider lifecycle acceptance.', 'Rehearse this exact package against a current isolated production-schema clone.', 'Refresh production metadata immediately before any installation.', 'Verify recovery/preservation and matching runtime/frontend before promotion.', 'Production Intuit access, exact callback, credential storage and company consent.'] } };
}
async function main() {
  const phase = process.argv[2];
  if (!['prepare', 'verify'].includes(phase) || process.argv.length !== 3) throw Error('Specify prepare or verify; this tool cannot install');
  const sources = files.map(name => readFileSync(new URL('supabase/migrations/' + name, root), 'utf8'));
  if (phase === 'prepare') {
    const { savedCliToken } = await import('./learn-test-readiness.mjs');
    const token = savedCliToken();
    const query = readFileSync(new URL('./learn-quickbooks-preflight.sql', import.meta.url), 'utf8')
      .replace("('auth.uid()'),('auth.role()')", "('auth.uid()'),('auth.role()'),('public.learn_import_batch_authority(uuid,uuid)')")
      .replace("'view_as_context','feature_flags'", "'view_as_context','feature_flags','customer_cards'");
    const r = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }), redirect: 'error', signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) throw Error('Production catalog read unavailable');
    const chunks = []; let size = 0;
    for await (const chunk of r.body) { size += chunk.byteLength; if (size > 1048576) throw Error('Production catalog too large'); chunks.push(chunk); }
    const rows = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(rows) || rows.length !== 1) throw Error('Production catalog incomplete');
    const result = buildPackage({ ...Object.values(rows[0])[0], project }, sources);
    mkdirSync(directory, { recursive: true });
    writeFileSync(new URL('001_quickbooks.sql', directory), result.bundle);
    writeFileSync(new URL('001_quickbooks.manifest.json', directory), JSON.stringify(result.manifest, null, 2) + '\n');
    console.log(JSON.stringify({ state: 'prepared_not_installed', project, bundleSha256: result.manifest.bundleSha256, migrations: files.length, helpers: result.manifest.helpers.length, productionChanges: 0, providerRequests: 0 }));
  } else {
    const manifest = JSON.parse(readFileSync(new URL('001_quickbooks.manifest.json', directory), 'utf8'));
    const bundle = readFileSync(new URL('001_quickbooks.sql', directory), 'utf8');
    if (manifest.project !== project || manifest.release !== 'quickbooks_production_v1' || sha(bundle) !== manifest.bundleSha256 ||
        manifest.sourceHashes?.length !== files.length || files.some((name, i) => manifest.sourceHashes[i]?.name !== name || manifest.sourceHashes[i]?.sha256 !== sha(sources[i])))
      throw Error('Production artifact or source differs');
    console.log(JSON.stringify({ state: 'local_artifact_hashes_verified', project, bundleSha256: manifest.bundleSha256, productionChanges: 0, providerRequests: 0, limitation: 'Not a hosted catalog recheck or installation rehearsal' }));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('QuickBooks production package unconfirmed; no installation action is available.'); process.exitCode = 1; });
}
