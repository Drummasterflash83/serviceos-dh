/** TEST-only additive list-reader metadata; no grants, rows, capture or workers. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {savedCliToken} from './learn-test-readiness.mjs';
const phase=process.argv[2],project='saatxzwxvdvqevbnskxy';
if(process.argv.length!==3||!['prepare','rehearse','apply','verify'].includes(phase))throw Error('Specify prepare, rehearse, apply or verify');
const path='supabase/migrations/20261101971000_learn_slack_control_capabilities.sql',source=readFileSync(path,'utf8');
const hash=s=>createHash('sha256').update(s).digest('hex'),quote=s=>"'"+s.replaceAll("'","''")+"'";
const root='.verification-results/slack-test-capabilities';mkdirSync(root,{recursive:true,mode:0o700});
const token=savedCliToken();
async function query(query,write=false){const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${write?'':'/read-only'}`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query,...(write?{read_only:false}:{})}),redirect:'error',signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('TEST SQL outcome unconfirmed: '+r.status);return r.json();}
const catalog=`select jsonb_build_object(
 'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'config',p.proconfig,'securityDefiner',p.prosecdef,
 'otherFunctions',(select md5(string_agg(pg_get_functiondef(x.oid)||coalesce(x.proacl::text,'')||x.proowner::text,'' order by x.oid)) from pg_proc x where x.pronamespace='public'::regnamespace and x.prokind='f' and x.oid<>p.oid),
 'memberships',(select md5(coalesce(jsonb_agg(to_jsonb(m) order by roleid,member,grantor)::text,'')) from pg_auth_members m),
 'canExecute',jsonb_build_object('anon',has_function_privilege('anon',p.oid,'execute'),'authenticated',has_function_privilege('authenticated',p.oid,'execute'),'serviceRole',has_function_privilege('service_role',p.oid,'execute')),
 'capabilityState',jsonb_build_object('sourceReplay',to_regprocedure('public.learn_slack_campaign_source_replay(uuid,uuid,jsonb,text)') is not null,'pageRecovery',to_regprocedure('public.learn_slack_campaign_recover_page(uuid,uuid,jsonb,text)') is not null and to_regprocedure('public.learn_slack_campaign_recovery_read(uuid,uuid,uuid,uuid)') is not null)
 ) metadata from pg_proc p where p.oid='public.learn_slack_campaign_list(uuid,uuid)'::regprocedure`;
const inspect=async()=>{const rows=await query(catalog);if(rows.length!==1)throw Error('TEST reader absent');return rows[0].metadata;};
const before=await inspect();
const needle=source.match(/needle text:= \$needle\$([\s\S]*?)\$needle\$/)?.[1],replacement=source.match(/replacement text:= \$replacement\$([\s\S]*?)\$replacement\$/)?.[1];
if(!needle||!replacement)throw Error('Release source parser differs');
if(phase==='prepare'){
 if(before.definition.includes("'capabilities'")||before.definition.split(needle).length!==2||before.canExecute.anon!==false||before.canExecute.authenticated!==true||before.canExecute.serviceRole!==false)throw Error('TEST reader baseline/access differs');
 const plan={project,path,sourceSha256:hash(source),before,expectedDefinition:before.definition.replace(needle,replacement)};
 writeFileSync(root+'/plan.json',JSON.stringify(plan,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({state:'prepared',project,sourceSha256:plan.sourceSha256,capabilities:before.capabilityState}));
}else{
 const plan=JSON.parse(readFileSync(root+'/plan.json','utf8'));
 if(plan.project!==project||plan.sourceSha256!==hash(source))throw Error('TEST release source changed');
 if(phase!=='verify'){
  if(JSON.stringify(before)!==JSON.stringify(plan.before))throw Error('TEST baseline changed');
  if(phase==='apply'){const proof=JSON.parse(readFileSync(root+'/rehearse.json','utf8'));if(proof.state!=='rolled_back_verified'||proof.sourceSha256!==plan.sourceSha256)throw Error('Exact rollback rehearsal required');}
  writeFileSync(root+'/'+phase+'-intent.json',JSON.stringify({phase,project,sourceSha256:plan.sourceSha256,at:new Date().toISOString()}),{flag:'wx',mode:0o600});
  const guard=`do $guard$begin if pg_get_functiondef('public.learn_slack_campaign_list(uuid,uuid)'::regprocedure) is distinct from ${quote(plan.before.definition)} then raise exception 'Reader drift';end if;end $guard$;`;
  const core=source.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
  const check=`do $guard$begin if pg_get_functiondef('public.learn_slack_campaign_list(uuid,uuid)'::regprocedure) is distinct from ${quote(plan.expectedDefinition)} then raise exception 'Result differs';end if;end $guard$;`;
  await query(`begin;set local lock_timeout='3s';set local statement_timeout='30s';${guard}\n${core}\n${check}\n${phase==='apply'?"notify pgrst,'reload schema';commit;":"rollback;"}`,true);
 }
 const after=await inspect(),expected=phase==='rehearse'?plan.before:{...plan.before,definition:plan.expectedDefinition};
 if(JSON.stringify(after)!==JSON.stringify(expected))throw Error('TEST reader or surrounding authority changed');
 for(const role of ['anon','service_role','authenticated']){
  await query(`begin;set local role ${role};do $probe$begin begin perform public.learn_slack_campaign_list('00000000-0000-4000-8000-000000000001',null);raise exception 'Unsigned reader accepted';exception when insufficient_privilege then null;end;end $probe$;rollback;`,true);
 }
 const report={state:phase==='rehearse'?'rolled_back_verified':'installed_reader_verified',project,observedAt:new Date().toISOString(),sourceSha256:plan.sourceSha256,definitionSha256:hash(after.definition),capabilities:after.capabilityState,owner:after.owner,aclUnchanged:JSON.stringify(after.acl)===JSON.stringify(plan.before.acl),otherFunctionsUnchanged:true,membershipsUnchanged:true,denialProbes:['anon','service_role','authenticated_without_session'],dataMutations:0,captureChanges:0,providerRequests:0};
 writeFileSync(root+'/'+phase+'.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}
