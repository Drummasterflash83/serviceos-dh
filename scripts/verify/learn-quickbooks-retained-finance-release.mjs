/** Exact retained-finance reader release. Never reads provider credentials or calls Intuit. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {savedCliToken} from './learn-test-readiness.mjs';
const [environment,phase]=process.argv.slice(2),projects={test:'saatxzwxvdvqevbnskxy',production:'tgbnakbxwcqjeimygroz'};
if(!Object.hasOwn(projects,environment)||!['prepare','rehearse','install','verify'].includes(phase)||process.argv.length!==4)throw Error('Specify test|production and prepare|rehearse|install|verify');
const project=projects[environment],release='quickbooks_retained_finance_v1',name='20261102040000_learn_quickbooks_retained_finance.sql',source=readFileSync('supabase/migrations/'+name,'utf8'),base=readFileSync('supabase/migrations/20261102020000_learn_quickbooks_customer_finance.sql','utf8');
const hash=s=>createHash('sha256').update(typeof s==='string'?s:JSON.stringify(s)).digest('hex'),md5=s=>createHash('md5').update(s).digest('hex'),quote=s=>"'"+s.replaceAll("'","''")+"'";
const extract=s=>[...s.matchAll(/create function public\.(learn_quickbooks_[a-z_]+)\([\s\S]*?\$\$([\s\S]*?)\$\$;/g)].map(m=>({name:m[1],bodyHash:md5(m[2]),body:m[2]}));
const readers=['learn_quickbooks_customer_candidates','learn_quickbooks_customer_finance'],helper='learn_quickbooks_retained_finance_access';
const old=extract(base).filter(f=>[...readers,'learn_quickbooks_finance_access'].includes(f.name));
const expected=[...old.filter(f=>readers.includes(f.name)).map(f=>({name:f.name,bodyHash:md5(f.body.replaceAll('public.learn_quickbooks_finance_access(','public.learn_quickbooks_retained_finance_access('))})),...extract(source).map(({name,bodyHash})=>({name,bodyHash}))];
if(old.length!==3||expected.length!==3)throw Error('Unexpected source functions');
const dir='.verification-results/quickbooks-retained-finance-'+environment;mkdirSync(dir,{recursive:true,mode:0o700});
const file=dir+'/prepared.json',token=savedCliToken();
async function query(sql,write=false){const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${write?'':'/read-only'}`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:sql,...(write?{read_only:false}:{})}),redirect:'error',signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('Database response '+r.status+'; reconcile receipt before any retry');return r.json();}
const metadataSql=`select p.proname name,p.oid::regprocedure::text signature,md5(p.prosrc) "bodyHash",pg_get_userbyid(p.proowner) owner,p.proacl acl,p.proconfig config,p.prosecdef definer from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'learn_quickbooks_%' order by p.oid::regprocedure::text`;
const countsSql=`select jsonb_build_object('sources',(select count(*) from learn_quickbooks_source_versions),'sourceDigest',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from learn_quickbooks_source_versions t),'pages',(select count(*) from learn_quickbooks_pages),'links',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by tenant_id,environment,realm_id,external_id),'')) from learn_quickbooks_customer_links t),'flags',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by tenant_id,flag),'')) from feature_flags t),'grants',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from platform_authority_grants t)) state`;
const snapshot=async()=>({functions:await query(metadataSql),data:(await query(countsSql))[0].state});
const receipt=async()=>await query(`select source_hashes,installed_at from learn_quickbooks_release_receipts where release_id=${quote(release)}`);
function validateAfter(before,after){
 for(const e of expected){const f=after.functions.find(f=>f.name===e.name);if(!f||f.bodyHash!==e.bodyHash||f.owner!=='postgres'||!f.definer||JSON.stringify(f.config)!=='["search_path=pg_catalog"]')throw Error('Changed function differs');}
 const strip=fs=>fs.filter(f=>f.name!==helper).map(f=>({...f,bodyHash:readers.includes(f.name)?'reader-body':f.bodyHash}));
 if(hash(strip(before.functions))!==hash(strip(after.functions))||hash(before.data)!==hash(after.data))throw Error('Pre-existing functions/access/data changed; inspect');
}
if(phase==='prepare'){
 if(existsSync(file)||(await receipt()).length)throw Error('Existing preparation/receipt; inspect instead');
 const before=await snapshot();if(before.functions.some(f=>f.name===helper))throw Error('Unexpected helper already present');
 for(const e of old)if(!before.functions.some(f=>f.name===e.name&&f.bodyHash===e.bodyHash&&f.owner==='postgres'))throw Error('Base reader/access differs');
 const guards=before.functions.map(f=>`if not exists(select 1 from pg_proc where oid=to_regprocedure(${quote(f.signature)}) and md5(prosrc)=${quote(f.bodyHash)} and pg_get_userbyid(proowner)=${quote(f.owner)}) then raise exception 'QuickBooks prerequisite changed';end if;`).join('\n');
 const bundle=`begin;set local lock_timeout='5s';set local statement_timeout='40s';\ndo $guard$ begin if current_setting('serviceos.quickbooks_target',true) is distinct from '${project}' then raise exception 'Wrong project';end if;${guards} end $guard$;\n${source.replace(/^begin;$/m,'').replace(/^commit;$/m,'')}\ninsert into learn_quickbooks_release_receipts(release_id,source_hashes) values('${release}',${quote(JSON.stringify([{name,sha256:hash(source)}]))}::jsonb);\nnotify pgrst,'reload schema';\ncommit;\n`;
 writeFileSync(dir+'/release.sql',bundle,{mode:0o600,flag:'wx'});writeFileSync(file,JSON.stringify({project,release,sourceSha256:hash(source),bundleSha256:hash(bundle),preparedAt:new Date().toISOString(),before},null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify({state:'prepared',project,sourceSha256:hash(source),existingSources:before.data.sources}));
}else{
 const p=JSON.parse(readFileSync(file)),bundle=readFileSync(dir+'/release.sql','utf8');if(p.project!==project||p.sourceSha256!==hash(source)||p.bundleSha256!==hash(bundle))throw Error('Prepared package changed');
 if(phase==='rehearse'||phase==='install'){
  if((await receipt()).length||hash(await snapshot())!==hash(p.before))throw Error('Database changed or already installed');
  const attempt=dir+'/'+phase+'-attempt.json';if(existsSync(attempt))throw Error('Existing attempt; reconcile');
  if(phase==='install'){const r=JSON.parse(readFileSync(dir+'/rehearsed.json'));if(r.sourceSha256!==hash(source)||Date.now()-Date.parse(r.checkedAt)>600000)throw Error('Fresh hosted rehearsal required');}
  writeFileSync(attempt,JSON.stringify({project,requestedAt:new Date().toISOString()}),{mode:0o600,flag:'wx'});
  await query(`set serviceos.quickbooks_target='${project}';\n`+(phase==='rehearse'?bundle.replace(/commit;\n$/,'rollback;\n'):bundle),true);
  if(phase==='rehearse'){
   if((await receipt()).length||hash(await snapshot())!==hash(p.before))throw Error('Rollback not preserved');
   const r={state:'hosted_rollback_verified',project,sourceSha256:hash(source),checkedAt:new Date().toISOString()};writeFileSync(dir+'/rehearsed.json',JSON.stringify(r,null,2));console.log(JSON.stringify(r));process.exit(0);
  }
 }
 const rows=await receipt();if(rows.length!==1||JSON.stringify(rows[0].source_hashes)!==JSON.stringify([{name,sha256:hash(source)}]))throw Error('Installed receipt differs');
 const after=await snapshot();validateAfter(p.before,after);
 const access=(await query(`select not has_function_privilege('anon','${helper}(uuid,text)','execute') and not has_function_privilege('authenticated','${helper}(uuid,text)','execute') and not has_function_privilege('service_role','${helper}(uuid,text)','execute') internal`))[0];if(!access.internal)throw Error('Internal helper exposed');
 await query(readFileSync('scripts/verify/learn-quickbooks-finance-denials.sql','utf8'),true);
 const result={state:'installed_verified',project,release,sourceSha256:hash(source),installedAt:rows[0].installed_at,checkedAt:new Date().toISOString(),readerBodiesMatched:true,existingFunctionPermissionsUnchanged:true,otherQuickBooksFunctionsUnchanged:true,retainedSourcesAndLinksUnchanged:true,featureFlagsAndGrantsUnchanged:true,sources:after.data.sources,privateHelper:true,unauthorisedRpcDenials:'passed',providerRequests:0};writeFileSync(dir+'/verified.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
