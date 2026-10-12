/** Production-specific private voicemail intake, queue, discovery and historical inbox. No activation. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(p,'utf8'),hash=s=>createHash('sha256').update(s).digest('hex');
const q=s=>`'${s.replaceAll("'","''")}'`;
const sources=[{"path": "supabase/migrations/20261101420000_learn_voicemail_private_intake.sql", "sha256": "157e2c6b0ec864a6d4e331ab2d7a7aa25388d1e04c2c1e0df14ff27c3d9e7cae"}, {"path": "supabase/migrations/20261101430000_learn_voicemail_queue.sql", "sha256": "770292cbdcdb063871d3d532393b0cbac16c0ecf6b01047dc250af659f9ab965"}, {"path": "supabase/migrations/20261101440000_learn_voicemail_discovery.sql", "sha256": "422e0b85672320314d6ee6540a7022786ff5f593e9673126f53b097890676e8b"}, {"path": "supabase/migrations/20261101450000_learn_voicemail_dispatch.sql", "sha256": "337d14741d4e244531aa8778103ac211bfa8910404d3dc002bd321160980d672"}, {"path": "supabase/migrations/20261101460000_learn_voicemail_inbox_history.sql", "sha256": "7ea9237b8adc4fdcd70f8616254e8ccd5f50fb048cce1316621a28b6ce364457"}];
for(const source of sources)if(hash(read(source.path))!==source.sha256)throw Error('Voicemail source pin differs');
const baseline=JSON.parse(read('.verification-results/production-voicemail-baseline-v3/schema.json'));
const report=JSON.parse(read('.verification-results/production-voicemail-baseline-v3/report.json'));
const prior=JSON.parse(read('supabase/release/learn-production/012_communication_cards.manifest.json'));
if(report.state!=='offline_voicemail_prerequisites_inspected'||!report.containerRemoved||JSON.stringify(report.archive)!==JSON.stringify(prior.baselineArchive))throw Error('Voicemail baseline unavailable');
const statements=sources.map(source=>'-- INPUT '+source.path+'\n'+read(source.path).replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,''));
const body=statements.join('\n');
const storageInventory=read('scripts/verify/learn-release-schema-inventory.sql').trim().replace(/;$/,'').replaceAll("='public'","='storage'");
const storage=JSON.parse(read('.verification-results/production-voicemail-baseline-v3/storage-schema.json'));
const buckets=JSON.parse(read('.verification-results/production-voicemail-baseline-v3/voicemail-buckets.json'));
if(buckets.length!==1||buckets[0].id!=='receptionist-voicemails'||buckets[0].public!==false)throw Error('Existing private voicemail bucket baseline differs');
const newTables=[...body.matchAll(/^create table (?:if not exists )?(?:public\.)?(\w+)/gmi)].map(m=>m[1]);
const declared=[...new Set([...body.matchAll(/^create (?:or replace )?function (?:public\.)?(\w+)\(/gmi)].map(m=>m[1]))];
const existingNames=new Set(baseline.functions.map(f=>f.name));
const newFunctions=declared.filter(n=>!existingNames.has(n));
const changedFunctions=[];
const changedViews=[];
if(baseline.tables.some(t=>newTables.includes(t.name)))throw Error('Voicemail tables already present');
const referenced=n=>new RegExp('\\b'+n+'\\b').test(body);
const existingTables=baseline.tables.filter(t=>referenced(t.name)||['profiles','receptionist_mailbox_managers','receptionist_voicemail_access_log'].includes(t.name)).map(t=>t.name);
const tableCatalog=baseline.tables.filter(t=>existingTables.includes(t.name)).sort((a,b)=>a.name.localeCompare(b.name));
const helpers=baseline.functions.filter(f=>referenced(f.name)||['can_manage_voicemail','current_tenant_id','voicemail_mailbox_summary'].includes(f.name));
const helperNames=[...new Set(helpers.map(f=>f.name))];
const views=baseline.views;
const viewNames=views.map(v=>v.name);
const inventory=read('scripts/verify/learn-release-schema-inventory.sql').trim().replace(/;$/,'');
const sql=`-- DRAFT: requires matched voicemail workers and explicit production approval.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;actual_views jsonb;actual_storage jsonb;actual_buckets jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production Voicemail target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_cards_delivery_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then raise exception 'Pinned production Cards prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_voicemail_capture_v1')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array[${newTables.map(q).join(',')}]))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${newFunctions.map(q).join(',')}])) then raise exception 'Production Voicemail candidate already exists; inspect before retry';end if;
 select jsonb_agg(t order by t->>'name') into observed from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array[${existingTables.map(q).join(',')}]);
 if observed is distinct from ${q(JSON.stringify(tableCatalog))}::jsonb then raise exception 'Production Voicemail table baseline differs';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into actual_helpers from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array[${helperNames.map(q).join(',')}]);
 if actual_helpers is distinct from ${q(JSON.stringify(helpers))}::jsonb then raise exception 'Production Voicemail helper baseline differs';end if;
 select jsonb_agg(v order by v->>'name') into actual_views from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'views') v where v->>'name'=any(array[${viewNames.map(q).join(',')}]);
 if actual_views is distinct from ${q(JSON.stringify(views))}::jsonb then raise exception 'Production Voicemail view baseline differs';end if;
 select inventory into actual_storage from (${storageInventory}) q;
 if actual_storage is distinct from ${q(JSON.stringify(storage))}::jsonb then raise exception 'Production Voicemail storage baseline differs';end if;
 select coalesce(jsonb_agg(to_jsonb(b) order by id),'[]') into actual_buckets from storage.buckets b where id in ('receptionist-voicemails','learn-voicemail-sources');
 if actual_buckets is distinct from ${q(JSON.stringify(buckets))}::jsonb then raise exception 'Production Voicemail bucket baseline differs';end if;
end$$;
${body}
insert into of_learn_deploy.migrations values('learn_voicemail_capture_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const out='supabase/release/learn-production/013_voicemail_capture';
writeFileSync(out+'.sql',sql);
writeFileSync(out+'.manifest.json',JSON.stringify({version:'learn-production-voicemail-capture/1',status:'draft_requires_rehearsal_and_production_approval',projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),priorSha256:prior.sha256,baselineArchive:prior.baselineArchive,sources,existingTables,newTables,newFunctions,changedFunctions,changedViews,newSequences:[],
 newRole:null,extendedTables:{},newExistingConstraints:{},newExistingIndexes:{email_messages:['email_messages_voicemail_scan_idx']},newExistingTriggers:{},newExistingPolicies:{},
 newStoragePolicies:{objects:['voicemail_source_no_direct_storage_access']},
 newBuckets:[{id:'learn-voicemail-sources',name:'learn-voicemail-sources',public:false,file_size_limit:1048576,allowed_mime_types:['message/rfc822']}],
 limitations:['Managed-host storage policy authority must be verified before production execution; the offline rehearsal explicitly supplies the documented supautils hook.',
 'Preserves existing voicemail foundation, owner snapshots, manager grants and private audio bucket.',
 'Adds private raw-email storage; does not seed routes, user access, credentials, scheduled jobs or provider requests.',
 'Requires matched workers, verified recipient/ownership routes, real provider capture, audio readback/playback, independent audio/EML backup and signed-in acceptance.',
 'Discovery of retained emails is not complete provider coverage.']},null,2)+'\n');
console.log(JSON.stringify({sha256:hash(sql),tables:newTables.length,functions:newFunctions.length}));
