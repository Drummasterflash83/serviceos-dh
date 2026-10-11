/** TEST-only rollback rehearsal; never commits candidate schema or identities. */
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { savedCliToken,TEST_PROJECT } from './learn-test-readiness.mjs';
import { communicationQuery } from './learn-card-communication-catalog.mjs';
import { readPhoneProcessingCatalog,phoneProcessingSourceQuery,PHONE_PROCESSING_TABLES } from './learn-phone-processing-catalog.mjs';
import { phoneOperatorHostedProbe } from './learn-phone-operator-hosted-probe.mjs';
const migration='supabase/migrations/20261101220000_learn_phone_operator_attempts.sql';
const hash=s=>createHash('sha256').update(s).digest('hex');
const dir='.verification-results/phone-operator-rehearsal';
if(process.argv.slice(2).join(' ')!=='--rehearse'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST-only rehearsal required');
mkdirSync(dir,{recursive:true,mode:0o700});
const token=savedCliToken();
const query=(sql,readOnly=true)=>communicationQuery(token,sql,{readOnly,fetcher:async(...args)=>{
 const response=await fetch(...args);
 if(!response.ok&&response.body){const reader=response.clone().body.getReader();let bytes=0;const chunks=[];try{while(bytes<65536){const part=await reader.read();if(part.done)break;bytes+=part.value.length;chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}writeFileSync(dir+'/private-error.txt',Buffer.concat(chunks),{mode:0o600});}
 return response;
}});
try{
 const before=await readPhoneProcessingCatalog(token);
 if(before.fingerprint!=='7d31c2f3169a9a3da7298a131a7058eb')throw Error('Installed release 055 required');
 const additional=[...PHONE_PROCESSING_TABLES.slice(3).map(n=>'public.'+n),'auth.users','auth.sessions','auth.identities'];
 const sources=phoneProcessingSourceQuery(before.catalog.phone)+' union all '+additional.map(n=>`select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from ${n} s`).join(' union all ');
 const preserved=await query(sources);
 const source=readFileSync(migration,'utf8'),probe=phoneOperatorHostedProbe();
 const journal={state:'prepared',projectRef:TEST_PROJECT,observedAt:new Date().toISOString(),migration,sourceSha256:hash(source),probeSha256:hash(probe),schemaBefore:before.fingerprint,preservedDataSets:preserved.length};
 const save=()=>writeFileSync(dir+'/journal.json',JSON.stringify(journal,null,2)+'\n',{mode:0o600});save();
 let result=null;
 try{result=await query(`begin;set local search_path=public,pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
 ${source.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'')}
 savepoint operator_probe;${probe}
 rollback to savepoint operator_probe;release savepoint operator_probe;
 select 'phone-operator-rehearsed/1' as marker;
 rollback;`,false);}catch{journal.state='unconfirmed';}
 const after=await readPhoneProcessingCatalog(token),afterSources=await query(sources);
 journal.schemaUnchanged=JSON.stringify(before)===JSON.stringify(after);
 journal.retainedSourcesUnchanged=JSON.stringify(preserved)===JSON.stringify(afterSources);
 const absence=await query("select to_regclass('public.learn_phone_operator_reconciliations') is null as absent");
 journal.candidateAbsent=absence[0]?.absent===true;
 journal.state=result?.some(r=>r.marker==='phone-operator-rehearsed/1')&&journal.schemaUnchanged&&journal.retainedSourcesUnchanged&&journal.candidateAbsent?'rehearsed_rolled_back':'rehearsal_failed_or_unconfirmed';
 journal.completedAt=new Date().toISOString();save();console.log(JSON.stringify(journal,null,2));
 if(journal.state!=='rehearsed_rolled_back')process.exitCode=1;
}catch{console.error('Operator rehearsal unconfirmed; inspect private evidence before retrying.');process.exitCode=1;}
