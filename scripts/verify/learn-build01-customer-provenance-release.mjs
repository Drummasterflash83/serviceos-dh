/** TEST-first release of the bounded customer-card source reader.
 *
 * Requires an existing management token in the invoking process environment.
 * Never opens Keychain or asks for 1Password. Does not fetch customer rows.
 * Each write attempt is recorded before submission; reconcile an uncertain
 * attempt from the catalog instead of rerunning it.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

const projects = { test: 'saatxzwxvdvqevbnskxy', live: 'tgbnakbxwcqjeimygroz' };
const [environment, phase] = process.argv.slice(2);
const allowed = ['prepare', 'rehearse', 'install', 'verify'];
if (process.argv.length !== 4 || !Object.hasOwn(projects, environment) || !allowed.includes(phase))
  throw Error('Usage: customer-provenance-release.mjs test|live prepare|rehearse|install|verify');
const project = projects[environment];
const sourcePath = 'supabase/migrations/20261104080000_learn_customer_card_provenance.sql';
const source = await readFile(sourcePath, 'utf8');
const digest = createHash('sha256').update(source).digest('hex');
if (digest !== 'c1c13bec8bc879a0ffe9f78e8c8b79fe58db0800c142f9f3123b656deb8ffd1a')
  throw Error('Reviewed customer provenance migration source changed');
const comment = `serviceos:learn-customer-card-provenance/1:${digest}`;
const directory = `.verification-results/learn-build01-customer-provenance-${environment}`;
await mkdir(directory, { recursive: true, mode: 0o700 });
const quoted = value => `'${value.replaceAll("'", "''")}'`;
const functionSignature = 'public.learn_customer_card_provenance(uuid,uuid[])';

if (phase === 'prepare') {
  console.log(JSON.stringify({ state: 'prepared_locally', environment, project,
    sourceSha256: digest, noHostedRequest: true }));
  process.exit(0);
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (typeof token !== 'string' || !/^sbp_(?:oauth_)?[a-f\d]{40}$/i.test(token))
  throw Error('Existing Supabase management token required in this process; no credential prompt attempted');
const endpoint = `https://api.supabase.com/v1/projects/${project}`;
async function api(path, query, write = false) {
  let response;
  try {
    response = await fetch(endpoint + path, {
      method: query === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(query === undefined ? {} : { body: JSON.stringify({ query, ...(write ? { read_only: false } : {}) }) }),
      redirect: 'error', signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw Error();
    const body = await response.json();
    if (query !== undefined && !Array.isArray(body)) throw Error();
    return body;
  } catch {
    throw Error(`Customer provenance ${write ? 'write outcome uncertain' : 'read unavailable'} (${response?.status ?? 'network'}); raw response withheld`);
  }
}
const projectInfo = await api('');
if (projectInfo?.id !== project || projectInfo?.status !== 'ACTIVE_HEALTHY')
  throw Error('Hosted project identity or health differs');

const catalogQuery = `select jsonb_build_object(
  'functionPresent',to_regprocedure(${quoted(functionSignature)}) is not null,
  'function',(select jsonb_build_object('owner',pg_get_userbyid(p.proowner),
    'definer',p.prosecdef,'searchPath',p.proconfig,
    'authenticatedExecute',has_function_privilege('authenticated',p.oid,'execute'),
    'anonExecute',has_function_privilege('anon',p.oid,'execute'),
    'comment',obj_description(p.oid,'pg_proc'))
   from pg_proc p where p.oid=to_regprocedure(${quoted(functionSignature)})),
  'index',(select jsonb_build_object('valid',i.indisvalid,'ready',i.indisready,
    'definition',pg_get_indexdef(i.indexrelid)) from pg_index i
   where i.indexrelid=to_regclass('public.learn_business_input_customer_card_lookup')),
  'sourceLinksPresent',to_regclass('public.learn_business_input_links') is not null,
  'quickbooksLinksPresent',to_regclass('public.learn_quickbooks_customer_links') is not null,
  'cardsPresent',to_regclass('public.customer_cards') is not null,
  'sourceLinksAuthenticatedSelect',has_table_privilege('authenticated',
    'public.learn_business_input_links','select')
) as audit`;
async function catalog() {
  const rows = await api('/database/query/read-only', catalogQuery);
  if (rows.length !== 1 || !rows[0]?.audit) throw Error('Hosted catalog shape differs');
  return rows[0].audit;
}
const expectedIndex = 'ON public.learn_business_input_links USING btree (tenant_id, card_id) WHERE ((entity_kind = \'customer\'::text) AND (card_id IS NOT NULL))';
const installed = audit => audit.functionPresent === true
  && audit.function?.owner === 'postgres' && audit.function?.definer === true
  && JSON.stringify(audit.function?.searchPath) === JSON.stringify(['search_path=pg_catalog'])
  && audit.function?.authenticatedExecute === true && audit.function?.anonExecute === false
  && audit.function?.comment === comment && audit.index?.valid === true
  && audit.index?.ready === true && audit.index?.definition?.includes(expectedIndex)
  && audit.sourceLinksAuthenticatedSelect === false;
const absent = audit => audit.functionPresent === false && audit.index === null
  && audit.sourceLinksPresent && audit.quickbooksLinksPresent && audit.cardsPresent
  && audit.sourceLinksAuthenticatedSelect === false;

const before = await catalog();
if (phase === 'verify') {
  if (!installed(before)) throw Error('Hosted reader, index or access does not match the reviewed release');
  console.log(JSON.stringify({ state: 'installed_verified', environment, project, sourceSha256: digest,
    observedAt: new Date().toISOString(), noCustomerRowsRead: true }));
  process.exit(0);
}
if (!absent(before)) throw Error('Hosted prerequisites differ or release already exists; inspect before submission');
if (phase === 'install') {
  const entries = await readdir(directory);
  const rehearsals = [];
  for (const filename of entries.filter(name => /^rehearse-\d+\.json$/.test(name))) {
    try { rehearsals.push(JSON.parse(await readFile(`${directory}/${filename}`, 'utf8'))); } catch { /* never trust a partial receipt */ }
  }
  if (!rehearsals.some(item => item.state === 'rehearsed_rolled_back'
    && item.sourceSha256 === digest && Date.now() - Date.parse(item.observedAt) < 60 * 60 * 1000))
    throw Error('Fresh matching hosted rollback rehearsal required');
  if (environment === 'live') {
    const testDirectory = '.verification-results/learn-build01-customer-provenance-test';
    const testEntries = await readdir(testDirectory).catch(() => []);
    const testReceipts = [];
    for (const filename of testEntries.filter(name => /^install-\d+\.json$/.test(name))) {
      try { testReceipts.push(JSON.parse(await readFile(`${testDirectory}/${filename}`, 'utf8'))); } catch { /* partial */ }
    }
    if (!testReceipts.some(item => item.state === 'installed_verified' && item.sourceSha256 === digest))
      throw Error('Exact TEST installation receipt required before LIVE');
  }
}

const footer = `comment on function ${functionSignature} is ${quoted(comment)};\nnotify pgrst,'reload schema';\n`;
if (source.match(/^begin;\s*$/gm)?.length !== 1 || !/\ncommit;\s*$/i.test(source))
  throw Error('Migration transaction boundary differs');
const bundle = source.replace(/\ncommit;\s*$/i,
  `\n${footer}${phase === 'rehearse' ? 'rollback;' : 'commit;'}\n`);
const receiptPath = `${directory}/${phase}-${Date.now()}.json`;
const receipt = { state: 'prepared_not_submitted', environment, project,
  sourceSha256: digest, phase, observedAt: new Date().toISOString() };
await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
let submitted = false;
try { await api('/database/query', bundle, true); submitted = true; }
catch { /* Read the exact catalog after an uncertain response; never retry here. */ }
const after = await catalog();
const valid = submitted && (phase === 'rehearse' ? absent(after) : installed(after));
const result = { ...receipt, state: valid ? (phase === 'rehearse' ? 'rehearsed_rolled_back' : 'installed_verified')
  : 'requires_inspection', observedAt: new Date().toISOString(), noCustomerRowsRead: true,
  providerRequests: 0, sourceDataWrites: false };
await writeFile(receiptPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(result));
if (!valid) process.exitCode = 1;
