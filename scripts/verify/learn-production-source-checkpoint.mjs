/** Single-statement source fingerprints. No message text, recording paths,
 * tokens or customer identifiers leave the database. Not a recovery backup. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { savedCliToken } from './learn-test-readiness.mjs';
const project = 'tgbnakbxwcqjeimygroz', output = process.argv[2];
if (process.env.LEARN_PRODUCTION_READ_ONLY_PROJECT !== project || !/^\.verification-results\/production-[a-z0-9-]+\.json$/.test(output ?? '')) throw Error('Explicit read-only production scope required');
const baselinePath = '.verification-results/production-release-readonly-20261012/schema.json';
const schema = JSON.parse(readFileSync(baselinePath));
const names = ['email_messages', 'email_threads', 'email_attachments', 'email_ai_insights', 'email_accounts', 'email_oauth_tokens',
  'phone_calls', 'phone_recordings', 'phone_transcripts', 'phone_ai_insights', 'phone_accounts', 'phone_endpoints',
  'receptionist_voicemails', 'interactions', 'customer_cards', 'jobs', 'people', 'companies', 'sites',
  'contact_points', 'contact_relationships', 'contact_suppressions', 'contact_tag_assignments', 'team_members',
  'profiles', 'tenants', 'authority_grants'];
const ident = name => { if (!/^[a-z][a-z0-9_]*$/.test(name)) throw Error('Unexpected schema identifier'); return '"' + name + '"'; };
const tables = names.map(name => {
  const table = schema.tables.find(t => t.name === name);
  if (!table?.columns.length) throw Error('Source baseline table missing: ' + name);
  return { name, columns: table.columns.map(c => c.name) };
});
const selects = tables.map(t => `select '${t.name}' source,count(*)::bigint rows,
  md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text)),'')) fingerprint
  from (select ${t.columns.map(ident).join(',')} from public.${ident(t.name)}) r`);
selects.push("select 'storage.objects' source,count(*)::bigint rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text)),'')) fingerprint from (select id,bucket_id,name,metadata,created_at,updated_at,version from storage.objects) r");
const query = `begin transaction isolation level repeatable read read only;set local statement_timeout='90s';
 select jsonb_build_object('observedAt',statement_timestamp(),'sources',(select jsonb_agg(to_jsonb(x) order by source) from (${selects.join('\nunion all\n')}) x),
 'recordingReferences',(select jsonb_build_object('recordings',count(*),'missingObjects',count(*) filter(where o.id is null)) from public.phone_recordings r left join storage.objects o on o.bucket_id='phone-recordings' and o.name=r.storage_path),
 'schedules',(select jsonb_agg(jsonb_build_object('id',jobid,'active',active,'commandHash',md5(command)) order by jobid) from cron.job),
 'roles',(select jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,'canLogin',rolcanlogin,'bypassRls',rolbypassrls) order by rolname) from pg_roles)) checkpoint;commit;`;
const r = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(100000),
  headers: { Authorization: 'Bearer ' + savedCliToken(), 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
});
if (!r.ok) throw Error('Source checkpoint unavailable (HTTP ' + r.status + ')');
const rows = await r.json(), data = rows[0]?.checkpoint;
if (rows.length !== 1 || data?.sources?.length !== names.length + 1 || data.sources.some(s => !Number.isSafeInteger(s.rows) || !/^[a-f0-9]{32}$/.test(s.fingerprint))) throw Error('Incomplete source checkpoint');
const result = { version: 'learn-production-source-checkpoint/1', projectRef: project, state: 'source_fingerprints_captured', ...data,
  schemaBaselineSha256: createHash('sha256').update(readFileSync(baselinePath)).digest('hex'), columns: tables,
  productionWrites: false, privateSourceValuesReturned: false,
  limitations: ['One consistent statement snapshot of the listed source tables and storage metadata, not all database tables or audio bytes.', 'Original column projection permits comparison after additive schema changes. This is preservation evidence, not a backup.'] };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ state: result.state, sources: data.sources.length, rows: data.sources.reduce((n,s) => n + s.rows, 0), recordingReferences: data.recordingReferences, observedAt: data.observedAt }));
