/** Additive evidence browser only. Explicit target, durable attempt journal and
 * readback after uncertain results; never resumes capture or changes a worker.
 */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {savedCliToken} from '../verify/learn-test-readiness.mjs';
import {SOURCE_TABLES,sourceFingerprintQuery,validateSourcePage,assertSourcesPreserved} from '../verify/learn-release-source-preservation.mjs';
const [mode,project,output]=process.argv.slice(2),root=resolve(output??'');
if(process.argv.length!==5 || !['plan','rehearse','apply','verify'].includes(mode) || !['saatxzwxvdvqevbnskxy','tgbnakbxwcqjeimygroz'].includes(project) || !root.startsWith(resolve('.verification-results')+'/'))throw Error('Exact mode, target and private output required');
const source=readFileSync('supabase/migrations/20261103010000_learn_slack_evidence_browse.sql','utf8'),hash=createHash('sha256').update(source).digest('hex');
const local=JSON.parse(readFileSync('.verification-results/learn-slack-evidence-local-20261014-03/report.json'));
if(local.state!=='slack_evidence_full_schema_rehearsed'||!local.containerRemoved||local.migrationSha256!==hash||!local.functionRollbackReapplyVerified)throw Error('Matching full-schema rehearsal required');
const sig='public.learn_slack_evidence_read(uuid,uuid,text)',tenant='00000000-0000-0000-0000-000000000001',token=savedCliToken();
const sourceReaderBody=readFileSync('supabase/migrations/20261102140000_learn_slack_card_source.sql','utf8').match(/as \$\$([\s\S]*?)end\$\$;/)?.[1]+'end';
const sourceReaderHash=createHash('md5').update(sourceReaderBody).digest('hex');
const save=(name,data)=>writeFileSync(join(root,name),JSON.stringify(data,null,2)+'\n',{mode:0o600});
async function query(sql,readonly=true){
 const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readonly?'/read-only':''}`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:sql,...(readonly?{}:{read_only:false})}),redirect:'error',signal:AbortSignal.timeout(45000)});
 if(!r.ok){const raw=await r.text();if(existsSync(root))save('private-error-'+Date.now()+'.json',{status:r.status,raw});throw Error('Database request '+r.status+'; reconcile saved attempt before retry');}return r.json();
}
const existingSql=`select md5(coalesce(string_agg(p.oid::regprocedure::text||'|'||md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,''),'\n' order by p.oid::regprocedure::text),'')) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname<>'learn_slack_evidence_read'`;
const catalogSql=`select clock_timestamp() at,(select hash from (${existingSql})f) existing_hash,
 to_regprocedure('${sig}')::text installed,
 to_regprocedure('public.learn_slack_card_source_read(uuid,uuid,text)')::text source_reader,
 (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.learn_slack_card_source_read(uuid,uuid,text)')) source_reader_hash,
 to_regclass('public.learn_slack_evidence_receipt_page')::text page_index,
 (select md5(prosrc) from pg_proc where oid=to_regprocedure('${sig}')) body_md5,
 (select proacl::text from pg_proc where oid=to_regprocedure('${sig}')) acl`;
async function snapshot(cutoff,label='readback'){
 const cols=await query(`select c.relname name,jsonb_agg(a.attname::text order by a.attnum) columns from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname='public' and c.relname in(${SOURCE_TABLES.map(t=>`'${t}'`).join(',')}) and a.attnum>0 and not a.attisdropped group by c.relname`);
 const progressName='preservation-'+label+'-progress.json';
 const progress=existsSync(join(root,progressName))?JSON.parse(readFileSync(join(root,progressName))):{project,hash,cutoff,startedAt:new Date().toISOString(),tables:{}};
 if(progress.project!==project||progress.hash!==hash||progress.cutoff!==cutoff)throw Error('Preservation progress scope differs');
 const sources=[];
 for(const table of SOURCE_TABLES){const columns=cols.find(x=>x.name===table)?.columns;if(!columns)throw Error('Missing preservation source '+table);const prior=progress.tables[table];if(prior&&JSON.stringify(prior.columns)!==JSON.stringify(columns))throw Error('Preservation columns changed');let cursor=prior?.cursor??null,done=prior?.done??false;const rows=prior?.rows??[];
  for(let page=0;!done&&page<600;page++){const batch=await query(sourceFingerprintQuery({table,tenant,cutoff,cursor,columns,pageSize:250}));validateSourcePage(batch,cursor,250);if(!batch.length)done=true;else{rows.push(...batch);cursor=batch.at(-1).id;}progress.tables[table]={columns,cursor,done,rows};save(progressName,progress);}
  if(!done)throw Error('Source inventory exceeds bound');sources.push({name:table,count:rows.length,rows});
 }
 return [{cutoff,sources}];
}
if(mode==='plan'){
 if(existsSync(root))throw Error('Fresh private journal required');mkdirSync(root,{mode:0o700});
 const before=(await query(catalogSql))[0];if(before.installed||before.page_index||!before.source_reader||before.source_reader_hash!==sourceReaderHash)throw Error('Unexpected browser/source-reader baseline');
 const sources=await snapshot(before.at,'baseline');save('plan.json',{project,hash,before,sources});
 console.log(JSON.stringify({project,state:'prepared',datasets:sources[0].sources.map(x=>({name:x.name,records:x.count})),hash}));
}else{
 const plan=JSON.parse(readFileSync(join(root,'plan.json')));if(plan.project!==project||plan.hash!==hash)throw Error('Prepared target/source changed');
 const before=(await query(catalogSql))[0];
 const reconciliation=mode==='verify'&&existsSync(join(root,'concurrent-reconciliation.json'))?JSON.parse(readFileSync(join(root,'concurrent-reconciliation.json'))):null;
 const reconciled=reconciliation?.state==='exact_concurrent_changes_reconciled'&&reconciliation.project===project&&reconciliation.hash===hash&&reconciliation.baselineCatalogHash===plan.before.existing_hash&&reconciliation.currentCatalogHash===before.existing_hash&&reconciliation.sourceCutoff===plan.before.at&&reconciliation.sourceIdsDeleted===0&&reconciliation.allChangedSlackBaselineFingerprintsPreservedInImmutableVersions===true;
 if((before.existing_hash!==plan.before.existing_hash&&!reconciled)||before.source_reader_hash!==sourceReaderHash){
  if(mode==='verify'){save('catalog-drift.json',{project,hash,before});save('preservation-readback.json',{project,hash,at:before.at,sources:await snapshot(plan.before.at)});}
  throw Error('Existing function baseline changed; inspect saved readback');
 }
 if(mode==='rehearse'){
  if(before.installed||before.page_index)throw Error('Reader already installed');
  const fixture=readFileSync('scripts/verify/learn-slack-card-source.assert.sql','utf8').split('create temporary table source_reader_before')[0];
  const fixturePrefix=randomUUID().slice(0,8);
  const assertions=readFileSync('scripts/verify/learn-slack-evidence.assert.sql','utf8').replace('__SOURCE_FIXTURE__',()=>fixture).replaceAll('caa14000',fixturePrefix);
  if((await query(`select count(*) n from public.tenants where id::text like '${fixturePrefix}-%'`))[0].n!==0)throw Error('Synthetic namespace already exists');
  save('rehearsal-attempt-'+Date.now()+'.json',{project,hash,fixturePrefix,state:'rollback_transaction_starting'});
  const body=source.replace(/^([\s\S]*?)\bbegin;/,'$1').replace(/commit;\s*$/,'');
  await query('begin;set local search_path=public,pg_catalog;'+body+'\n'+assertions+'\nrollback;',false);
  const after=(await query(catalogSql))[0];if(after.installed||after.page_index||after.existing_hash!==plan.before.existing_hash||(await query(`select count(*) n from public.tenants where id::text like '${fixturePrefix}-%'`))[0].n!==0)throw Error('Rehearsal did not roll back');
  save('rehearsed.json',{project,hash,at:after.at,state:'hosted_rollback_rehearsed'});console.log(JSON.stringify({project,state:'hosted_rollback_rehearsed'}));
 }else{
  const rehearsal=JSON.parse(readFileSync(join(root,'rehearsed.json')));if(rehearsal.project!==project||rehearsal.hash!==hash)throw Error('Exact hosted rehearsal required');
  if(mode==='apply'){
   if(before.installed||before.page_index||existsSync(join(root,'intent.json')))throw Error('Already installed/attempted; use verify');
   save('intent.json',{project,hash,state:'applying',at:new Date().toISOString()});
   const guard=`do $guard$ begin if (select hash from (${existingSql})f) is distinct from '${plan.before.existing_hash}' or to_regprocedure('${sig}') is not null or to_regclass('public.learn_slack_evidence_receipt_page') is not null then raise exception 'Evidence browser baseline changed';end if;end $guard$;`;
   await query(source.replace('begin;','begin;\n'+guard),false);
  }
  const after=(await query(catalogSql))[0],expected=source.match(/as \$\$([\s\S]*?)end\$\$;/)?.[1]+'end';
  const fn=(await query(`select prosrc,pg_get_userbyid(proowner) owner,prosecdef definer,proconfig config,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated,has_function_privilege('service_role',oid,'execute') service from pg_proc where oid=to_regprocedure('${sig}')`))[0];
  if(after.existing_hash!==(reconciled?reconciliation.currentCatalogHash:plan.before.existing_hash)||!after.installed||!after.page_index||!fn||fn.prosrc!==expected||fn.owner!=='postgres'||!fn.definer||!fn.config.includes('search_path=pg_catalog')||fn.anon||!fn.authenticated||fn.service)throw Error('Installed source/authority differs');
  const sources=reconciled?JSON.parse(readFileSync(join(root,'preservation-readback.json'))).sources:await snapshot(plan.before.at);
  if(reconciled){if(createHash('sha256').update(JSON.stringify(sources)).digest('hex')!==reconciliation.readbackSha256)throw Error('Reconciled preservation snapshot differs');}
  else{save('preservation-readback.json',{project,hash,at:after.at,sources});assertSourcesPreserved(plan.sources,sources);}
  const report={project,hash,at:after.at,state:'installed_source_reader_verified',existingFunctionsPreserved:!reconciled,unrelatedFunctionsPreserved:true,concurrentChangesReconciled:reconciled?reconciliation:null,sourceBodiesAndPermissionsVerified:true,sourceDatasetsPreserved:SOURCE_TABLES.length,providerRequests:0,workerChanged:false};
  save('verified.json',report);console.log(JSON.stringify(report));
 }
}
