/** Additive retained-customer search under existing logged operator authority.
 * No capture, links, grants to people, credentials or provider calls. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {savedCliToken} from '../verify/learn-test-readiness.mjs';
const [mode,project]=process.argv.slice(2);
if(!['plan','apply','verify'].includes(mode)||!['saatxzwxvdvqevbnskxy','tgbnakbxwcqjeimygroz'].includes(project))throw Error('Explicit mode and project required');
const dir=`.verification-results/quickbooks-customer-search-${project}`;mkdirSync(dir,{recursive:true});
const sql=readFileSync('supabase/migrations/20261102200000_learn_quickbooks_customer_search.sql','utf8'),hash=createHash('sha256').update(sql).digest('hex');
const token=savedCliToken();
async function query(text,readonly=true){const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readonly?'/read-only':''}`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:text}),signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Database request '+r.status+'; inspect before retry');return r.json();}
const catalog=`select jsonb_build_object('checkedAt',clock_timestamp(),'existing',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body',md5(pg_get_functiondef(p.oid)),'acl',p.proacl::text,'owner',p.proowner::regrole::text) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'learn_quickbooks_%' and p.proname<>'learn_quickbooks_customer_search'),'new',(select jsonb_build_object('body',md5(pg_get_functiondef(p.oid)),'definer',p.prosecdef,'config',p.proconfig,'owner',p.proowner::regrole::text,'anon',has_function_privilege('anon',p.oid,'execute'),'authenticated',has_function_privilege('authenticated',p.oid,'execute'),'service',has_function_privilege('service_role',p.oid,'execute')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='learn_quickbooks_customer_search')) evidence`;
const current=(await query(catalog))[0].evidence,file=dir+'/plan.json';
if(mode==='plan'){
 if(existsSync(file)||current.new!==null||!current.existing.some(x=>x.signature.startsWith('learn_quickbooks_retained_finance_access(')))throw Error('Inspect existing release or missing helper');
 writeFileSync(file,JSON.stringify({project,hash,before:current,scope:'additive logged operator search, no source/link mutations'},null,2)+'\n');console.log(JSON.stringify({project,state:'prepared',hash}));
}else{
 const plan=JSON.parse(readFileSync(file));if(plan.project!==project||plan.hash!==hash||JSON.stringify(current.existing)!==JSON.stringify(plan.before.existing))throw Error('Source or existing functions changed');
 if(mode==='apply'){
  if(current.new!==null||existsSync(dir+'/intent.json'))throw Error('Release already attempted; inspect');
  writeFileSync(dir+'/intent.json',JSON.stringify({project,hash,startedAt:new Date().toISOString()}),{flag:'wx'});
  await query(sql,false);
 }
 const after=(await query(catalog))[0].evidence;
 if(JSON.stringify(after.existing)!==JSON.stringify(plan.before.existing)||!after.new?.definer||after.new.anon||!after.new.authenticated||after.new.service||!after.new.config.includes('search_path=pg_catalog'))throw Error('Release permissions or preservation unconfirmed');
 const expected=sql.slice(sql.indexOf('declare entries'),sql.indexOf('\nend $$;')+5);
 const source=(await query("select prosrc from pg_proc where oid='public.learn_quickbooks_customer_search(uuid,text,text,text,uuid)'::regprocedure"))[0].prosrc;
 if(source.trim()!==expected.trim())throw Error('Search body differs');
 writeFileSync(dir+'/verified.json',JSON.stringify({project,hash,checkedAt:after.checkedAt,existingFunctionsPreserved:true,permissionsVerified:true,sourceBodyVerified:true,providerCalls:0,sourceAndLinkWrites:0},null,2)+'\n');console.log(JSON.stringify({project,state:'verified',existingFunctionsPreserved:true,permissionsVerified:true}));
}
