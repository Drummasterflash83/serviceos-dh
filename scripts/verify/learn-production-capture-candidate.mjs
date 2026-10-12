/** Build production capture controls without replacing existing operator authority. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(p,'utf8'),hash=s=>createHash('sha256').update(s).digest('hex');
const literal=s=>`'${s.replaceAll("'","''")}'`;
const sources=[
  {
    "path": "supabase/migrations/20261031160000_learn_operator_inputs.sql",
    "sha256": "58bf52b1bd1ce8ef220c52cdf927571dc7f06cc3a7c95b5a9978dae2b7be7f9b"
  },
  {
    "path": "supabase/migrations/20261031230000_learn_capture_controls.sql",
    "sha256": "51265e71ef999ecbf27673220ea04ef6cc1711fd81cc1848bb74513a10c73067"
  }
] ;
const select=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);if(i<0||j<=i)throw Error('Capture source boundary differs');return s.slice(i,j);};
const inputs=sources.map(s=>{const b=read(s.path);if(hash(b)!==s.sha256)throw Error('Capture source pin differs');return b;});
// Bring forward only the shared operator authority and immutability helpers.
// The Commusoft request/read functions follow their own connector prerequisites.
const authority=select(inputs[0],'create function public.learn_operator_input_immutable()', 'create trigger learn_operator_input_immutable')+
 select(inputs[0],'create function public.learn_operator_input_access(', '-- Explicit booleans only.')+
 'revoke all on function public.learn_operator_input_immutable(),public.learn_operator_input_access(uuid,uuid,boolean) from public,anon,authenticated,service_role;\n';
const predicate=select(inputs[1],'create function public.learn_capture_allowed(', '-- Operator data');
if(inputs[1].split(predicate).length!==2)throw Error('Capture predicate boundary differs');
// Package 006 already installed this exact predicate. Keep its existing authority.
const controls=inputs[1].replace(predicate,'').replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');
const body=authority+'\n'+controls;
const base=JSON.parse(read('.verification-results/production-capture-baseline-v1/schema.json'));
const report=JSON.parse(read('.verification-results/production-capture-baseline-v1/report.json'));
const prior=JSON.parse(read('supabase/release/learn-production/006_slack_intake.manifest.json'));
if(report.state!=='offline_capture_prerequisites_inspected'||!report.containerRemoved||JSON.stringify(report.archive)!==JSON.stringify(prior.baselineArchive))throw Error('Capture baseline unavailable');
const newTables=[...body.matchAll(/^create table (?:if not exists )?(?:public\.)?(\w+)/gm)].map(m=>m[1]);
const newFunctions=[...new Set([...body.matchAll(/^create (?:or replace )?function (?:public\.)?(\w+)\(/gm)].map(m=>m[1]))];
if(base.tables.some(t=>newTables.includes(t.name))||base.functions.some(f=>newFunctions.includes(f.name)))throw Error('Capture names already exist');
const tableNames=['tenants','profiles','view_as_context','platform_authority_grants','feature_flags','platform_jobs','slack_workspace_pacing','phone_recordings','phone_sync_runs'];
const tables=base.tables.filter(t=>tableNames.includes(t.name)).sort((a,b)=>a.name.localeCompare(b.name));
if(tables.length!==tableNames.length)throw Error('Missing shared connector prerequisites');
const helperNames=['platform_jobs_claim','learn_slack_claim_jobs','phone_select_pending','phone_retry_state','learn_capture_allowed','current_tenant_id','current_user_role','current_user_is_openfolk_operator'];
const helpers=base.functions.filter(f=>helperNames.includes(f.name));
const phoneView=base.views.find(v=>v.name==='phone_recording_pipeline_state');
if(!phoneView||helpers.length!==helperNames.length)throw Error('Capture dependency absent or overloaded');
const inventory=read('scripts/verify/learn-release-schema-inventory.sql').trim().replace(/;$/,'');
const sql=`-- DRAFT production capture controls. No provider access or activation.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;actual_view jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production Capture target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_slack_intake_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then raise exception 'Pinned production Slack prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_capture_controls_v1')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array[${newTables.map(literal).join(',')}]))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${newFunctions.map(literal).join(',')}])) then
 raise exception 'Production Capture candidate already exists; inspect before retry';end if;
 select jsonb_agg(t order by t->>'name') into observed from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array[${tableNames.map(literal).join(',')}]);
 if observed is distinct from ${literal(JSON.stringify(tables))}::jsonb then raise exception 'Production Capture table baseline differs';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into actual_helpers from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array[${helperNames.map(literal).join(',')}]);
 if actual_helpers is distinct from ${literal(JSON.stringify(helpers))}::jsonb then raise exception 'Production Capture helper baseline differs';end if;
 select v into actual_view from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'views') v where v->>'name'='phone_recording_pipeline_state';
 if actual_view is distinct from ${literal(JSON.stringify(phoneView))}::jsonb then raise exception 'Production Capture phone view differs';end if;
end $$;
-- Existing operator grants and source tables remain intact. No controls are activated.
${body}
insert into of_learn_deploy.migrations values('learn_capture_controls_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const out='supabase/release/learn-production/007_capture_controls';
writeFileSync(out+'.sql',sql);
writeFileSync(out+'.manifest.json',JSON.stringify({version:'learn-production-capture-controls/1',status:'draft_requires_rehearsal_and_production_approval',projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),priorSha256:prior.sha256,baselineArchive:prior.baselineArchive,sources,existingTables:tableNames,newTables,newFunctions,changedFunctions:['platform_jobs_claim','learn_slack_claim_jobs','phone_select_pending'],newSequences:[],newExistingConstraints:{},newExistingTriggers:{},
 limitations:['No real operator grant, flag change, provider work or hosted deployment.','Worker admission code must be deployed and verified with these SQL controls.','Commusoft and later voicemail/Microsoft operator extensions remain in the full release scope.','Existing in-flight work may settle retained pages; pauses govern new provider admission, not deletion of prior data.']},null,2)+'\n');
console.log(JSON.stringify({sha256:hash(sql),tables:newTables.length,functions:newFunctions.length}));
