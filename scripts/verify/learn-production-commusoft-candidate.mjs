/** Build production Commusoft API without replacing existing operator authority. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(p,'utf8'),hash=s=>createHash('sha256').update(s).digest('hex');
const literal=s=>`'${s.replaceAll("'","''")}'`;
const sources=[
  {
    "path": "supabase/migrations/20261031090000_learn_commusoft_page_permits.sql",
    "sha256": "cbe88a735c42cde97109276f4d7cfe28045d1216a4d6adcb0bcc9d30f4abf40b"
  },
  {
    "path": "supabase/migrations/20261031100000_learn_business_input_pages.sql",
    "sha256": "53edab006759da5563005b074f8901a4b8a4d00da31865d4680bcb237250aed9"
  },
  {
    "path": "supabase/migrations/20261031110000_learn_commusoft_worker.sql",
    "sha256": "f3db9fb8b3568df85316be6a4cc6314dc9d49b239039799e5961bcb1887e0259"
  },
  {
    "path": "supabase/migrations/20261031120000_learn_business_input_customers.sql",
    "sha256": "f5f6854fe430fe8eae9c49948cbdb9dd2feee8f9376b30ab3f3326704ef329a9"
  },
  {
    "path": "supabase/migrations/20261031130000_learn_business_input_review.sql",
    "sha256": "92f239d56e7ec44737003f6c8e1d976e8da25f95aaf3e605960f173aba9399f6"
  },
  {
    "path": "supabase/migrations/20261031140000_learn_business_input_work.sql",
    "sha256": "cda019260dc0e176b8ae35dd1281bf2bc5ed52f481599cd6555aaf822dff46be"
  },
  {
    "path": "supabase/migrations/20261031150000_learn_business_input_work_batches.sql",
    "sha256": "7d0e323f1dc2d3faad527f75ccc6e910f728a0b90be5ed3cbfcadc35eff9c7ec"
  },
  {
    "path": "supabase/migrations/20261031160000_learn_operator_inputs.sql",
    "sha256": "58bf52b1bd1ce8ef220c52cdf927571dc7f06cc3a7c95b5a9978dae2b7be7f9b"
  },
  {
    "path": "supabase/migrations/20261031170000_learn_commusoft_connection_setup.sql",
    "sha256": "a847fcb67e725f113bf1aff87822c5cb764f88fbaffac32aa66b19e15a70847f"
  },
  {
    "path": "supabase/migrations/20261031180000_learn_commusoft_connection_verification.sql",
    "sha256": "1f76f2bd7a4704e8cb9c25eee8890f5ac1199d867803928285a09ea93129e7c0"
  },
  {
    "path": "supabase/migrations/20261031190000_learn_business_input_contacts.sql",
    "sha256": "e7420165ed7a86b10997c15ddc2b0ec37e720d90d66f2da4e335e331e2ae0e4c"
  },
  {
    "path": "supabase/migrations/20261031200000_learn_commusoft_resume.sql",
    "sha256": "78ac03c85d11fc11f513679ffdc8b7eed942bbe28664ab7c854cfdd34168f70a"
  },
  {
    "path": "supabase/migrations/20261101020000_learn_commusoft_contact_traversal.sql",
    "sha256": "aa1a0e0ce952bed84ea0c1f3f623b2d982ae6f8c760084ba76fe0ac59e10d960"
  },
  {
    "path": "supabase/migrations/20261101030000_learn_customer_candidate_endpoints.sql",
    "sha256": "057d45a14c878f31b4b573a1ddb0d1cb8b621c0050900039e6a3e5bbe8270b89"
  },
  {
    "path": "supabase/migrations/20261101040000_learn_commusoft_job_lifecycle.sql",
    "sha256": "4ceaa51b0941bac69a446b4061c7b7ea11e0130fa74f4c9e67023e1c5158e510"
  },
  {
    "path": "supabase/migrations/20261101050000_learn_commusoft_review_search.sql",
    "sha256": "54dfa149c700244ba5a6427d339cc7cad0c1883953ff3764232b4a4ff5517f40"
  },
  {
    "path": "supabase/migrations/20261101070000_learn_commusoft_job_details.sql",
    "sha256": "a8a64f632653a989a737d84211e8d06cd09c60f8a8f38c0cc504b281a185ba30"
  },
  {
    "path": "supabase/migrations/20261101250000_learn_commusoft_partial_job_times.sql",
    "sha256": "95ca7fd3ef48c2d76ed73998019018d6f429978077f48c00aa03a161a44ea60f"
  }
] ;
const select=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);if(i<0||j<=i)throw Error('Commusoft source boundary differs');return s.slice(i,j);};
const guardPath='supabase/release/learn-production/patches/marketing_tenant_guard.sql';
sources.push({path:guardPath,sha256:hash(read(guardPath))});
const body=sources.map(s=>{let b=read(s.path);if(hash(b)!==s.sha256)throw Error('Commusoft source pin differs');
 if(s.path.endsWith('20261031160000_learn_operator_inputs.sql')){
  // Package 007 installed these exact shared helpers. Preserve their definitions.
  b=b.replace(select(b,'create function public.learn_operator_input_immutable()','create trigger learn_operator_input_immutable'),'');
  b=b.replace(select(b,'create function public.learn_operator_input_access(','-- Explicit booleans only.'),'');
 }
 return '-- INPUT '+s.path+'\n'+b.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');
}).join('\n');
const base=JSON.parse(read('.verification-results/production-commusoft-baseline-v1/schema.json'));
const report=JSON.parse(read('.verification-results/production-commusoft-baseline-v1/report.json'));
const prior=JSON.parse(read('supabase/release/learn-production/008_governed_imports.manifest.json'));
if(report.state!=='offline_commusoft_prerequisites_inspected'||!report.containerRemoved||JSON.stringify(report.archive)!==JSON.stringify(prior.baselineArchive))throw Error('Commusoft baseline unavailable');
const newTables=[...body.matchAll(/^create table (?:if not exists )?(?:public\.)?(\w+)/gm)].map(m=>m[1]);
const newFunctions=[...new Set([...body.matchAll(/^create (?:or replace )?function (?:public\.)?(\w+)\(/gm)].map(m=>m[1]))];
if(base.tables.some(t=>newTables.includes(t.name))||base.functions.some(f=>newFunctions.includes(f.name)))throw Error('Commusoft names already exist');
const tableNames=['tenants','profiles','view_as_context','config_versions','connector_accounts','provider_connections','provider_connection_events','tenant_connectors','platform_jobs','feature_flags','people','companies','contact_points','customer_cards','sites','jobs','platform_authority_grants','data_imports','import_entity_links','import_row_results','import_profiles','graph_nodes','graph_edges','graph_events','marketing_tags','marketing_segments','marketing_lifecycle_stages'];
const tables=base.tables.filter(t=>tableNames.includes(t.name)).sort((a,b)=>a.name.localeCompare(b.name));
if(tables.length!==tableNames.length)throw Error('Missing shared connector prerequisites');
const helperNames=['platform_jobs_claim','current_tenant_id','current_user_role','current_user_is_openfolk_operator','provider_secret_name','provider_secret_store','learn_operator_input_immutable','learn_operator_input_access','learn_import_batch_authority','learn_import_customer_card','marketing_tenant_guard'];
const helpers=base.functions.filter(f=>helperNames.includes(f.name));
if(helpers.length!==helperNames.length)throw Error('Commusoft helper dependency absent or overloaded');
const inventory=read('scripts/verify/learn-release-schema-inventory.sql').trim().replace(/;$/,'');
const sql=`-- DRAFT production Commusoft API. No provider access or activation.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production Commusoft target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_governed_imports_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then raise exception 'Pinned production governed-import prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_commusoft_api_v1')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array[${newTables.map(literal).join(',')}]))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${newFunctions.map(literal).join(',')}])) then
 raise exception 'Production Commusoft candidate already exists; inspect before retry';end if;
 select jsonb_agg(t order by t->>'name') into observed from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array[${tableNames.map(literal).join(',')}]);
 if observed is distinct from ${literal(JSON.stringify(tables))}::jsonb then raise exception 'Production Commusoft table baseline differs';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into actual_helpers from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array[${helperNames.map(literal).join(',')}]);
 if actual_helpers is distinct from ${literal(JSON.stringify(helpers))}::jsonb then raise exception 'Production Commusoft helper baseline differs';end if;
 if not exists(select 1 from pg_extension where extname='supabase_vault' and extversion='0.3.1') or not has_schema_privilege('postgres','vault','USAGE') or not has_table_privilege('postgres','vault.decrypted_secrets','SELECT') then raise exception 'Existing Vault prerequisite unavailable';end if;
end $$;
-- Existing operator grants and source tables remain intact. No controls are activated.
${body}
insert into of_learn_deploy.migrations values('learn_commusoft_api_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const out='supabase/release/learn-production/009_commusoft_api';
writeFileSync(out+'.sql',sql);
writeFileSync(out+'.manifest.json',JSON.stringify({version:'learn-production-commusoft-api/1',status:'draft_requires_rehearsal_and_production_approval',projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),priorSha256:prior.sha256,baselineArchive:prior.baselineArchive,sources,existingTables:tableNames,newTables,newFunctions,changedFunctions:['platform_jobs_claim','marketing_tenant_guard'],newSequences:[],newExistingConstraints:{},newExistingTriggers:{},
 limitations:['No hosted configuration, real grant, credential read, provider request or import activation.','Synthetic full-schema acceptance does not prove current real coverage or runtime deployment.','Complete real Commusoft customer/contact/job reconciliation and signed-in acceptance remain required.']},null,2)+'\n');
console.log(JSON.stringify({sha256:hash(sql),tables:newTables.length,functions:newFunctions.length}));
