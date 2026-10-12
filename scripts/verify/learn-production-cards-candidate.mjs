/** Production-specific communication cards, identity review and queued processing. No activation. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(p,'utf8'),hash=s=>createHash('sha256').update(s).digest('hex');
const q=s=>`'${s.replaceAll("'","''")}'`;
const sources=[{"path": "supabase/release/learn-test/016_card_communications.sql", "sha256": "78b6871e377b3e35280769edff0f28c3ec0872208578daed958cec0b97776ebc"}, {"path": "supabase/release/learn-test/017_card_communication_context.sql", "sha256": "87f54342bffc35c32b81434dd54fb2b662fbfcd7aefd516b511fd21c6cad6403"}, {"path": "supabase/release/learn-test/019_card_sources.sql", "sha256": "cca8c835fdf7b3e088796ecd34dae4e09b6ed615f93386ff2f03cfdea9d86e86"}, {"path": "supabase/migrations/20261101150000_learn_card_search.sql", "sha256": "011790af324c8db7bf03493bbbe5ee8765f74196211747883f7707f67f65f3be"}, {"path": "supabase/migrations/20261101300000_learn_identity_delivery.sql", "sha256": "da3e034eef9f7b84e19673b2baee1830f4efdd0f90b8e93e635c44622b2db587"}, {"path": "supabase/migrations/20261101310000_learn_interaction_projection.sql", "sha256": "1b1cfa38b70cc5b611b96496adfdb50aa920ef614ff2ae62615eaee6cb5f7f4f"}, {"path": "supabase/migrations/20261101320000_learn_projection_operator_review.sql", "sha256": "57b66390fbd57d77f43dfd6390799365c5b0501557182352dba8d4a28a969a49"}, {"path": "supabase/migrations/20261101330000_learn_identity_operator_review.sql", "sha256": "5944b4e61b2a6e82b1cf8f49e470a1a23afe11ba60d13d2b3dafcbcd06177e1b"}, {"path": "supabase/migrations/20261101340000_learn_processing_queue.sql", "sha256": "8ed9e12e939220718f9d479b904ade80c6f426b4f7bce46b934dabda581298cb"}, {"path": "supabase/migrations/20261101380000_learn_email_draft_eligibility.sql", "sha256": "44008ef0375ba74ebb72c6803e8354bfd96d9f3932799ed3240a0c4a3267b136"}, {"path": "supabase/migrations/20261101390000_learn_card_projection_eligibility.sql", "sha256": "b14c9e3ec74f36d0b140d39a70fcff8d436cbd00348922f644a4efda6c9dca02"}];
for(const source of sources)if(hash(read(source.path))!==source.sha256)throw Error('Cards source pin differs');
const baseline=JSON.parse(read('.verification-results/production-cards-baseline-v1/schema.json'));
const report=JSON.parse(read('.verification-results/production-cards-baseline-v1/report.json'));
const prior=JSON.parse(read('supabase/release/learn-production/011_phone_capture.manifest.json'));
if(report.state!=='offline_cards_prerequisites_inspected'||!report.containerRemoved||JSON.stringify(report.archive)!==JSON.stringify(prior.baselineArchive))throw Error('Cards baseline unavailable');
const role='learn_card_communication_reader';
const slice=(source,start,end)=>{const text=read(source.path),a=text.indexOf(start),b=text.indexOf(end,a);if(a<0||b<=a)throw Error('Reviewed card selection differs');return text.slice(a,b);};
let reader=slice(sources[0],'create role learn_card_communication_reader','insert into of_test_deploy.migrations');
reader=reader.replace("do $$ begin execute format('grant learn_card_communication_reader to %I with inherit false, set true',current_user);end $$;",'grant learn_card_communication_reader to postgres with inherit true, set true;');
reader=reader.replace('revoke create on schema public from learn_card_communication_reader;','').replace("do $$ begin execute format('revoke learn_card_communication_reader from %I',current_user);end $$;",'');
reader+='\n'+slice(sources[1],'create or replace function public.learn_card_communications_read',"do $$ begin execute format('revoke");
reader+='\n'+slice(sources[2],'grant select(id,tenant_id,subject', 'revoke create on schema public');
const policies=[...reader.matchAll(/create policy (\w+) on public\.(\w+) for select to learn_card_communication_reader\n?\s*using\(([\s\S]*?)\);/g)];
if(policies.length!==5)throw Error('Reader policy selections differ');
// PUBLIC policies already present in production must not broaden this new role.
const restrictive=policies.map(p=>`create policy learn_cards_production_boundary on public.${p[2]} as restrictive for select to ${role} using(${p[3]});`).join('\n');
const statements=[reader,restrictive];
for(const source of sources.slice(3)){
 let sql=read(source.path).replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,'');
 if(source.path.endsWith('20261101380000_learn_email_draft_eligibility.sql')){
  const boundary=sql.indexOf('create or replace function public.learn_email_store_page(');
  if(boundary<0)throw Error('Draft-store selection differs');
  // Package010 already contains the later v4 store. Keep projection/identity/card
  // eligibility only; never downgrade durable mailbox storage to this older body.
  sql=sql.slice(0,boundary);
 }
 statements.push('-- INPUT '+source.path+'\n'+sql);
}
statements.push('revoke create on schema public from '+role+';','revoke '+role+' from postgres;');
const body=statements.join('\n');
const newTables=[...body.matchAll(/^create table (?:if not exists )?(?:public\.)?(\w+)/gmi)].map(m=>m[1]);
const declared=[...new Set([...body.matchAll(/^create (?:or replace )?function (?:public\.)?(\w+)\(/gmi)].map(m=>m[1]))];
const existingNames=new Set(baseline.functions.map(f=>f.name));
const newFunctions=declared.filter(n=>!existingNames.has(n));
const changedFunctions=[];
const changedViews=[];
if(baseline.tables.some(t=>newTables.includes(t.name)))throw Error('Cards tables already present');
const referenced=n=>new RegExp('\\b'+n+'\\b').test(body);
const existingTables=baseline.tables.filter(t=>referenced(t.name)).map(t=>t.name);
const tableCatalog=baseline.tables.filter(t=>existingTables.includes(t.name)).sort((a,b)=>a.name.localeCompare(b.name));
const helpers=baseline.functions.filter(f=>referenced(f.name));
const helperNames=[...new Set(helpers.map(f=>f.name))];
const views=baseline.views;
const viewNames=views.map(v=>v.name);
const inventory=read('scripts/verify/learn-release-schema-inventory.sql').trim().replace(/;$/,'');
const sql=`-- DRAFT: requires matched cards workers and explicit production approval.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;actual_views jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production Cards target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_phone_capture_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then raise exception 'Pinned production Phone prerequisite missing';end if;
 if exists(select 1 from pg_roles where rolname='${role}') or exists(select 1 from of_learn_deploy.migrations where migration_name='learn_cards_delivery_v1')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array[${newTables.map(q).join(',')}]))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${newFunctions.map(q).join(',')}])) then raise exception 'Production Cards candidate already exists; inspect before retry';end if;
 select jsonb_agg(t order by t->>'name') into observed from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array[${existingTables.map(q).join(',')}]);
 if observed is distinct from ${q(JSON.stringify(tableCatalog))}::jsonb then raise exception 'Production Cards table baseline differs';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into actual_helpers from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array[${helperNames.map(q).join(',')}]);
 if actual_helpers is distinct from ${q(JSON.stringify(helpers))}::jsonb then raise exception 'Production Cards helper baseline differs';end if;
 select jsonb_agg(v order by v->>'name') into actual_views from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'views') v where v->>'name'=any(array[${viewNames.map(q).join(',')}]);
 if actual_views is distinct from ${q(JSON.stringify(views))}::jsonb then raise exception 'Production Cards view baseline differs';end if;
end$$;
${body}
insert into of_learn_deploy.migrations values('learn_cards_delivery_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const out='supabase/release/learn-production/012_communication_cards';
writeFileSync(out+'.sql',sql);
writeFileSync(out+'.manifest.json',JSON.stringify({version:'learn-production-communication-cards/1',status:'draft_requires_rehearsal_and_production_approval',projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),priorSha256:prior.sha256,baselineArchive:prior.baselineArchive,sources,existingTables,newTables,newFunctions,changedFunctions,changedViews,newSequences:[],
 newRole:role,extendedTables:{},newExistingConstraints:{},newExistingIndexes:{},newExistingTriggers:{},
 newExistingPolicies:Object.fromEntries(policies.map(p=>[p[2],[p[1],'learn_cards_production_boundary']])),
 limitations:['No source rewrite, historical attribution backfill, worker activation or new credential.',
 'Existing production source grants/policies remain; restrictive reader-only boundaries prevent PUBLIC policies widening this new reader.',
 'Draft eligibility pieces exclude the obsolete email store; package010 v4 storage remains intact.',
 'Paired runtime, retained draft-impact reconciliation, real source-to-card coverage and signed-in acceptance remain required.']},null,2)+'\n');
console.log(JSON.stringify({sha256:hash(sql),tables:newTables.length,functions:newFunctions.length}));
