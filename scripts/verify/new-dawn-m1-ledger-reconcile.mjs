/** Reconcile only the two already-installed M1 SQL migration receipts.
 * No function, flag, provider, client record, or job data is changed.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
import { migrationBodies } from './new-dawn-m1-source-home-release.mjs';

const PROJECT='tgbnakbxwcqjeimygroz';
const SIGNATURE='public.new_dawn_source_job_home(uuid,text)';
const FILES=[
  ['20261106210000','new_dawn_source_job_home','55fcb1eaa4bff4a4334e37fd80f6ec0a3ce2786d582597e05a9e931c6af4eba1'],
  ['20261106230000','new_dawn_source_job_home_operator_preview','fcbf37c9e0e7e34ef86c039c5e66b0d48e1179c872e526b6d56cf25416597ae4'],
];
const quote=(value)=>`'${value.replaceAll("'","''")}'`;

export function sources() {
  return FILES.map(([version,name,digest])=>{
    const source=readFileSync(new URL(`../../supabase/migrations/${version}_${name}.sql`,import.meta.url),'utf8');
    if (createHash('sha256').update(source).digest('hex')!==digest)
      throw Error(`M1 ledger source changed: ${version}`);
    return {version,name,source};
  });
}

const ledgerSql=`select version::text,name,statements from supabase_migrations.schema_migrations
 where version::text in ('20261106210000','20261106230000') order by version`;
const catalogSql=`select
 to_regprocedure('${SIGNATURE}') is not null as installed,
 coalesce((select prosecdef from pg_proc where oid=to_regprocedure('${SIGNATURE}')),false) as security_definer,
 position('new_dawn.source_job_home.operator_preview' in
  coalesce(pg_get_functiondef(to_regprocedure('${SIGNATURE}')),''))>0 as operator_gate,
 position('client_jobs.source_home_preview' in
  coalesce(pg_get_functiondef(to_regprocedure('${SIGNATURE}')),''))>0 as audited_preview,
 position('limit 24' in lower(coalesce(pg_get_functiondef(to_regprocedure('${SIGNATURE}')),'')))>0 as bounded_page,
 coalesce(has_function_privilege('authenticated',to_regprocedure('${SIGNATURE}'),'EXECUTE'),false) as authenticated_execute,
 coalesce(has_function_privilege('anon',to_regprocedure('${SIGNATURE}'),'EXECUTE'),false) as anon_execute,
 coalesce(has_function_privilege('service_role',to_regprocedure('${SIGNATURE}'),'EXECUTE'),false) as service_execute,
 (select count(*)::integer from public.feature_flags where
  flag in ('new_dawn.source_job_home','new_dawn.source_job_home.operator_preview')
   and value='true'::jsonb) as enabled_flags`;

export function installedCatalog(c) {
  return !!c && c.installed===true && c.security_definer===true &&
    c.operator_gate===true && c.audited_preview===true && c.bounded_page===true &&
    c.authenticated_execute===true && c.anon_execute===false &&
    c.service_execute===false && c.enabled_flags===0;
}

export function exactLedger(rows, files=sources()) {
  return Array.isArray(rows) && rows.length===files.length &&
    files.every((file,i)=>rows[i]?.version===file.version && rows[i]?.name===file.name &&
      Array.isArray(rows[i]?.statements) && rows[i].statements.length===1 &&
      rows[i].statements[0]===file.source);
}

export function reconcileSql(files=sources(), rollback=false) {
  if (files.length!==2 || files.some((file,i)=>file.version!==FILES[i][0] ||
      file.name!==FILES[i][1])) throw Error('M1 ledger file set changed');
  const rows=files.map(file=>`(${quote(file.version)},${quote(file.name)},array[${quote(file.source)}])`).join(',\n');
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $m1_ledger_gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where
  version::text in ('20261106210000','20261106230000'))
  then raise exception 'm1_ledger_already_recorded';end if;
 if to_regprocedure('${SIGNATURE}') is null
  or not (select prosecdef from pg_proc where oid=to_regprocedure('${SIGNATURE}'))
  or position('new_dawn.source_job_home.operator_preview' in
   pg_get_functiondef('${SIGNATURE}'::regprocedure))=0
  or position('client_jobs.source_home_preview' in
   pg_get_functiondef('${SIGNATURE}'::regprocedure))=0
  or position('limit 24' in lower(pg_get_functiondef('${SIGNATURE}'::regprocedure)))=0
  or not has_function_privilege('authenticated','${SIGNATURE}','EXECUTE')
  or has_function_privilege('anon','${SIGNATURE}','EXECUTE')
  or has_function_privilege('service_role','${SIGNATURE}','EXECUTE')
  or exists(select 1 from public.feature_flags where
   flag in ('new_dawn.source_job_home','new_dawn.source_job_home.operator_preview')
    and value='true'::jsonb)
  then raise exception 'm1_installed_contract_changed';end if;
end $m1_ledger_gate$;
insert into supabase_migrations.schema_migrations(version,name,statements) values
${rows};
select 'new-dawn-m1-ledger-reconciled/1' as marker;
${rollback?'rollback':'commit'};`;
}

async function query(token,project,sql,readOnly=true) {
  const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly?'/read-only':''}`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})}),
    redirect:'error',signal:AbortSignal.timeout(90000),
  });
  if (!response.ok) {
    const problem=await response.json().catch(()=>null);
    const code=typeof problem?.code==='string' && /^[A-Z0-9]{5}$/.test(problem.code)
      ? problem.code : 'unknown';
    throw Error(`M1 ledger ${readOnly?'read':'transaction'} failed (HTTP ${response.status}, SQLSTATE ${code})`);
  }
  return response.json();
}

export async function readLive() {
  const token=savedCliToken();
  const [catalog,ledger]=await Promise.all([
    query(token,PROJECT,catalogSql),query(token,PROJECT,ledgerSql),
  ]);
  return {catalog:catalog?.[0],ledger};
}

export async function reconcileLive() {
  const before=await readLive();
  if (!installedCatalog(before.catalog) || before.ledger?.length!==0)
    throw Error('LIVE M1 ledger reconciliation preflight changed');
  const token=savedCliToken();
  let acknowledged=false;
  try {
    const result=await query(token,PROJECT,reconcileSql(),false);
    acknowledged=result?.some?.((row)=>row.marker==='new-dawn-m1-ledger-reconciled/1')===true;
  } catch { /* Read back exact ledger; never retry an uncertain write. */ }
  const after=await readLive();
  if (!installedCatalog(after.catalog) || !exactLedger(after.ledger))
    throw Error('LIVE M1 ledger outcome unverified; inspect and do not retry automatically');
  return {state:'ledger_reconciled',project:PROJECT,versions:FILES.map(file=>file[0]),
    acknowledged,exactLedger:true,flagsEnabled:false,providerRequests:0};
}

export async function rehearseTest() {
  const token=savedCliToken();
  const testLedger=await query(token,TEST_PROJECT,
    `select to_regclass('supabase_migrations.schema_migrations') is not null as present`);
  if (testLedger?.[0]?.present!==false) throw Error('TEST M1 rehearsal ledger preflight changed');
  const before=await query(token,TEST_PROJECT,
    `select to_regprocedure('${SIGNATURE}') is null as absent`);
  if (before?.[0]?.absent!==true) throw Error('TEST M1 rehearsal function preflight changed');
  const [base,operatorGate]=migrationBodies();
  const ddl=`create schema supabase_migrations;
create table supabase_migrations.schema_migrations
 (version text primary key,name text not null,statements text[] not null);`;
  const sql=`begin;\n${ddl}\n${base}\n${operatorGate}\n`+
    reconcileSql(sources(),true).replace(/^begin;\n/,'').replace(/rollback;\s*$/,'')+
    `rollback;`;
  let error,rows;
  try { rows=await query(token,TEST_PROJECT,sql,false); }
  catch (cause) { error=cause; }
  const [afterLedger,afterFunction]=await Promise.all([
    query(token,TEST_PROJECT,`select to_regclass('supabase_migrations.schema_migrations') is not null as present`),
    query(token,TEST_PROJECT,`select to_regprocedure('${SIGNATURE}') is null as absent`),
  ]);
  if (afterLedger?.[0]?.present!==false || afterFunction?.[0]?.absent!==true)
    throw Error('TEST M1 ledger rehearsal failed to roll back');
  if (error) throw error;
  if (!rows?.some?.((row)=>row.marker==='new-dawn-m1-ledger-reconciled/1'))
    throw Error('TEST M1 ledger rehearsal receipt missing');
  return {state:'passed_rolled_back',project:TEST_PROJECT,versions:FILES.map(file=>file[0]),providerRequests:0};
}

if (process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href) {
  const mode=process.argv.slice(2).join(' ');
  if (!['--live-read-only','--test-rollback-only','--live-reconcile-after-m1-install'].includes(mode))
    throw Error('Exact M1 ledger mode required');
  try {
    const result=mode==='--live-read-only' ? await readLive() :
      mode==='--test-rollback-only' ? await rehearseTest() : await reconcileLive();
    if (mode==='--live-read-only') console.log(JSON.stringify({state:exactLedger(result.ledger)?'exact_ledger':
      result.ledger?.length===0?'ledger_missing':'ledger_mismatch',project:PROJECT,
      installedContract:installedCatalog(result.catalog),ledgerRows:result.ledger?.length,
      flagsEnabled:result.catalog?.enabled_flags,providerRequests:0}));
    else console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message);process.exitCode=1; }
}
