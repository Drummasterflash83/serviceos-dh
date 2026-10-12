/** Build Slack on the existing production connector backbone; never deploy. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(p,'utf8'),hash=s=>createHash('sha256').update(s).digest('hex');
const literal=s=>`'${s.replaceAll("'","''")}'`;
const sources=[
 {
  "path": "supabase/release/learn-test/009_slack_storage_setup.sql",
  "sha256": "d4b762ace7c9ccecba29890649e40d7e1501aa5f6e1c2b711970fb55368d305e"
 },
 {
  "path": "supabase/release/learn-test/010_slack_durable_worker.sql",
  "sha256": "74bfa2f96e5ad2b40fb40b1e6b03f1cdd6f605f3d8d57a598a541222f8a1955e"
 },
 {
  "path": "supabase/release/learn-test/011_slack_threads.sql",
  "sha256": "c476f687762c1bb648c7ecdd7bd9bdb054b1d7f5ccc9cb43af17468991edf5ce"
 },
 {
  "path": "supabase/release/learn-test/012_slack_operator.sql",
  "sha256": "e37839d9be63ff9ee9db8b0ada2c25c676546cb108a3882c57d1ec58aa8300b1"
 },
 {
  "path": "supabase/release/learn-test/013_slack_pacing.sql",
  "sha256": "7191b47ec926094b2118d957cddccf6ebec6c62e10e2d04670db327d23c223a5"
 },
 {
  "path": "supabase/release/learn-test/014_slack_recovery.sql",
  "sha256": "0e33e36138c1e8988d13b90b32295ace2d2f3480d6fec83b2deaae919f421efc"
 },
 {
  "path": "supabase/release/learn-test/021_slack_thread_recovery.sql",
  "sha256": "16d639506c5a7626b6cc3563798b44303e8cf922c9d776e6752c1c80fcd03344"
 },
 {
  "path": "supabase/migrations/20261031230000_learn_capture_controls.sql",
  "sha256": "51265e71ef999ecbf27673220ea04ef6cc1711fd81cc1848bb74513a10c73067"
 },
 {
  "path": "supabase/migrations/20261101003000_learn_slack_recurring.sql",
  "sha256": "a97f894a53f39acadff7ee5fe3a576da82dbedc81704df4e7faa79a13e91a48f"
 },
 {
  "path": "supabase/migrations/20261101005000_learn_slack_recurring_threads.sql",
  "sha256": "251f9c8cc1fd2ff32a80d9780b0605880cfee5259f9dbfa02e47452709f9fce6"
 }
];
const select=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);if(i<0||j<=i)throw Error('Slack source boundary differs');return s.slice(i,j);};
const bodies=sources.map((s,i)=>{let b=read(s.path);if(hash(b)!==s.sha256)throw Error('Slack source pin differs');
 if(i===0){b=select(b,'-- SOURCE 20261029130000_learn_slack_history.sql','insert into of_test_deploy.migrations');
 const old="array['tenant_connectors','connector_accounts','provider_connections','provider_connection_events','slack_messages','slack_message_versions','slack_history_imports']";
 if(b.split(old).length!==2)throw Error('Shared connector grant selection differs');
 b=b.replace(old,"array['slack_messages','slack_message_versions','slack_history_imports']");
 }else if(i<6)b=select(b,'-- SOURCE supabase/migrations/','insert into of_test_deploy.migrations');
 else if(i===6)b=select(b,'create index learn_slack_thread_approval_order','insert into of_test_deploy.migrations');
 else if(i===7)b=select(b,'create function public.learn_capture_allowed(','-- Operator data')+
  'revoke all on function public.learn_capture_allowed(uuid,text) from public,anon,authenticated,service_role;\ngrant execute on function public.learn_capture_allowed(uuid,text) to service_role;\n';
 else b=b.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');
 return '-- INPUT '+s.path+'\n'+b;});
const body=bodies.join('\n');
const base=JSON.parse(read('.verification-results/production-slack-baseline-v1/schema.json'));
const report=JSON.parse(read('.verification-results/production-slack-baseline-v1/report.json'));
const prior=JSON.parse(read('supabase/release/learn-production/005_scoring_working_time.manifest.json'));
if(report.state!=='offline_slack_prerequisites_inspected'||!report.containerRemoved||JSON.stringify(report.archive)!==JSON.stringify(prior.baselineArchive))throw Error('Slack baseline unavailable');
const newTables=[...body.matchAll(/^create table (?:if not exists )?(?:public\.)?(\w+)/gm)].map(m=>m[1]);
const newFunctions=[...new Set([...body.matchAll(/^create (?:or replace )?function (?:public\.)?(\w+)\(/gm)].map(m=>m[1]).concat(['learn_slack_commit_page_private','learn_slack_store_records']))];
if(base.tables.some(t=>newTables.includes(t.name))||base.functions.some(f=>newFunctions.includes(f.name)))throw Error('Slack names already exist');
const tableNames=['tenants','profiles','team_members','view_as_context','platform_authority_grants','feature_flags','tenant_connectors','connector_accounts','provider_connections','provider_connection_events','platform_jobs','interactions'];
const tables=base.tables.filter(t=>tableNames.includes(t.name)).sort((a,b)=>a.name.localeCompare(b.name));
if(tables.length!==tableNames.length)throw Error('Missing shared connector prerequisites');
const helperNames=['platform_jobs_claim','current_tenant_id','current_user_role','current_user_is_openfolk_operator','learn_foundation_reference_guard','set_updated_at'];
const helpers=base.functions.filter(f=>helperNames.includes(f.name));
const inventory=read('scripts/verify/learn-release-schema-inventory.sql').trim().replace(/;$/,'');
const sql=`-- DRAFT production Slack intake/recovery. No provider access or activation.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production Slack target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_scoring_working_time_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then raise exception 'Pinned production scoring prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_slack_intake_v1')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array[${newTables.map(literal).join(',')}]))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${newFunctions.map(literal).join(',')}])) then
 raise exception 'Production Slack candidate already exists; inspect before retry';end if;
 select jsonb_agg(t order by t->>'name') into observed from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array[${tableNames.map(literal).join(',')}]);
 if observed is distinct from ${literal(JSON.stringify(tables))}::jsonb then raise exception 'Production Slack table baseline differs';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into actual_helpers from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array[${helperNames.map(literal).join(',')}]);
 if actual_helpers is distinct from ${literal(JSON.stringify(helpers))}::jsonb then raise exception 'Production Slack helper baseline differs';end if;
 if not exists(select 1 from pg_extension where extname='supabase_vault' and extversion='0.3.1') or not has_schema_privilege('postgres','vault','USAGE') or not has_table_privilege('postgres','vault.decrypted_secrets','SELECT') then raise exception 'Existing Vault prerequisite unavailable';end if;
 if exists(select 1 from connector_accounts a left join tenant_connectors c on c.id=a.tenant_connector_id where c.id is null or a.tenant_id<>c.tenant_id) then raise exception 'Existing connector references require review';end if;
end $$;
-- Existing connector tables, policies and grants remain intact. Tenant FKs,
-- same-company references and retained metadata/audit guards are additive.
${body}
insert into of_learn_deploy.migrations values('learn_slack_intake_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const out='supabase/release/learn-production/006_slack_intake';
writeFileSync(out+'.sql',sql);
writeFileSync(out+'.manifest.json',JSON.stringify({version:'learn-production-slack-intake/1',status:'draft_requires_rehearsal_and_production_approval',projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),priorSha256:prior.sha256,baselineArchive:prior.baselineArchive,sources,existingTables:tableNames,newTables,newFunctions,changedFunctions:['platform_jobs_claim'],newSequences:[],
 newExistingConstraints:{tenant_connectors:['learn_connector_tenant_fk'],connector_accounts:['learn_connector_tenant_fk'],provider_connections:['learn_connector_tenant_fk'],provider_connection_events:['learn_provider_event_tenant_fk']},
 newExistingTriggers:{tenant_connectors:['learn_connector_reference_guard','learn_connector_retain','learn_connector_retain_truncate'],connector_accounts:['learn_connector_reference_guard','learn_connector_retain','learn_connector_retain_truncate'],provider_connections:['learn_connector_reference_guard','learn_connector_retain','learn_connector_retain_truncate'],provider_connection_events:['learn_provider_events_retain','learn_provider_events_retain_truncate']},
 limitations:['No real Slack authorization, provider requests, credentials or schedule activation.','Capture predicate is included for recurring admission; remaining OpenFolk controls and worker capture gates still require reconciliation.','Shared connector deletions/truncation and audit updates are retained, not erased; unrelated row updates retain existing authority.','Remaining source-to-card and full signed-in/provider acceptance are required.']},null,2)+'\n');
console.log(JSON.stringify({sha256:hash(sql),tables:newTables.length,functions:newFunctions.length}));
