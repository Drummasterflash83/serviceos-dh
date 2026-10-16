/** Function-local planner repair. No role simulation, provider call or data write. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {savedCliToken} from './learn-test-readiness.mjs';
const [mode,environment]=process.argv.slice(2);
if(process.argv.length!==4||!['rehearse','apply','readback'].includes(mode)||!['test','live'].includes(environment))throw Error('Exact mode/environment required');
const project=environment==='test'?'saatxzwxvdvqevbnskxy':'tgbnakbxwcqjeimygroz';
const root='.verification-results/commusoft-source-jobs-20261016';
const source=readFileSync('supabase/migrations/20261104151000_learn_commusoft_source_job_plan.sql','utf8');
const digest=createHash('sha256').update(source).digest('hex'),token=savedCliToken();
const read=n=>JSON.parse(readFileSync(`${root}/${environment}-${n}.json`,'utf8'));
const save=(n,v)=>writeFileSync(`${root}/${environment}-${n}.json`,JSON.stringify(v,null,2)+'\n',{mode:0o600});
const quote=s=>"'"+s.replaceAll("'","''")+"'";
async function q(query){const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok){writeFileSync(`${root}/${environment}-plan-error.txt`,await r.text(),{mode:0o600});throw Error('Plan release HTTP '+r.status);}return r.json();}
const catalog=`select p.proname name,pg_get_functiondef(p.oid) definition,p.proacl::text acl,pg_get_userbyid(p.proowner) owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('learn_commusoft_source_job_rows','learn_commusoft_source_job_cards','openfolk_business_review') order by p.proname`;
const ledger=environment==='test'?`select source_sha256 digest from of_test_deploy.migrations where migration_name='learn_commusoft_source_job_plan_v1'`:`select encode(sha256(convert_to(array_to_string(statements,''),'UTF8')),'hex') digest from supabase_migrations.schema_migrations where version='20261104151000'`;
const before=await q(`begin read only;${catalog};commit;`);
if(mode==='readback'){const receipt=read('plan-apply-result'),rows=await q(`begin read only;${ledger};commit;`);if(receipt.sourceSha256!==digest||JSON.stringify(before)!==JSON.stringify(receipt.expected)||rows.length!==1||rows[0].digest!==digest)throw Error('Plan readback mismatch');console.log(JSON.stringify({environment,sourceSha256:digest,installedVerified:true}));process.exit(0);}
const original=read('apply-result');if(original.state!=='installed_verified'||JSON.stringify(before)!==JSON.stringify(original.expected))throw Error('Original reader baseline differs');
const rehearsal=mode==='apply'?read('plan-rehearse-result'):null;
if(rehearsal&&(rehearsal.state!=='rehearsed_rolled_back'||rehearsal.sourceSha256!==digest||Date.now()-Date.parse(rehearsal.observedAt)>3600000))throw Error('Fresh plan rehearsal required');
if(mode==='apply'){
 const log=readFileSync(`${root}/local-plan-tests.log`,'utf8');if(!log.includes('source preservation passed')||!log.includes('Actual SQL response passes the UI parser')||log.includes('Traceback'))throw Error('Isolated tests required');
 if(environment==='live'){const test=JSON.parse(readFileSync(`${root}/test-plan-apply-result.json`,'utf8'));if(test.state!=='installed_verified'||test.sourceSha256!==digest)throw Error('Exact TEST install required');}
}
const baseline=before.find(x=>x.name==='learn_commusoft_source_job_rows');
const guard=`do $$begin if pg_get_functiondef('public.learn_commusoft_source_job_rows(uuid,uuid)'::regprocedure) is distinct from ${quote(baseline.definition)} then raise exception 'Source reader changed';end if;end$$;`;
const receipt=environment==='test'?`insert into of_test_deploy.migrations(migration_name,source_sha256,project_ref) values('learn_commusoft_source_job_plan_v1','${digest}','${project}');`:`insert into supabase_migrations.schema_migrations(version,name,statements) values('20261104151000','learn_commusoft_source_job_plan',array[${quote(source)}]);`;
const sql=`begin;set local statement_timeout=10000;select pg_advisory_xact_lock(hashtextextended('commusoft-source-job-reader-release',0));${guard}${source.replace(/^begin;$/m,'').replace(/^commit;$/m,'')}${receipt}${catalog};${mode==='rehearse'?'rollback':'commit'};`;
save('plan-'+mode+'-intent',{observedAt:new Date().toISOString(),sourceSha256:digest,baseline:before});
const expected=await q(sql),after=await q(`begin read only;${catalog};commit;`);
if(JSON.stringify(after)!==JSON.stringify(mode==='rehearse'?before:rehearsal.expected)||expected.length!==3||expected.some(x=>{const old=before.find(y=>y.name===x.name);return old.acl!==x.acl||old.owner!==x.owner||(x.name!=='learn_commusoft_source_job_rows'&&old.definition!==x.definition);}))throw Error('Plan postcheck differs');
const result={state:mode==='rehearse'?'rehearsed_rolled_back':'installed_verified',environment,project,sourceSha256:digest,observedAt:new Date().toISOString(),expected};save('plan-'+mode+'-result',result);console.log(JSON.stringify({...result,expected:undefined}));
