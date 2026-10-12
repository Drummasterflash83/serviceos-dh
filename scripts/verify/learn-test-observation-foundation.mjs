/** Complete the TEST decision/event foundation already present in production. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {savedCliToken,TEST_PROJECT} from './learn-test-readiness.mjs';
const mode=process.argv[2];
if(!['--prepare','--rehearse','--apply'].includes(mode)||process.argv[3]!=='--existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Fixed TEST only');
const token=savedCliToken(),q=(sql,readOnly=true)=>communicationQuery(token,sql,{readOnly}),prefix='supabase/release/learn-test/087_observation_foundation',hash=v=>createHash('sha256').update(v).digest('hex');
const cols={decision_log:['decision','next_owner_kind','engine_version','operating_profile_version','learning_version_ids','reason_codes','correlation_id','output_hash','supersedes','decision_package','operational_mode'],platform_events:['actor','occurred_at','domain','correlation_id']};
const enginePath='supabase/migrations/20260718120000_decision_engine.sql',engine=readFileSync(enginePath,'utf8');
const tables=(await q("select n.nspname||'.'||c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname in('public','storage','vault') or (n.nspname='auth' and c.relname in('users','identities'))) and c.relkind in('r','p') and not c.relispartition order by 1")).map(r=>r.name);
if(tables.length!==201||tables.some(n=>!/^(public|auth|storage|vault)\.[a-z][a-z0-9_]*$/.test(n)))throw Error('Expected 201 retained datasets');
const snapshot=tables.map(n=>{const keys=cols[n.split('.')[1]],row=keys?`(to_jsonb(s)-array[${keys.map(k=>`'${k}'`).join(',')}])`:'to_jsonb(s)';return `select '${n}' name,count(*)::int count,md5(coalesce(string_agg(md5(${row}::text),'' order by md5(${row}::text)),'')) fingerprint from ${n} s`;}).join(' union all ');
const before=await q(snapshot);
if((await q("select count(*)::int n from platform_jobs where status='running'"))[0].n!==0)throw Error('Worker running');
if(mode==='--prepare'){
 const sql=`-- TEST 087: original decision-engine persistence plus event/mode columns. No schedules/profiles changed.
begin;set local search_path=public,pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}'
 or exists(select 1 from of_test_deploy.migrations where migration_name='learn_observation_foundation_v1')
 or not exists(select 1 from of_test_deploy.migrations where migration_name='learn_observation_delivery_v1')
 or exists(select 1 from platform_jobs where status='running')
 then raise exception 'Observation foundation scope differs';end if;
end$$;
create temporary table foundation_preserved on commit drop as ${snapshot};
${engine}
alter table public.decision_log add column if not exists operational_mode text;
create index if not exists decision_log_op_mode on public.decision_log(tenant_id,operational_mode);
alter table public.platform_events add column if not exists actor jsonb;
alter table public.platform_events add column if not exists occurred_at timestamptz;
alter table public.platform_events add column if not exists domain text;
alter table public.platform_events add column if not exists correlation_id uuid;
do $$begin
 if (select jsonb_agg(to_jsonb(x) order by name) from foundation_preserved x) is distinct from
 (select jsonb_agg(to_jsonb(x) order by name) from (${snapshot})x) then raise exception 'Retained fields changed';end if;
end$$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_observation_foundation_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
commit;
`;
 writeFileSync(prefix+'.sql',sql,{flag:'wx'});writeFileSync(prefix+'.manifest.json',JSON.stringify({projectRef:TEST_PROJECT,sha256:hash(sql),sources:[{path:enginePath,sha256:hash(engine)}],preservedDatasets:tables.length,addedColumns:cols},null,2)+'\n',{flag:'wx'});console.log('Prepared TEST decision foundation');
}else{
 const sql=readFileSync(prefix+'.sql','utf8'),m=JSON.parse(readFileSync(prefix+'.manifest.json'));
 if(hash(sql)!==m.sha256||hash(engine)!==m.sources[0].sha256)throw Error('Package changed');
 const stem='.verification-results/observation-foundation-v2-'+mode.slice(2);
 if(mode==='--apply'){
  const proof=JSON.parse(readFileSync('.verification-results/observation-foundation-v2-rehearse-result.json'));
  if(proof.state!=='rehearsed_rolled_back'||proof.packageSha256!==m.sha256)throw Error('Rehearsal required');
 }
 let statement=sql;
 if(mode==='--rehearse'){
  const f=JSON.parse(readFileSync('.verification-results/learn-observation-synthetic-fixture.json'));
  let test=readFileSync('scripts/verify/learn-observation-delivery.assert.sql','utf8');
  for(const k of ['draft','result'])test=test.replaceAll('__'+k.toUpperCase()+'__','$fixture$'+JSON.stringify(f[k])+'$fixture$::jsonb');
  statement=sql.replace(/\ncommit;\n$/,()=> '\n'+test+'\nrollback;\n');
 }
 writeFileSync(stem+'-journal.json',JSON.stringify({state:'submission_pending',packageSha256:m.sha256,before}),{mode:0o600,flag:'wx'});
 let response=false;try{await q(`set serviceos.release_target='${TEST_PROJECT}';set serviceos.release_source_sha256='${m.sha256}';\n`+statement,false);response=true;}catch{}
 const after=await q(snapshot),ledger=await q("select source_sha256 from of_test_deploy.migrations where migration_name='learn_observation_foundation_v1'");
 const ok=response&&JSON.stringify(before)===JSON.stringify(after)&&(mode==='--rehearse'?ledger.length===0:ledger.length===1&&ledger[0].source_sha256===m.sha256);
 const report={state:ok?(mode==='--rehearse'?'rehearsed_rolled_back':'installed_verified'):'requires_inspection',packageSha256:m.sha256,preservedDatasets:ok?tables.length:null,existingFieldsPreserved:ok,productionChanged:false,providerRequests:0,newAccounts:0,newGrants:0,syntheticSequenceConsumption:mode==='--rehearse'?2:0,observedAt:new Date().toISOString()};
 writeFileSync(stem+'-result.json',JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(report));if(!ok)process.exitCode=1;
}
