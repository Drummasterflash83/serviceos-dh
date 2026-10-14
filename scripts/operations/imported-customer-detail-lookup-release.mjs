/** One-source lookup correction for the customer detail reader. No source writes. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { savedCliToken } from '../verify/learn-test-readiness.mjs';
const [mode, project] = process.argv.slice(2);
if (!['plan','apply','verify'].includes(mode) || !['saatxzwxvdvqevbnskxy','tgbnakbxwcqjeimygroz'].includes(project))
  throw Error('Explicit mode and known project required');
const dir=`.verification-results/imported-customer-detail-lookup-${project}`;mkdirSync(dir,{recursive:true});
const sql=readFileSync('supabase/migrations/20261102280000_learn_imported_customer_detail_lookup.sql','utf8');
const hash=createHash('sha256').update(sql).digest('hex');
const original=readFileSync('supabase/migrations/20261102260000_learn_imported_customer_details.sql','utf8').match(/create function public\.learn_imported_customer_detail[\s\S]*?as \$\$([\s\S]*?)\$\$;/)?.[1];
if(!original||createHash('md5').update(original).digest('hex')!=='4e8c1b522bf2db572f936c803d66d6ac')throw Error('Original detail source differs');
const patchBody=original
 .replace('select * into root from public.learn_imported_customer_sources(p_tenant,p_environment) where source_key=p_source_key;','select * into root from public.learn_imported_customer_source_ref(p_tenant,p_environment,p_source_key);')
 .replace("root.review_state='source_conflict'",'root.conflicted')
 .replace("public.learn_imported_customer_sources(p_tenant,p_environment) s where s.source_key=p_source_key and s.version_id=p_source_version and s.review_state<>'source_conflict'",'public.learn_imported_customer_source_ref(p_tenant,p_environment,p_source_key) s where s.version_id=p_source_version and not s.conflicted');
const expected=createHash('md5').update(patchBody).digest('hex');
if(expected==='4e8c1b522bf2db572f936c803d66d6ac'||patchBody.includes('learn_imported_customer_sources(p_tenant,p_environment)'))throw Error('Prepared lookup patch incomplete');
const token=savedCliToken();
async function query(text,readonly=true){const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readonly?'/read-only':''}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:text}),signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(`Database request ${r.status}; inspect before retry`);return r.json();}
const statusSql=`select jsonb_build_object('detail',(select jsonb_build_object('body',md5(prosrc),'acl',proacl::text,'owner',proowner::regrole::text,'definer',prosecdef,'config',proconfig) from pg_proc where oid='public.learn_imported_customer_detail(uuid,text,text,uuid,text,uuid,text)'::regprocedure),'helper',(select jsonb_build_object('body',md5(prosrc),'acl',proacl::text,'owner',proowner::regrole::text,'definer',prosecdef,'config',proconfig,'anon',has_function_privilege('anon',oid,'execute'),'authenticated',has_function_privilege('authenticated',oid,'execute'),'service',has_function_privilege('service_role',oid,'execute')) from pg_proc where oid=to_regprocedure('public.learn_imported_customer_source_ref(uuid,text,text)')),'catalog',(select md5(prosrc) from pg_proc where oid='public.learn_imported_customer_catalog(uuid,text,text,text,text,text,text)'::regprocedure)) evidence`;
async function status(){return(await query(statusSql))[0].evidence;}
const current=await status(),planFile=`${dir}/plan.json`,intentFile=`${dir}/intent.json`;
if(mode==='plan'){
 if(existsSync(planFile)||current.detail?.body!=='4e8c1b522bf2db572f936c803d66d6ac'||current.helper!==null||!current.detail.definer||!current.detail.config?.includes('search_path=pg_catalog'))throw Error('Detail baseline changed');
 writeFileSync(planFile,JSON.stringify({project,hash,expected,before:current},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({project,state:'prepared',hash,expected}));
}else{
 const plan=JSON.parse(readFileSync(planFile,'utf8'));
 if(plan.project!==project||plan.hash!==hash||plan.expected!==expected||current.catalog!==plan.before.catalog||current.detail?.owner!==plan.before.detail.owner||current.detail?.acl!==plan.before.detail.acl||JSON.stringify(current.detail?.config)!==JSON.stringify(plan.before.detail.config))throw Error('Detail baseline or permissions changed');
 if(mode==='apply'){
  if(current.detail.body!==plan.before.detail.body||current.helper!==null||existsSync(intentFile))throw Error('Lookup patch already attempted; verify first');
  writeFileSync(intentFile,JSON.stringify({project,hash,at:new Date().toISOString()}),{flag:'wx'});
  await query(sql,false);
 }
 const after=await status();
 if(after.detail.body!==expected||after.detail.acl!==plan.before.detail.acl||after.detail.owner!==plan.before.detail.owner||after.detail.definer!==plan.before.detail.definer||JSON.stringify(after.detail.config)!==JSON.stringify(plan.before.detail.config)||after.catalog!==plan.before.catalog||!after.helper||after.helper.definer||after.helper.anon||after.helper.authenticated||after.helper.service||!after.helper.config?.includes('search_path=pg_catalog'))throw Error('Hosted lookup or authority differs');
 writeFileSync(`${dir}/verified.json`,JSON.stringify({project,hash,expected,checkedAt:new Date().toISOString(),oldAuthorityPreserved:true,helperPrivate:true,catalogPreserved:true,providerRequests:0,recordWrites:0},null,2)+'\n');
 console.log(JSON.stringify({project,state:'verified',oldAuthorityPreserved:true,helperPrivate:true}));
}
