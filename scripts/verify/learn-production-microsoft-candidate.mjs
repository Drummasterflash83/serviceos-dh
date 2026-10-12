/** Production-specific Microsoft capture, credentials, projection and operator status. No activation. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(p,'utf8'),hash=s=>createHash('sha256').update(s).digest('hex');
const q=s=>`'${s.replaceAll("'","''")}'`;
const sources=[{"path": "supabase/migrations/20261101180000_learn_microsoft_source_journal.sql", "sha256": "8f852bf18aad93e64d3fd8192910159f2fdfea102d2807bbfdc429f5e6ab8398"}, {"path": "supabase/migrations/20261101181000_learn_microsoft_job_receipts.sql", "sha256": "f91c07370d28689fcbdfdee8ead990a5dcc7ed12db710f6d709cb93f38fe9bb0"}, {"path": "supabase/migrations/20261101182000_learn_microsoft_queue_completion.sql", "sha256": "2781dca88f9ad4322c8acb042e4c42559cd66cc39db96e4708c9177ac21b2cbe"}, {"path": "supabase/migrations/20261101192000_learn_microsoft_folder_dispatch.sql", "sha256": "3e7fa7064b54ddc2921b318e2da384dcd7ffb6a3fab86fa0ce4e9f9522150f84"}, {"path": "supabase/migrations/20261101260000_learn_microsoft_incremental_queue.sql", "sha256": "b3a30f6e3084849ef613480fa488a8c0da07efe7bcdc3161bb07764cd9a61e7c"}, {"path": "supabase/migrations/20261101280000_learn_microsoft_message_projection.sql", "sha256": "121fcd1cd4569b4fe6b72ba818892802e46cc592de936039c64a70214c891e62"}, {"path": "supabase/migrations/20261101350000_learn_microsoft_recurring_discovery.sql", "sha256": "ffad2f09f0f6c960b80222c95bf86aeb99447be03051b3b860a797aa8408d643"}, {"path": "supabase/migrations/20261101470000_learn_microsoft_credentials.sql", "sha256": "e68b461739f347de2d1aad7e196b618102b237bef4a878c38a9e144598fcccab"}, {"path": "supabase/migrations/20261101480000_learn_microsoft_worker_failures.sql", "sha256": "e4d961ae83228a253de9fa668d788b12b3529c3eb33fa13a5d0dd784cf11e4ab"}, {"path": "supabase/migrations/20261101490000_learn_microsoft_operator_status.sql", "sha256": "2a38f722651dfd569718963f82d539fbd01b8ba9cd5a111db55b880124c6d9ec"}];
sources.push({path:'supabase/release/learn-production/patches/marketing_source_capability_schema.sql',sha256:'a38ff38c9c0eb598e355b92fe945b2799edd73d2a83881168d9e9e9a4119e0e5'});
for(const source of sources)if(hash(read(source.path))!==source.sha256)throw Error('Microsoft source pin differs');
const baseline=JSON.parse(read('.verification-results/production-microsoft-baseline-v1/schema.json'));
const report=JSON.parse(read('.verification-results/production-microsoft-baseline-v1/report.json'));
const prior=JSON.parse(read('supabase/release/learn-production/013_voicemail_capture.manifest.json'));
if(report.state!=='offline_microsoft_prerequisites_inspected'||!report.containerRemoved||JSON.stringify(report.archive)!==JSON.stringify(prior.baselineArchive))throw Error('Microsoft baseline unavailable');
const statements=sources.map(source=>'-- INPUT '+source.path+'\n'+read(source.path).replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,''));
const body=statements.join('\n');
const storageInventory=read('scripts/verify/learn-release-schema-inventory.sql').trim().replace(/;$/,'').replaceAll("='public'","='storage'");
const storage=JSON.parse(read('.verification-results/production-microsoft-baseline-v1/storage-schema.json'));
const buckets=JSON.parse(read('.verification-results/production-microsoft-baseline-v1/voicemail-buckets.json')).map(b=>{
 // Package013 creates this bucket at install time. Its configuration is pinned;
 // the new timestamps are deliberately not treated as archived source values.
 if(b.id==='learn-voicemail-sources'){const {created_at,updated_at,...config}=b;return config;}return b;
});
if(buckets.length!==2||buckets.some(b=>b.public!==false))throw Error('Existing private voicemail bucket baseline differs');
const newTables=[...body.matchAll(/^create table (?:if not exists )?(?:public\.)?(\w+)/gmi)].map(m=>m[1]);
const declared=[...new Set([...body.matchAll(/^create (?:or replace )?function (?:public\.)?(\w+)\(/gmi)].map(m=>m[1]))];
const existingNames=new Set(baseline.functions.map(f=>f.name));
const newFunctions=declared.filter(n=>!existingNames.has(n));
const changedFunctions=['platform_jobs_claim','marketing_source_capability_sync','marketing_sender_capability_sync','marketing_sender_readiness'];
const changedViews=[];
if(baseline.tables.some(t=>newTables.includes(t.name)))throw Error('Microsoft tables already present');
const referenced=n=>new RegExp('\\b'+n+'\\b').test(body);
const existingTables=baseline.tables.filter(t=>referenced(t.name)||['profiles','email_oauth_tokens'].includes(t.name)).map(t=>t.name);
const tableCatalog=baseline.tables.filter(t=>existingTables.includes(t.name)).sort((a,b)=>a.name.localeCompare(b.name));
const helpers=baseline.functions.filter(f=>referenced(f.name)||['current_tenant_id','current_user_role','learn_capture_job_allowed'].includes(f.name));
const helperNames=[...new Set(helpers.map(f=>f.name))];
const views=baseline.views;
const viewNames=views.map(v=>v.name);
const inventory=read('scripts/verify/learn-release-schema-inventory.sql').trim().replace(/;$/,'');
const sql=`-- DRAFT: requires matched Microsoft workers and explicit production approval.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;actual_views jsonb;actual_storage jsonb;actual_buckets jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production Microsoft target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_voicemail_capture_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then raise exception 'Pinned production Voicemail prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_microsoft_capture_v1')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array[${newTables.map(q).join(',')}]))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${newFunctions.map(q).join(',')}])) then raise exception 'Production Microsoft candidate already exists; inspect before retry';end if;
 select jsonb_agg(t order by t->>'name') into observed from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array[${existingTables.map(q).join(',')}]);
 if observed is distinct from ${q(JSON.stringify(tableCatalog))}::jsonb then raise exception 'Production Microsoft table baseline differs';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into actual_helpers from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array[${helperNames.map(q).join(',')}]);
 if actual_helpers is distinct from ${q(JSON.stringify(helpers))}::jsonb then raise exception 'Production Microsoft helper baseline differs';end if;
 select jsonb_agg(v order by v->>'name') into actual_views from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'views') v where v->>'name'=any(array[${viewNames.map(q).join(',')}]);
 if actual_views is distinct from ${q(JSON.stringify(views))}::jsonb then raise exception 'Production Microsoft view baseline differs';end if;
 select inventory into actual_storage from (${storageInventory}) q;
 if actual_storage is distinct from ${q(JSON.stringify(storage))}::jsonb then raise exception 'Production Microsoft storage baseline differs';end if;
 select coalesce(jsonb_agg(case when b.id='learn-voicemail-sources' then to_jsonb(b)-array['created_at','updated_at'] else to_jsonb(b) end order by id),'[]') into actual_buckets from storage.buckets b where id in ('receptionist-voicemails','learn-voicemail-sources');
 if actual_buckets is distinct from ${q(JSON.stringify(buckets))}::jsonb then raise exception 'Production Microsoft bucket baseline differs';end if;
end$$;
${body}
insert into of_learn_deploy.migrations values('learn_microsoft_capture_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const out='supabase/release/learn-production/014_microsoft_capture';
writeFileSync(out+'.sql',sql);
writeFileSync(out+'.manifest.json',JSON.stringify({version:'learn-production-microsoft-capture/1',status:'draft_requires_rehearsal_and_production_approval',projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),priorSha256:prior.sha256,baselineArchive:prior.baselineArchive,sources,existingTables,newTables,newFunctions,changedFunctions,changedViews,newSequences:[],
 newRole:null,extendedTables:{},newExistingConstraints:{},newExistingIndexes:{},newExistingTriggers:{},newExistingPolicies:{},newStoragePolicies:{},newBuckets:[],
 limitations:['Preserves existing email, OAuth, marketing and queue structures and source rows; adds Microsoft claim admission and qualifies the existing Marketing token-trigger dependency chain without changing authority or readiness rules.',
 'No accounts, credential bindings, consent, tokens, jobs or schedules are seeded.',
 'Requires matching Microsoft worker, real delegated consent/identity binding, provider capture and coverage, source-to-card and signed-in acceptance.',
 'Retained Graph pages, folder removals and sparse messages are not proof of mailbox coverage; attachments are not captured by this adapter.']},null,2)+'\n');
console.log(JSON.stringify({sha256:hash(sql),tables:newTables.length,functions:newFunctions.length}));
