/** One-shot exact LIVE migration install; the review RPC remains read-only. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { savedCliToken } from './learn-test-readiness.mjs';
import { assess, readOnly, triageRelease } from './new-dawn-open-identity-triage-readback.mjs';

const { project, version, name, baseline, routine, sourceHash } = triageRelease;
const sourcePath = new URL('../../supabase/migrations/20261113040000_new_dawn_open_identity_triage.sql', import.meta.url);
const literal = value => `'${value.replaceAll("'", "''")}'`;

export function exactSource() {
  const source = readFileSync(sourcePath, 'utf8');
  const hash = createHash('sha256').update(source).digest('hex');
  if (hash !== sourceHash || !/\nbegin;\s*\n/i.test(source) ||
    !/\ncommit;\s*$/i.test(source)) throw Error('identity_triage_source_changed');
  const body = source.slice(source.indexOf('\nbegin;') + 8, source.lastIndexOf('\ncommit;'));
  if (/^\s*(?:begin|commit);\s*$/im.test(body))
    throw Error('identity_triage_nested_transaction');
  return { source, body };
}

export function releaseSql() {
  const { source, body } = exactSource();
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='40s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations
  where version::text='${version}')
  or encode(sha256(convert_to(pg_get_functiondef('${routine}'::regprocedure),'UTF8')),'hex')<>'${baseline}'
  or to_regclass('public.new_dawn_commusoft_current_job_source') is null
  or not exists(select 1 from public.feature_flags
   where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
    and flag='new_dawn.m2_link_review_queue' and value='true'::jsonb)
  or not has_function_privilege('authenticated','${routine}','EXECUTE')
  or has_function_privilege('anon','${routine}','EXECUTE')
  or has_function_privilege('service_role','${routine}','EXECUTE')
 then raise exception 'identity_triage_release_state_changed';end if;
end $gate$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${version}','${name}',array[${literal(source)}]);
select '${version}' installed_version;
commit;`;
}

async function writeOnce(query, token = savedCliToken(), fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw Error(`identity_triage_release_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 100_000) throw Error('identity_triage_release_response_too_large');
  return JSON.parse(bytes.toString('utf8'));
}

export async function installLive(token = savedCliToken(), fetcher = fetch) {
  exactSource();
  if (assess(await readOnly(token, fetcher)).state !== 'triage_reader_ready')
    throw Error('identity_triage_already_installed');
  let acknowledged = false;
  try {
    const rows = await writeOnce(releaseSql(), token, fetcher);
    acknowledged = Array.isArray(rows) &&
      rows.some(row => row?.installed_version === version);
  } catch { /* Unknown acknowledgement: read back; never replay blindly. */ }
  const result = assess(await readOnly(token, fetcher));
  if (result.state !== 'triage_reader_installed')
    throw Error('identity_triage_install_unconfirmed');
  return { ...result, acknowledged };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--live-read-only')
      console.log(JSON.stringify(assess(await readOnly())));
    else if (args.length === 3 && args[0] === '--live-install-exact' &&
      args[1] === '--sha' && args[2] === sourceHash &&
      process.env.NEW_DAWN_IDENTITY_TRIAGE_PROJECT === project)
      console.log(JSON.stringify(await installLive()));
    else throw Error('identity_triage_exact_scope_required');
  } catch (error) {
    console.error(JSON.stringify({ state: 'identity_triage_release_stopped',
      reason: error instanceof Error ? error.message : 'unknown' }));
    process.exitCode = 1;
  }
}
