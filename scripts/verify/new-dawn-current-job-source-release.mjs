/** Two-stage, exact-source LIVE release for reliable audited job Home totals. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';

const project = 'tgbnakbxwcqjeimygroz';
const baseline = '1a373342368cc703a09860bc6162c0a98a8116cebd104719d212449fb9603f9a';
const candidate = '9219b20578e4213f927785ffd4c0714066cdb5972997b7b02e9024ef0fff4e23';
const customerBaseline = 'edc63a68703186905bbd7a61a791629c843b14a4ebdefe3b9660260f51e17e55';
const customerCandidate = 'a2f5916d204014e3affced8136308a74e67d6c0d42ea7856cdf27d7276f813c0';
const signature = 'public.new_dawn_open_job_status_summary(uuid,text)';
const customerSignature = 'public.new_dawn_customer_blockers(uuid,text)';
const files = [
  { version: '20261113000000', name: 'new_dawn_commusoft_current_job_source',
    sha: 'd1a2c9e754b285d6a8360427d5e75db1d7359a969871b53fb09365981e1ef46c' },
  { version: '20261113010000', name: 'new_dawn_open_job_summary_current_source',
    sha: '2c19c89b0c24cd896655702c1095614400db7d36c4ca14be10a437815ae7fa49' },
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;

export function sources() {
  return files.map(file => {
    const path = new URL(`../../supabase/migrations/${file.version}_${file.name}.sql`,import.meta.url);
    const source = readFileSync(path,'utf8');
    if (hash(source)!==file.sha || !/\nbegin;\n/i.test(source) ||
      !/\ncommit;\s*$/i.test(source)) throw Error('current_job_source_file_changed');
    const body = source.slice(source.indexOf('\nbegin;')+8,source.lastIndexOf('\ncommit;'));
    if (/^\s*(begin|commit);\s*$/im.test(body)) throw Error('current_job_source_nested_transaction');
    return { ...file,source,body };
  });
}

async function management(path,query,token=savedCliToken(),fetcher=fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${project}${path}`,{
    method:query?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(60000),
    headers:{Authorization:`Bearer ${token}`,
      ...(query?{'Content-Type':'application/json'}:{})},
    ...(query?{body:JSON.stringify({query})}:{}),
  });
  if (!response.ok) throw Error(`current_job_source_http_${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if (bytes.length>100_000) throw Error('current_job_source_response_too_large');
  return JSON.parse(bytes.toString('utf8'));
}

const catalog = `select
 (select count(*)::int from supabase_migrations.schema_migrations
  where version::text='${files[0].version}') ledger_1_count,
 (select encode(sha256(convert_to(statements[1],'UTF8')),'hex')
  from supabase_migrations.schema_migrations
  where version::text='${files[0].version}') ledger_1_sha,
 (select count(*)::int from supabase_migrations.schema_migrations
  where version::text='${files[1].version}') ledger_2_count,
 (select encode(sha256(convert_to(statements[1],'UTF8')),'hex')
  from supabase_migrations.schema_migrations
  where version::text='${files[1].version}') ledger_2_sha,
 to_regclass('public.new_dawn_commusoft_current_job_source') is not null cache_present,
 exists(select 1 from pg_trigger where tgname='new_dawn_commusoft_current_job_source_observe'
  and tgrelid='public.learn_business_input_observations'::regclass
  and not tgisinternal) trigger_present,
 encode(sha256(convert_to(pg_get_functiondef('${signature}'::regprocedure),'UTF8')),'hex') summary_sha,
 encode(sha256(convert_to(pg_get_functiondef('${customerSignature}'::regprocedure),'UTF8')),'hex') customer_sha,
 has_function_privilege('authenticated','${signature}','EXECUTE') auth_execute,
 has_function_privilege('anon','${signature}','EXECUTE') anon_execute,
 has_function_privilege('service_role','${signature}','EXECUTE') service_execute,
 has_function_privilege('authenticated','${customerSignature}','EXECUTE') customer_auth_execute,
 has_function_privilege('anon','${customerSignature}','EXECUTE') customer_anon_execute,
 has_function_privilege('service_role','${customerSignature}','EXECUTE') customer_service_execute`;

export async function readStage(token=savedCliToken(),fetcher=fetch) {
  const [info,rows]=await Promise.all([
    management('',null,token,fetcher),
    management('/database/query/read-only',catalog,token,fetcher),
  ]);
  if (info?.id!==project || info.status!=='ACTIVE_HEALTHY' ||
    !Array.isArray(rows) || rows.length!==1)
    throw Error('current_job_source_catalog_unconfirmed');
  return rows[0];
}

export function assess(row,stage) {
  if (!row || ![0,1,2].includes(stage) ||
    row.ledger_1_count!==(stage>=1?1:0) ||
    row.ledger_1_sha!==(stage>=1?files[0].sha:null) ||
    row.ledger_2_count!==(stage>=2?1:0) ||
    row.ledger_2_sha!==(stage>=2?files[1].sha:null) ||
    row.cache_present!==(stage>=1) || row.trigger_present!==(stage>=1) ||
    row.summary_sha!==(stage>=2?candidate:baseline) ||
    row.customer_sha!==(stage>=2?customerCandidate:customerBaseline) ||
    row.auth_execute!==true || row.anon_execute!==false ||
    row.service_execute!==false || row.customer_auth_execute!==true ||
    row.customer_anon_execute!==false || row.customer_service_execute!==false)
    throw Error('current_job_source_stage_changed');
  return {state:['ready_exact','projection_installed','home_readers_installed'][stage],
    project,stage,sourceSha256:files.map(x=>x.sha),
    functionSha256:row.summary_sha,customerFunctionSha256:row.customer_sha,
    providerRequests:0,sourceWrites:0};
}

export function releaseSql(stage) {
  if (stage!==1 && stage!==2) throw Error('current_job_source_stage_invalid');
  const source=sources()[stage-1];
  const before=stage-1;
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='70s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $gate$ begin
 if (select count(*) from supabase_migrations.schema_migrations
     where version::text='${source.version}')<>0
  or encode(sha256(convert_to(pg_get_functiondef('${signature}'::regprocedure),'UTF8')),'hex')
    <> '${baseline}'
  or encode(sha256(convert_to(pg_get_functiondef('${customerSignature}'::regprocedure),'UTF8')),'hex')
    <> '${customerBaseline}'
  or (to_regclass('public.new_dawn_commusoft_current_job_source') is not null)
    is distinct from ${before>=1}
  or exists(select 1 from pg_trigger
     where tgname='new_dawn_commusoft_current_job_source_observe'
      and tgrelid='public.learn_business_input_observations'::regclass
      and not tgisinternal) is distinct from ${before>=1}
  or (select count(*) from supabase_migrations.schema_migrations
     where version::text='${files[0].version}')<>${before>=1?1:0}
  ${before>=1?`or (select encode(sha256(convert_to(statements[1],'UTF8')),'hex')
      from supabase_migrations.schema_migrations
      where version::text='${files[0].version}')<>'${files[0].sha}'`:''}
 then raise exception 'current_job_source_release_state_changed'; end if;
end $gate$;
${source.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${source.version}','${source.name}',array[${literal(source.source)}]);
select 'current_job_source_stage_${stage}_installed' state;
commit;`;
}

export async function installLive(token=savedCliToken(),fetcher=fetch) {
  sources();
  const initial=await readStage(token,fetcher);
  if (initial.ledger_2_count===1) return assess(initial,2);
  const beginStage=initial.ledger_1_count===1?1:0;
  assess(initial,beginStage);
  for (let stage=beginStage+1;stage<=2;stage++) {
    try { await management('/database/query',releaseSql(stage),token,fetcher); }
    catch { /* Resolve uncertain acknowledgement by readback, never replay. */ }
    assess(await readStage(token,fetcher),stage);
  }
  return {state:'home_readers_installed',project,stage:2,
    sourceSha256:files.map(x=>x.sha),functionSha256:candidate,
    customerFunctionSha256:customerCandidate,
    providerRequests:0,sourceWrites:0};
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const args=process.argv.slice(2);
    if (args.length===1 && args[0]==='--live-read-only')
      console.log(JSON.stringify(assess(await readStage(),0)));
    else if (args.length===1 && args[0]==='--live-stage-1-read-only')
      console.log(JSON.stringify(assess(await readStage(),1)));
    else if (args.length===1 && args[0]==='--live-installed-read-only')
      console.log(JSON.stringify(assess(await readStage(),2)));
    else if (args.length===1 && args[0]==='--live-install-exact' &&
      process.env.NEW_DAWN_CURRENT_JOB_SOURCE_PROJECT===project &&
      process.env.NEW_DAWN_CURRENT_JOB_SOURCE_SHA_1===files[0].sha &&
      process.env.NEW_DAWN_CURRENT_JOB_SOURCE_SHA_2===files[1].sha)
      console.log(JSON.stringify(await installLive()));
    else throw Error('current_job_source_exact_scope_required');
  } catch(error) {
    console.error(JSON.stringify({state:'current_job_source_release_stopped',
      reason:error instanceof Error?error.message:'unknown'}));
    process.exitCode=1;
  }
}
