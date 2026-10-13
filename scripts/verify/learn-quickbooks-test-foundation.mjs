/** Additive TEST foundation only; no app credential, user, grant or capture setup. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {savedCliToken} from './learn-test-readiness.mjs';
const project='saatxzwxvdvqevbnskxy',phase=process.argv[2];
if(!['prepare','rehearse','install','verify'].includes(phase)||process.argv.length!==3)throw Error('Specify prepare, rehearse, install or verify');
const sha=s=>createHash('sha256').update(s).digest('hex');
const root=new URL('../../',import.meta.url);
const files=['20261102000000_learn_quickbooks_oauth.sql','20261102010000_learn_quickbooks_import.sql'];
const sources=files.map(f=>readFileSync(new URL('supabase/migrations/'+f,root),'utf8'));
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const bundlePath=new URL('supabase/release/quickbooks-test/001_foundation.sql',root),manifestPath=new URL('supabase/release/quickbooks-test/001_foundation.manifest.json',root);
const catalog=readFileSync(new URL('./learn-quickbooks-preflight.sql',import.meta.url),'utf8');
const token=savedCliToken();
async function query(text,write=false){
 const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${write?'':'/read-only'}`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:text,...(write?{read_only:false}:{})}),redirect:'error',signal:AbortSignal.timeout(45000)});
 if(!r.ok)throw Error('TEST database request returned HTTP '+r.status+'; inspect receipt before any retry');
 const chunks=[];let size=0;for await(const c of r.body){size+=c.byteLength;if(size>1048576)throw Error('TEST metadata exceeds bound');chunks.push(c);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function data(rows){if(!Array.isArray(rows)||rows.length!==1)throw Error('TEST metadata incomplete');return Object.values(rows[0])[0];}
const receiptQuery="select to_regclass('public.learn_quickbooks_release_receipts') is not null as exists";
async function verify(manifest){
 const exists=(await query(receiptQuery))[0]?.exists;
 if(!exists)return {state:'not_installed',project};
 const receipts=await query("select release_id,source_hashes,installed_at from public.learn_quickbooks_release_receipts where release_id='quickbooks_foundation_v1'");
 if(receipts.length!==1||!Array.isArray(receipts[0].source_hashes)||receipts[0].source_hashes.length!==manifest.sourceHashes.length||manifest.sourceHashes.some((f,i)=>receipts[0].source_hashes[i]?.name!==f.name||receipts[0].source_hashes[i]?.sha256!==f.sha256))throw Error('TEST release receipt differs');
 const checked=await query(`select jsonb_build_object('tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'learn_quickbooks_%'),
 'privateTables',(select bool_and(c.relrowsecurity and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'learn_quickbooks_%'),
 'apps',(select count(*) from learn_quickbooks_apps),'connections',(select count(*) from learn_quickbooks_connections),'runs',(select count(*) from learn_quickbooks_imports),'pages',(select count(*) from learn_quickbooks_pages),'sources',(select count(*) from learn_quickbooks_source_versions),
 'workerServiceOnly',has_function_privilege('service_role','learn_quickbooks_import_acquire(uuid)','execute') and not has_function_privilege('authenticated','learn_quickbooks_import_acquire(uuid)','execute'),
 'operatorStart',has_function_privilege('authenticated','learn_quickbooks_import_start(uuid,uuid,uuid,jsonb)','execute') and not has_function_privilege('anon','learn_quickbooks_import_start(uuid,uuid,uuid,jsonb)','execute')) as result`);
 const result=data(checked);
 const financeReceipt=await query("select source_hashes from public.learn_quickbooks_release_receipts where release_id='quickbooks_customer_finance_v1'");
 let expectedTables=12;
 if(financeReceipt.length){
  const name='20261102020000_learn_quickbooks_customer_finance.sql';
  const hashes=financeReceipt[0].source_hashes;
  if(hashes?.length!==1||hashes[0].name!==name||hashes[0].sha256!==sha(readFileSync(new URL('supabase/migrations/'+name,root),'utf8')))throw Error('TEST finance extension receipt differs');
  expectedTables+=2;
 }
 if(result.tables!==expectedTables||result.privateTables!==true||result.workerServiceOnly!==true||result.operatorStart!==true)throw Error('TEST release verification failed');
 return {state:'installed_metadata_verified',project,...result,installedAt:receipts[0].installed_at,sourceHashes:manifest.sourceHashes};
}
try{
 if(phase==='prepare'){
  const prior=await query(receiptQuery);if(prior[0]?.exists)throw Error('TEST release already has a receipt table');
  const current=data(await query(catalog));
  if(current.existingQuickBooksObjects.length||current.functions.length!==9||current.functions.some(f=>!f.exists)||current.tables.length!==7)throw Error('TEST prerequisite objects missing or QuickBooks already present');
  const required={tenants:{id:'uuid',status:'text'},profiles:{id:'uuid'},platform_authority_grants:{profile_id:'uuid',permission:'text',effective_from:'timestamp with time zone',effective_to:'timestamp with time zone'},view_as_context:{actor_user_id:'uuid',ended_at:'timestamp with time zone',expires_at:'timestamp with time zone'},feature_flags:{tenant_id:'uuid',flag:'text',value:'jsonb'},users:{id:'uuid',deleted_at:'timestamp with time zone',banned_until:'timestamp with time zone'}};
  let guards='';
  for(const f of current.functions){
   guards+=`if not exists(select 1 from pg_proc where oid=to_regprocedure(${quote(f.signature)}) and md5(prosrc)=${quote(f.bodyHash)} and pg_get_userbyid(proowner)=${quote(f.owner)}) then raise exception 'QuickBooks prerequisite helper changed';end if;\n`;
  }
  for(const [name,cols]of Object.entries(required)){
   const t=current.tables.find(t=>t.name===name);if(!t)throw Error('TEST table absent');
   for(const [column,type]of Object.entries(cols)){
    if(!t.columns.some(c=>c.name===column&&c.type===type))throw Error('TEST column type differs: '+name+'.'+column);
    guards+=`if not exists(select 1 from pg_attribute where attrelid=to_regclass(${quote(t.schema+'.'+name)}) and attname=${quote(column)} and not attisdropped and format_type(atttypid,atttypmod)=${quote(type)}) then raise exception 'QuickBooks prerequisite column changed';end if;\n`;
   }
  }
  const sourceHashes=files.map((name,i)=>({name,sha256:sha(sources[i])}));
  const body=sources.map(s=>s.replace(/^begin;$/m,'').replace(/^commit;$/m,'')).join('\n');
  const bundle=`-- Prepared for TEST ${project}; no credentials, source data, flags or schedules.\nbegin;\nset local lock_timeout='5s';\nset local statement_timeout='40s';\ndo $guard$ begin\nif current_setting('serviceos.quickbooks_target',true) is distinct from '${project}' then raise exception 'QuickBooks TEST target required';end if;\n${guards}\nif exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'learn_quickbooks_%') then raise exception 'QuickBooks objects already exist';end if;\nend $guard$;\n${body}\ncreate table public.learn_quickbooks_release_receipts(release_id text primary key,source_hashes jsonb not null,installed_at timestamptz not null default clock_timestamp());\nalter table public.learn_quickbooks_release_receipts enable row level security;\nrevoke all on public.learn_quickbooks_release_receipts from public,anon,authenticated,service_role;\ninsert into public.learn_quickbooks_release_receipts(release_id,source_hashes) values('quickbooks_foundation_v1',${quote(JSON.stringify(sourceHashes))}::jsonb);\nnotify pgrst,'reload schema';\ncommit;\n`;
  const manifest={project,release:'quickbooks_foundation_v1',preparedAt:new Date().toISOString(),sourceHashes,bundleSha256:sha(bundle),prerequisiteHashes:current.functions.map(({signature,bodyHash})=>({signature,bodyHash})),effects:['Create QuickBooks-only tables, RPCs and receipt.','Existing authenticated operators use gated RPCs; server uses service-only worker/credential RPCs.','No apps, identities, grants, credentials, import scope, source data, flags or schedules seeded.']};
  writeFileSync(bundlePath,bundle);writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({state:'prepared',project,bundleSha256:manifest.bundleSha256,sourceHashes}));
 }else{
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8')),bundle=readFileSync(bundlePath,'utf8');
  if(manifest.project!==project||sha(bundle)!==manifest.bundleSha256||files.some((name,i)=>manifest.sourceHashes[i]?.name!==name||manifest.sourceHashes[i]?.sha256!==sha(sources[i])))throw Error('Prepared TEST source changed');
  let result=await verify(manifest);
  if(phase==='rehearse'){
   if(result.state!=='not_installed')throw Error('TEST release already installed');
   await query(`set serviceos.quickbooks_target='${project}';\n`+bundle.replace(/commit;\n$/, 'rollback;\n'),true);
   result=await verify(manifest);if(result.state!=='not_installed')throw Error('TEST rollback not confirmed');
   result={state:'hosted_rollback_verified',project,bundleSha256:manifest.bundleSha256};
  }
  if(phase==='install'&&result.state==='not_installed'){
   await query(`set serviceos.quickbooks_target='${project}';\n`+bundle,true);
   result=await verify(manifest);
  }
  mkdirSync('.verification-results',{recursive:true,mode:0o700});
  writeFileSync(`.verification-results/quickbooks-test-foundation-${Date.now()}.json`,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify(result));
 }
}catch(e){console.error(e instanceof Error&&/^(TEST|Prepared|QuickBooks)/.test(e.message)?e.message:'QuickBooks TEST setup unconfirmed; inspect release receipt before retrying.');process.exitCode=1;}
