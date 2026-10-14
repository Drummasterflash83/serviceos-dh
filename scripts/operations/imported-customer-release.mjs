/** Add the reviewed-only customer catalogue and native source detail readers.
 * The two SQL files install atomically; neither imports nor links records. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { savedCliToken } from '../verify/learn-test-readiness.mjs';

const [mode, project] = process.argv.slice(2);
if (!['plan', 'apply', 'verify'].includes(mode) || !['saatxzwxvdvqevbnskxy', 'tgbnakbxwcqjeimygroz'].includes(project))
  throw Error('Explicit mode and known TEST or LIVE project required');
const dir = `.verification-results/imported-customer-release-${project}`;
mkdirSync(dir, { recursive: true });
const files = [
  'supabase/migrations/20261102250000_learn_imported_customer_catalog.sql',
  'supabase/migrations/20261102260000_learn_imported_customer_details.sql',
];
const sources = files.map(f => readFileSync(f, 'utf8'));
const hash = createHash('sha256').update(sources.join('\n')).digest('hex');
const required = ['learn_business_customer_summary', 'learn_quickbooks_customer_identity', 'learn_quickbooks_money', 'learn_quickbooks_retained_finance_access'];
const added = ['learn_imported_source_text', 'learn_imported_customer_sources', 'learn_imported_business_records', 'learn_imported_customer_catalog', 'learn_imported_customer_detail'];
const token = savedCliToken();
async function query(sql, readonly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readonly ? '/read-only' : ''}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw Error(`Database request ${response.status}; inspect release state before retry`);
  return response.json();
}
const catalogSql = `select jsonb_build_object(
 'existing',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'signature',p.oid::regprocedure::text,'hash',md5(pg_get_functiondef(p.oid)),'acl',p.proacl::text,'owner',p.proowner::regrole::text) order by p.oid::regprocedure::text),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${required.map(x=>`'${x}'`).join(',')})),
 'new',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'signature',p.oid::regprocedure::text,'hash',md5(p.prosrc),'definer',p.prosecdef,'config',p.proconfig,'owner',p.proowner::regrole::text,'anon',has_function_privilege('anon',p.oid,'execute'),'authenticated',has_function_privilege('authenticated',p.oid,'execute'),'service',has_function_privilege('service_role',p.oid,'execute')) order by p.proname),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${added.map(x=>`'${x}'`).join(',')})),
 'tables',(select coalesce(jsonb_agg(x.name order by x.name),'[]'::jsonb) from (select relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('learn_business_input_versions','learn_business_input_observations','learn_business_input_pages','learn_business_input_links','learn_quickbooks_latest','learn_quickbooks_source_versions','learn_quickbooks_customer_links','learn_quickbooks_finance_events','customer_cards')) x)
) evidence`;
async function catalog() { return (await query(catalogSql))[0].evidence; }
const current = await catalog();
const planFile = `${dir}/plan.json`, intentFile = `${dir}/intent.json`;
if (mode === 'plan') {
  if (existsSync(planFile) || current.new.length || current.tables.length !== 9 || required.some(name => !current.existing.some(x => x.name === name)))
    throw Error('Source schema changed or release already prepared; inspect state');
  writeFileSync(planFile, JSON.stringify({ project, hash, before: current, scope: 'Add authenticated admin/support read-only catalogue and source details; no provider or source writes' }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ project, state: 'prepared', hash, dependencies: current.existing.length, tables: current.tables.length }));
} else {
  const plan = JSON.parse(readFileSync(planFile, 'utf8'));
  if (plan.project !== project || plan.hash !== hash || JSON.stringify(current.existing) !== JSON.stringify(plan.before.existing) || JSON.stringify(current.tables) !== JSON.stringify(plan.before.tables))
    throw Error('Source schema or release files changed; inspect before proceeding');
  if (mode === 'apply') {
    if (current.new.length || existsSync(intentFile)) throw Error('Release already attempted; verify state instead of replaying');
    const body = sources.map(sql => {
      const start = sql.indexOf('begin;');
      if (start < 0 || !sql.slice(0, start).trim().split('\n').every(line => line.trim().startsWith('--')) || !/\scommit;\s*$/i.test(sql))
        throw Error('Migration transaction boundary changed');
      return sql.slice(start + 'begin;'.length).replace(/\scommit;\s*$/i, '');
    }).join('\n');
    writeFileSync(intentFile, JSON.stringify({ project, hash, startedAt: new Date().toISOString() }), { flag: 'wx' });
    await query(`begin;\n${body}\ncommit;`, false);
  }
  const after = await catalog();
  if (JSON.stringify(after.existing) !== JSON.stringify(plan.before.existing) || after.new.length !== added.length || added.some(name => !after.new.some(x => x.name === name)))
    throw Error('Hosted readers or existing dependencies differ');
  for (const row of after.new) {
    const entry = row.name === 'learn_imported_customer_catalog' || row.name === 'learn_imported_customer_detail';
    if (row.definer !== entry || row.anon || row.service || row.authenticated !== entry || !row.config?.includes('search_path=pg_catalog'))
      throw Error(`Reader permissions differ: ${row.name}`);
  }
  const actualSources = await query(`select p.proname name,p.prosrc body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${added.map(x=>`'${x}'`).join(',')}) order by p.proname`);
  const expectedBodies = [...sources.join('\n').matchAll(/create function public\.([a-z_]+)\([\s\S]*?\bas \$\$([\s\S]*?)\$\$;/gi)];
  if (expectedBodies.length !== added.length || actualSources.some(row => !expectedBodies.some(match => match[1] === row.name && match[2].trim() === row.body.trim())))
    throw Error('Hosted function bodies differ from prepared migrations');
  writeFileSync(`${dir}/verified.json`, JSON.stringify({ project, hash, checkedAt: new Date().toISOString(), existingDependenciesPreserved: true, fiveBodiesVerified: true, onlyAuthenticatedPublicReaders: true, providerRequests: 0, importedRecordsChanged: 0 }, null, 2) + '\n');
  console.log(JSON.stringify({ project, state: 'verified', readers: after.new.length, existingDependenciesPreserved: true, permissionsVerified: true }));
}
