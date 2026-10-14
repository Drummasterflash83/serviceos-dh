/** Guarded, additive speed-up of the private imported customer summary reader. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {savedCliToken} from '../verify/learn-test-readiness.mjs';
const [mode,project]=process.argv.slice(2);
if(!['plan','apply','verify'].includes(mode)||!['saatxzwxvdvqevbnskxy','tgbnakbxwcqjeimygroz'].includes(project))throw Error('Explicit mode and project required');
const dir=`.verification-results/imported-customer-summary-${project}`;mkdirSync(dir,{recursive:true});
const migration=readFileSync('supabase/migrations/20261102290000_learn_imported_customer_summary_fast.sql','utf8');
const sourceMigration=readFileSync('supabase/migrations/20261102250000_learn_imported_customer_catalog.sql','utf8');
const original=sourceMigration.match(/create function public\.learn_imported_customer_sources[\s\S]*?as \$\$([\s\S]*?)\$\$;/)?.[1];
const digest=s=>createHash('md5').update(s).digest('hex');
const hash=createHash('sha256').update(migration).digest('hex');
if(!original||(original.match(/public\.learn_business_customer_summary/g)??[]).length!==3)throw Error('Source contract changed');
const beforeHash=digest(original),afterHash=digest(original.replaceAll('public.learn_business_customer_summary','public.learn_imported_customer_summary'));
const token=savedCliToken();
async function query(q,readonly=true){const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readonly?'/read-only':''}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:q}),signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(`Database query ${r.status}; inspect before retry`);return r.json();}
const statusSql=`select jsonb_build_object('source',(select jsonb_build_object('body',md5(prosrc),'acl',proacl::text,'owner',proowner::regrole::text,'config',proconfig,'definer',prosecdef) from pg_proc where oid='public.learn_imported_customer_sources(uuid,text)'::regprocedure),'oldSummary',(select md5(prosrc) from pg_proc where oid='public.learn_business_customer_summary(jsonb)'::regprocedure),'catalog',(select md5(prosrc) from pg_proc where oid='public.learn_imported_customer_catalog(uuid,text,text,text,text,text,text)'::regprocedure),'newSummary',(select jsonb_build_object('acl',proacl::text,'config',proconfig,'definer',prosecdef,'anon',has_function_privilege('anon',oid,'execute'),'authenticated',has_function_privilege('authenticated',oid,'execute'),'service',has_function_privilege('service_role',oid,'execute')) from pg_proc where oid=to_regprocedure('public.learn_imported_customer_summary(jsonb)')),'newText',(select jsonb_build_object('acl',proacl::text,'config',proconfig,'definer',prosecdef,'anon',has_function_privilege('anon',oid,'execute'),'authenticated',has_function_privilege('authenticated',oid,'execute'),'service',has_function_privilege('service_role',oid,'execute')) from pg_proc where oid=to_regprocedure('public.learn_imported_customer_text(jsonb,text[])'))) evidence`;
async function status(){return(await query(statusSql))[0].evidence;}
const current=await status(),planFile=`${dir}/plan.json`,intentFile=`${dir}/intent.json`;
if(mode==='plan'){
 if(existsSync(planFile)||current.source?.body!==beforeHash||current.newSummary!==null||current.newText!==null||!current.source.config?.includes('search_path=pg_catalog'))throw Error('Summary baseline differs');
 writeFileSync(planFile,JSON.stringify({project,hash,beforeHash,afterHash,before:current},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({project,state:'prepared',hash,unchangedCatalog:true}));
}else{
 const plan=JSON.parse(readFileSync(planFile,'utf8'));
 if(plan.project!==project||plan.hash!==hash||plan.beforeHash!==beforeHash||plan.afterHash!==afterHash||current.oldSummary!==plan.before.oldSummary||current.catalog!==plan.before.catalog||current.source.owner!==plan.before.source.owner||current.source.acl!==plan.before.source.acl||JSON.stringify(current.source.config)!==JSON.stringify(plan.before.source.config))throw Error('Summary baseline or authority changed');
 if(mode==='apply'){
  if(current.source.body!==beforeHash||current.newSummary!==null||current.newText!==null||existsSync(intentFile))throw Error('Summary already attempted; verify first');
  writeFileSync(intentFile,JSON.stringify({project,hash,at:new Date().toISOString()}),{flag:'wx'});
  await query(migration,false);
 }
 const after=await status();
 for(const h of [after.newSummary,after.newText])if(!h||h.definer||h.anon||h.authenticated||h.service||h.config!==null)throw Error('New private helper authority differs');
 if(after.source.body!==afterHash||after.source.acl!==plan.before.source.acl||after.source.owner!==plan.before.source.owner||after.source.definer!==plan.before.source.definer||JSON.stringify(after.source.config)!==JSON.stringify(plan.before.source.config)||after.catalog!==plan.before.catalog||after.oldSummary!==plan.before.oldSummary)throw Error('Existing reader or review contract differs');
 writeFileSync(`${dir}/verified.json`,JSON.stringify({project,hash,checkedAt:new Date().toISOString(),sourceBody:afterHash,privateHelpers:true,priorAuthorityPreserved:true,providerRequests:0,recordWrites:0},null,2)+'\n');
 console.log(JSON.stringify({project,state:'verified',priorAuthorityPreserved:true,privateHelpers:true}));
}
