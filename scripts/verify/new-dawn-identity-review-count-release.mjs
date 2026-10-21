/** Exact two-stage LIVE release: standalone concurrent index, then guarded function. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { assess, exactSources, indexDef, readLive } from './new-dawn-identity-review-count-readback.mjs';

const [indexFile, functionFile] = [
 '20261112193000_new_dawn_identity_review_gmail_draft_index.sql',
 '20261112193100_new_dawn_identity_review_count_indexed.sql',
];
const oldFunctionMd5 = 'fcf76cac657c2245b432cd1199dd48e6';
const indexVersion = '20261112193000';
const indexName = 'new_dawn_identity_review_gmail_draft_index';
const functionVersion = '20261112193100';
const functionName = 'new_dawn_identity_review_count_indexed';
const project = 'tgbnakbxwcqjeimygroz';
const literal = value => `'${value.replaceAll("'", "''")}'`;
const file = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

export function exactReleaseSources() {
 exactSources();
 const index = file(indexFile);
 const replacement = file(functionFile);
 if (!/^--[\s\S]*?\ncreate index concurrently [\s\S]+;\s*$/i.test(index) ||
   /\bbegin\s*;|\bcommit\s*;/i.test(index))
  throw Error('identity_review_index_must_be_standalone');
 const match = replacement.match(/\nbegin;\n([\s\S]*?)\ncommit;\s*$/i);
 if (!match || /\n(?:begin|commit);\s*$/im.test(match[1]))
  throw Error('identity_review_function_transaction_changed');
 return { index, replacement, replacementBody: match[1] };
}

/** This one statement must be run by a proven nontransactional channel. */
export function indexSql() {
 return exactReleaseSources().index;
}

/** Record the first migration only after a valid, exact index is visible. */
export function indexLedgerSql() {
 const { index } = exactReleaseSources();
 return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin
 if md5(pg_get_functiondef('public.learn_identity_review_count(uuid)'::regprocedure))
    is distinct from '${oldFunctionMd5}'
 or has_function_privilege('service_role','public.learn_identity_review_count(uuid)','EXECUTE')
    is distinct from true
 or has_function_privilege('anon','public.learn_identity_review_count(uuid)','EXECUTE')
    is distinct from false
 or has_function_privilege('authenticated','public.learn_identity_review_count(uuid)','EXECUTE')
    is distinct from false
 or exists(select 1 from supabase_migrations.schema_migrations
    where version::text in ('${indexVersion}','${functionVersion}'))
 or not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_index x on x.indexrelid=c.oid
    where n.nspname='public' and c.relname='learn_email_gmail_draft_review_idx'
     and x.indisvalid and x.indisready and pg_get_indexdef(c.oid)=${literal(indexDef)})
 then raise exception 'identity_review_index_ledger_state_changed';end if;
end $gate$;
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${indexVersion}','${indexName}',array[${literal(index)}]);
select 'identity_review_index_recorded' state;
commit;`;
}

/** Transactional function swap, guarded by both index and exact index ledger. */
export function functionReleaseSql() {
 const { replacement, replacementBody } = exactReleaseSources();
 const indexSha = exactSources()[0].sha256;
 return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin
 if md5(pg_get_functiondef('public.learn_identity_review_count(uuid)'::regprocedure))
    is distinct from '${oldFunctionMd5}'
 or (select count(*) from supabase_migrations.schema_migrations
    where version::text='${indexVersion}')<>1
 or (select name from supabase_migrations.schema_migrations
    where version::text='${indexVersion}') is distinct from '${indexName}'
 or (select encode(sha256(convert_to(statements[1],'UTF8')),'hex')
    from supabase_migrations.schema_migrations
    where version::text='${indexVersion}') is distinct from '${indexSha}'
 or exists(select 1 from supabase_migrations.schema_migrations
    where version::text='${functionVersion}')
 or not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_index x on x.indexrelid=c.oid
    where n.nspname='public' and c.relname='learn_email_gmail_draft_review_idx'
     and x.indisvalid and x.indisready and pg_get_indexdef(c.oid)=${literal(indexDef)})
 then raise exception 'identity_review_function_release_state_changed';end if;
end $gate$;
${replacementBody}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${functionVersion}','${functionName}',array[${literal(replacement)}]);
select 'identity_review_function_installed' state;
commit;`;
}

export function nextStep(readback) {
 const { stage, ...evidence } = assess(readback);
 const next = {
  baseline: 'apply_standalone_concurrent_index_outside_transaction',
  index_ready_unrecorded: 'record_exact_index_migration',
  index_recorded: 'apply_guarded_function_transaction',
  installed: 'observe_worker_without_manual_retry',
 }[stage];
 return { stage, next, ...evidence, replayAllowed: false };
}

/** A lost acknowledgement never authorises replay. Read the database again. */
export function resolveUncertainAcknowledgement(readback, expectedStage) {
 const result = nextStep(readback);
 if (result.stage !== expectedStage)
  throw Error(`identity_review_uncertain_ack:${result.stage}`);
 return result;
}

async function managementWrite(query, token, fetcher) {
 const response = await fetcher(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(600000),
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
 });
 if (!response.ok) throw Error(`identity_review_write_http_${response.status}`);
 const bytes = Buffer.from(await response.arrayBuffer());
 if (bytes.length > 20_000) throw Error('identity_review_write_ack_too_large');
 return JSON.parse(bytes.toString('utf8'));
}

/** Exactly one Management query call; on uncertain outcome inspect, never replay. */
async function applyOne({before,after,sql,token,fetcher}) {
 const current = nextStep(await readLive(token,fetcher));
 if (current.stage !== before) throw Error(`identity_review_stage_changed:${current.stage}`);
 let acknowledged = false;
 try {
  const rows = await managementWrite(sql,token,fetcher);
  acknowledged = Array.isArray(rows);
 } catch { /* The query may have committed despite an HTTP failure. */ }
 const verified = resolveUncertainAcknowledgement(await readLive(token,fetcher),after);
 return { ...verified, acknowledged, liveWriteQueries: 1 };
}

export async function installStandaloneIndex(token,fetcher=fetch) {
 exactReleaseSources();
 // The query is a single CREATE INDEX CONCURRENTLY statement; never prefix it
 // with SET, BEGIN or a timeout SQL statement.
 return applyOne({before:'baseline',after:'index_ready_unrecorded',
  sql:indexSql(),token,fetcher});
}

export async function recordIndexLedger(token,fetcher=fetch) {
 exactReleaseSources();
 return applyOne({before:'index_ready_unrecorded',after:'index_recorded',
  sql:indexLedgerSql(),token,fetcher});
}

export async function installFunction(token,fetcher=fetch) {
 exactReleaseSources();
 return applyOne({before:'index_recorded',after:'installed',
  sql:functionReleaseSql(),token,fetcher});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 try {
  const mode = process.argv[2];
  if (process.argv.length !== 3) throw Error('identity_review_exact_mode_required');
  if (mode === '--live-read-only')
   console.log(JSON.stringify(nextStep(await readLive())));
  else if (mode === '--print-index-sql') process.stdout.write(indexSql());
  else if (mode === '--print-index-ledger-sql') process.stdout.write(indexLedgerSql());
  else if (mode === '--print-function-sql') process.stdout.write(functionReleaseSql());
  else if (process.env.NEW_DAWN_IDENTITY_REVIEW_PROJECT === project &&
    process.env.NEW_DAWN_IDENTITY_REVIEW_INDEX_SHA === exactSources()[0].sha256 &&
    process.env.NEW_DAWN_IDENTITY_REVIEW_FUNCTION_SHA === exactSources()[1].sha256) {
   const { savedCliToken } = await import('./learn-test-readiness.mjs');
   const token = savedCliToken();
   if (mode === '--live-index-exact')
    console.log(JSON.stringify(await installStandaloneIndex(token)));
   else if (mode === '--live-index-ledger-exact')
    console.log(JSON.stringify(await recordIndexLedger(token)));
   else if (mode === '--live-function-exact')
    console.log(JSON.stringify(await installFunction(token)));
   else throw Error('identity_review_exact_release_mode_required');
  } else throw Error('identity_review_exact_release_pin_required');
 } catch (error) {
  console.error(JSON.stringify({ state: 'identity_review_release_plan_stopped',
   reason: error instanceof Error ? error.message : 'unknown' }));
  process.exitCode = 1;
 }
}
