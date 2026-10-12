/** Assemble production-specific operator/customer-context SQL from pinned sources. No deployment. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = path => readFileSync(path, 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const sources = [
  { path: 'supabase/migrations/20261101500000_openfolk_client_information.sql', sha256: '43fcdd47a25f102b62ae0fbc01ff991613be2eaef93c9cf8d874846023bae86c' },
  { path: 'supabase/migrations/20261101510000_openfolk_business_review.sql', sha256: 'd0228be8d72a04bef8e5d64db705b0cc96bc745916462f437192b436921ab5f9' },
  { path: 'supabase/migrations/20261101520000_learn_customer_business_context.sql', sha256: '4ffe78cc25aeaf33dc0fef4078af1fa3b59bfcc991392a0d8bf4b6cb4699df90' },
  { path: 'supabase/migrations/20261101530000_learn_operator_phone_playback.sql', sha256: '840b9166926bedaadc5e3df78a9955a6c0ad5cba7e17ea858fcc2195fc13f0b1' },
];
for (const source of sources) if (hash(read(source.path)) !== source.sha256) throw Error('Operator source pin differs');
const directory = '.verification-results/production-operator-baseline-v1/';
const baseline = JSON.parse(read(directory + 'schema.json'));
const report = JSON.parse(read(directory + 'report.json'));
const prior = JSON.parse(read('supabase/release/learn-production/014_microsoft_capture.manifest.json'));
if (report.state !== 'offline_operator_prerequisites_inspected' || !report.containerRemoved ||
    JSON.stringify(report.archive) !== JSON.stringify(prior.baselineArchive) ||
    report.packages.length !== 14 || report.packages.at(-1).sha256 !== prior.sha256)
  throw Error('Exact operator prerequisite baseline unavailable');
const body = sources.map(source => '-- INPUT ' + source.path + '\n' +
  read(source.path).replace(/^begin;\s*$/gmi, '').replace(/^commit;\s*$/gmi, '')).join('\n');
const newFunctions = [...body.matchAll(/^create function public\.(\w+)\(/gm)].map(m => m[1]);
const changedFunctions = ['learn_business_input_review_access', 'learn_commusoft_review_customer',
  'learn_commusoft_work_batch', 'learn_commusoft_work_batch_result'];
if (newFunctions.length !== 6 || baseline.functions.some(f => newFunctions.includes(f.name)) ||
    changedFunctions.some(name => !baseline.functions.some(f => f.name === name)))
  throw Error('Operator function baseline differs');
const referenced = name => new RegExp('\\b' + name + '\\b').test(body);
const tables = baseline.tables.filter(t => referenced(t.name)).sort((a, b) => a.name.localeCompare(b.name));
const helpers = baseline.functions.filter(f => referenced(f.name));
const helperNames = [...new Set(helpers.map(f => f.name))];
const inventory = read('scripts/verify/learn-release-schema-inventory.sql').trim().replace(/;$/, '');
const sql = `-- DRAFT: requires matched frontend/audio endpoint and explicit production approval.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;actual_views jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production operator target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_microsoft_capture_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then raise exception 'Pinned production operator prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_operator_context_v1')
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${newFunctions.map(quote).join(',')}])) then raise exception 'Production operator candidate already exists; inspect before retry';end if;
 select jsonb_agg(t order by t->>'name') into observed from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array[${tables.map(t => quote(t.name)).join(',')}]);
 if observed is distinct from ${quote(JSON.stringify(tables))}::jsonb then raise exception 'Production operator table baseline differs';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into actual_helpers from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array[${helperNames.map(quote).join(',')}]);
 if actual_helpers is distinct from ${quote(JSON.stringify(helpers))}::jsonb then raise exception 'Production operator helper baseline differs';end if;
 select inventory->'views' into actual_views from (${inventory}) q;
 if actual_views is distinct from ${quote(JSON.stringify(baseline.views))}::jsonb then raise exception 'Production operator view baseline differs';end if;
end$$;
${body}
insert into of_learn_deploy.migrations values('learn_operator_context_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const out = 'supabase/release/learn-production/015_operator_context';
writeFileSync(out + '.sql', sql);
writeFileSync(out + '.manifest.json', JSON.stringify({ version: 'learn-production-operator-context/1',
  status: 'draft_requires_rehearsal_and_production_approval', projectRef: 'tgbnakbxwcqjeimygroz',
  sha256: hash(sql), priorSha256: prior.sha256, baselineArchive: prior.baselineArchive, sources,
  existingTables: tables.map(t => t.name), newTables: [], newFunctions, changedFunctions, changedViews: [],
  newRole: null, newSequences: [], extendedTables: {}, newExistingConstraints: {}, newExistingIndexes: {},
  newExistingTriggers: {}, newExistingPolicies: {}, newStoragePolicies: {}, newBuckets: [],
  limitations: [
    'No users, operator grants, source projections, credential copies, capture or schedules are created on installation.',
    'Adds audited selected-client information, existing-grant business review, linked customer context and operator recording authorization.',
    'Keeps ordinary client authority and all source records unchanged; operator reads require an existing effective admin grant and a reason.',
    'Requires matching frontend and operator-audio endpoint, current production baseline verification and signed-in real-data acceptance.',
    'Does not complete whole-account publication, summaries, scoring or remaining connector coverage.'
  ] }, null, 2) + '\n');
console.log(JSON.stringify({ sha256: hash(sql), newFunctions, changedFunctions, tables: tables.length }));
