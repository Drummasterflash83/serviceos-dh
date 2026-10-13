/** Prepare only: pair the six TEST-verified Slack campaign migrations for production. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read=p=>readFileSync(p,'utf8'),hash=s=>createHash('sha256').update(s).digest('hex'),quote=s=>"'"+s.replaceAll("'","''")+"'";
const root='supabase/release/learn-production/';
const prior=JSON.parse(read(root+'023_commusoft_review_planning.manifest.json'));
if(hash(read(root+'023_commusoft_review_planning.sql'))!==prior.sha256)throw Error('Prior package differs');
const accepted=JSON.parse(read('docs/operations/evidence/learn-slack-campaign-hosted-2026-10-13.json'));
const test=JSON.parse(read('supabase/release/learn-test/092_slack_campaigns.manifest.json'));
if(accepted.state!=='test_schema_runtime_frontend_and_signed_in_idle_read_verified'||accepted.schema.packageSha256!==test.sha256||accepted.http.checks.length!==17||accepted.http.checks.some(c=>!c.passed))throw Error('Matching hosted TEST acceptance required');
const before=JSON.parse(read('.verification-results/production-review-planning-rehearsal-v4/schema.json'));
const after=JSON.parse(read('.verification-results/slack-campaign-controller-rehearsal-v1/schema.json'));
const proof=JSON.parse(read('.verification-results/slack-campaign-controller-rehearsal-v1/report.json'));
if(proof.state!=='slack_historical_ranges_rehearsed_offline'||!proof.containerRemoved||proof.journeys.length!==10||proof.journeys.some(j=>!j.passed))throw Error('Full-schema campaign journeys required');
const key=f=>JSON.stringify([f.name,f.arguments]);
const old=new Map(before.functions.map(f=>[key(f),f])),fresh=new Map(after.functions.map(f=>[key(f),f]));
const changed=before.functions.filter(f=>JSON.stringify(f)!==JSON.stringify(fresh.get(key(f))));
if(changed.length!==14||changed.some(f=>!fresh.has(key(f))||JSON.stringify({...f,hash:fresh.get(key(f)).hash})!==JSON.stringify(fresh.get(key(f)))))throw Error('Reviewed existing function authority differs');
const added=after.functions.filter(f=>!old.has(key(f)));
const newTables=after.tables.filter(t=>!before.tables.some(p=>p.name===t.name)).map(t=>t.name).sort();
if(added.length!==19||newTables.length!==7||JSON.stringify(before.views)!==JSON.stringify(after.views)||before.tables.some(t=>JSON.stringify(t)!==JSON.stringify(after.tables.find(a=>a.name===t.name))))throw Error('Reviewed schema delta differs');
const sources=test.sources;
if(sources.length!==6)throw Error('Six reviewed sources required');
const bodies=sources.map(s=>{const text=read(s.path);if(hash(text)!==s.sha256)throw Error('Source pin differs');return text.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');});
const contextRoot='.verification-results/production-slack-campaign-context-v1/';
const contextProof=JSON.parse(read(contextRoot+'report.json'));
const contextSchema=JSON.parse(read(contextRoot+'package-schema.json'));
if(contextProof.state!=='context_inspected_offline'||!contextProof.containerRemoved||contextProof.defaultContext.bodyHash!==contextProof.packageContext.bodyHash||contextProof.packageContext.currentUser!=='postgres'||contextProof.packageContext.searchPath!=='public, pg_catalog'||JSON.stringify(JSON.parse(read(contextRoot+'default-schema.json')))!==JSON.stringify(before))throw Error('Exact package-context inspection required');
const guarded=changed.map(f=>{const current=contextSchema.functions.find(v=>key(v)===key(f));if(!current||JSON.stringify({...f,hash:current.hash})!==JSON.stringify(current))throw Error('Package context changed authority');return current;});
// PostgreSQL deparses composite return types differently with public on search_path.
// Pin the same role/search_path used by the guard; do not weaken drift checks.
const guards=guarded.map(f=>` if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=${quote(f.name)} and pg_get_function_identity_arguments(p.oid)=${quote(f.arguments)} and md5(pg_get_functiondef(p.oid))=${quote(f.hash)} and pg_get_userbyid(p.proowner)=${quote(f.owner)} and p.prosecdef=${f.securityDefiner} and has_function_privilege('anon',p.oid,'EXECUTE')=${f.anonExecute} and has_function_privilege('authenticated',p.oid,'EXECUTE')=${f.authenticatedExecute} and has_function_privilege('service_role',p.oid,'EXECUTE')=${f.serviceExecute}) then raise exception 'Prior Slack function changed: ${f.name}';end if;`).join('\n');
const sql=`-- DRAFT: paired historical ranges, message kinds, campaign lifecycle/controller. No capture activation.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'')!~'^[a-f0-9]{64}$'
 then raise exception 'Production Slack campaign target/checksum required';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_slack_campaigns_v1')
 then raise exception 'Slack campaigns already installed; inspect before retry';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_commusoft_review_planning_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}')
 then raise exception 'Pinned Slack campaign prerequisite missing';end if;
 if exists(select 1 from public.platform_jobs where job_type in('slack.history_sync','slack.thread_sync') and status in('queued','running','retrying'))
 or exists(select 1 from public.slack_recurring_channels where enabled)
 then raise exception 'Slack capture must be idle for campaign installation';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array[${newTables.map(quote).join(',')}]))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${added.map(f=>quote(f.name)).join(',')}]))
 then raise exception 'Slack campaign objects already exist; inspect before retry';end if;
${guards}
end$$;
${bodies.join('\n')}
insert into of_learn_deploy.migrations values('learn_slack_campaigns_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const manifest={version:'learn-production-slack-campaigns/1',status:'prepared_requires_release_rehearsal',projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),priorSha256:prior.sha256,baselineArchive:prior.baselineArchive,sources,newFunctions:added.map(f=>f.name).sort(),changedFunctions:changed.map(f=>f.name).sort(),newTables,changedViews:[],newSequences:[],extendedTables:{},limitations:['Installation creates no campaign, account, credential, access grant or active capture.','Requires the matching runtime, scheduler and frontend release; original shared-worker code cannot dispatch campaigns.','Real provider history/replies and ongoing acceptance remain outstanding; DMs excluded.']};
const stem=root+'024_slack_campaigns';
writeFileSync(stem+'.sql',sql,{flag:'wx'});writeFileSync(stem+'.manifest.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({state:'prepared',sha256:manifest.sha256,changedFunctions:changed.length,newFunctions:added.length,newTables:newTables.length,productionChanged:false}));
