/** Guarded TEST/LIVE release for the reviewed QuickBooks card finance reader. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { savedCliToken } from './learn-test-readiness.mjs';

const [environment,phase]=process.argv.slice(2);
const projects={test:'saatxzwxvdvqevbnskxy',production:'tgbnakbxwcqjeimygroz'};
if(!Object.hasOwn(projects,environment)||!['prepare','rehearse','install','verify'].includes(phase)||process.argv.length!==4)
 throw Error('Specify test|production and prepare|rehearse|install|verify');
const project=projects[environment];
const release='quickbooks_card_hierarchy_v1';
const source=readFileSync('supabase/migrations/20261104010000_learn_quickbooks_card_hierarchy.sql','utf8');
const signature='public.learn_quickbooks_customer_finance(uuid,uuid,text,uuid,text)';
const oldMd5='9a4a2749cbc020998419beb29d2f593a';
const sha=s=>createHash('sha256').update(s).digest('hex');
const md5=s=>createHash('md5').update(s).digest('hex');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const path='.verification-results/quickbooks-card-hierarchy-'+environment;
mkdirSync(path,{recursive:true,mode:0o700});
const planPath=path+'/plan.json';
const token=savedCliToken();

async function query(sql,write=false){
 const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${write?'':'/read-only'}`,{
  method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify({query:sql,...(write?{read_only:false}:{})}),redirect:'error',signal:AbortSignal.timeout(60000),
 });
 if(!response.ok) throw Error(`Database ${response.status}; inspect the release receipt before retrying`);
 return response.json();
}
const definition=async()=>{
 const rows=await query(`select pg_get_functiondef(${quote(signature)}::regprocedure) definition,
  md5(pg_get_functiondef(${quote(signature)}::regprocedure)) md5,
  pg_get_userbyid(p.proowner) owner,p.proacl acl,p.proconfig config,p.prosecdef definer
  from pg_proc p where p.oid=${quote(signature)}::regprocedure`);
 if(rows.length!==1)throw Error('Finance reader unavailable');
 return rows[0];
};
const receipt=async()=>await query(`select source_hashes,installed_at from public.learn_quickbooks_release_receipts where release_id=${quote(release)}`);
const needle=source.split('$old$')[1],replacement=source.split('$new$')[1];
if(!needle||!replacement||source.split('$old$').length!==3||source.split('$new$').length!==3)
 throw Error('Migration replacement fragments unavailable');
const sourceBody=source.replace(/^begin;\n/m,'').replace(/\ncommit;\s*$/m,'');
const plan=()=>JSON.parse(readFileSync(planPath,'utf8'));

if(phase==='prepare'){
 if(existsSync(planPath)||(await receipt()).length)throw Error('Existing plan or receipt; inspect it before preparing another');
 const before=await definition();
 if(before.md5!==oldMd5||before.owner!=='postgres'||!before.definer||JSON.stringify(before.config)!=='["search_path=pg_catalog"]')
  throw Error('Finance reader differs from the reviewed prerequisite');
 if(before.definition.split(needle).length!==2||before.definition.split('with links as materialized(').length!==2)
  throw Error('Finance reader patch site differs');
 // Use a callback: the SQL regex contains `$'`, which String.replace would
 // otherwise interpret as a special replacement token rather than literal SQL.
 const expected=before.definition.replace('with links as materialized(','with recursive links as materialized(').replace(needle,()=>replacement);
 const bundle=`begin;set local lock_timeout='5s';set local statement_timeout='45s';
select set_config('serviceos.quickbooks_target','${project}',true);
do $guard$ begin
 if md5(pg_get_functiondef(${quote(signature)}::regprocedure))<>${quote(oldMd5)} then raise exception 'QuickBooks finance reader changed';end if;
end $guard$;
${sourceBody}
insert into public.learn_quickbooks_release_receipts(release_id,source_hashes)
 values(${quote(release)},${quote(JSON.stringify([{name:'card_hierarchy',sha256:sha(source)}]))}::jsonb);
notify pgrst,'reload schema';
commit;\n`;
 const prepared={project,release,sourceSha256:sha(source),bundleSha256:sha(bundle),expectedMd5:md5(expected),
  before:{md5:before.md5,owner:before.owner,acl:before.acl,config:before.config,definer:before.definer},
  preparedAt:new Date().toISOString()};
 writeFileSync(path+'/release.sql',bundle,{mode:0o600,flag:'wx'});
 writeFileSync(planPath,JSON.stringify(prepared,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({state:'prepared',project,sourceSha256:prepared.sourceSha256,expectedMd5:prepared.expectedMd5}));
}else{
 const prepared=plan(),bundle=readFileSync(path+'/release.sql','utf8');
 if(prepared.project!==project||prepared.sourceSha256!==sha(source)||prepared.bundleSha256!==sha(bundle))
  throw Error('Prepared release differs from the current source');
 if(phase==='rehearse'||phase==='install'){
  if((await receipt()).length)throw Error('Release already installed; use verify');
  const current=await definition();
  if(current.md5!==prepared.before.md5||JSON.stringify(current.acl)!==JSON.stringify(prepared.before.acl))
   throw Error('Finance reader or grant changed since preparation');
  if(phase==='install'){
   const rehearsal=JSON.parse(readFileSync(path+'/rehearsed.json','utf8'));
   if(rehearsal.sourceSha256!==prepared.sourceSha256||Date.now()-Date.parse(rehearsal.checkedAt)>600000)
    throw Error('Fresh hosted rollback rehearsal required');
  }
  const attempt=path+'/'+phase+'-attempt.json';
  if(existsSync(attempt))throw Error('Prior attempt exists; reconcile before retrying');
  writeFileSync(attempt,JSON.stringify({project,requestedAt:new Date().toISOString()}),{mode:0o600,flag:'wx'});
  await query(phase==='rehearse'?bundle.replace(/commit;\s*$/,'rollback;'):bundle,true);
  if(phase==='rehearse'){
   if((await receipt()).length||(await definition()).md5!==prepared.before.md5)throw Error('Rollback changed hosted state');
   const result={state:'hosted_rollback_verified',project,sourceSha256:prepared.sourceSha256,checkedAt:new Date().toISOString()};
   writeFileSync(path+'/rehearsed.json',JSON.stringify(result,null,2)+'\n');
   console.log(JSON.stringify(result));process.exit(0);
  }
 }
 const installed=await receipt(),after=await definition();
 if(installed.length!==1||JSON.stringify(installed[0].source_hashes)!==JSON.stringify([{name:'card_hierarchy',sha256:prepared.sourceSha256}])
  ||after.md5!==prepared.expectedMd5||after.owner!==prepared.before.owner||after.definer!==prepared.before.definer
  ||JSON.stringify(after.acl)!==JSON.stringify(prepared.before.acl)
  ||JSON.stringify(after.config)!==JSON.stringify(prepared.before.config))
  throw Error('Installed function, receipt or access differs; inspect before retrying');
 await query(readFileSync('scripts/verify/learn-quickbooks-finance-denials.sql','utf8'),true);
 const result={state:'installed_verified',project,release,sourceSha256:prepared.sourceSha256,
  installedAt:installed[0].installed_at,checkedAt:new Date().toISOString(),
  functionBodyMatched:true,ownerAndPermissionsPreserved:true,unauthorisedRpcDenials:'passed',providerRequests:0};
 writeFileSync(path+'/verified.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
}
