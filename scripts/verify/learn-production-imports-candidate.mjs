/** Build governed imports around existing production contacts and customer cards. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(p,'utf8'),hash=s=>createHash('sha256').update(s).digest('hex');
const literal=s=>`'${s.replaceAll("'","''")}'`;
const sources=[
  {
    "path": "supabase/release/learn-test/022_governed_imports.sql",
    "sha256": "0294ba3ef802b53ad158ee98570a79dc713840496bb45d53a4263d3f26ecea9d"
  },
  {
    "path": "supabase/release/learn-test/023_import_authority.sql",
    "sha256": "8e30b2e65b43de7b39b873b3ee515dd9a44da98a5964d5ae704a66ec8ef2de86"
  },
  {
    "path": "supabase/release/learn-test/024_import_customer_cards.sql",
    "sha256": "8c89ff5faca8443ad45b8d16a3aa32eeb69b4dbbe2184d668cec48df9fe0f4b5"
  },
  {
    "path": "supabase/release/learn-test/025_import_batches.sql",
    "sha256": "fc904ebd3a7fb4ec45e6c78994ed954289c317ab15aefbbae40f3dd687cad9cd"
  }
] ;
const select=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);if(i<0||j<=i)throw Error('Import source boundary differs');return s.slice(i,j);};
const inputs=sources.map(s=>{const b=read(s.path);if(hash(b)!==s.sha256)throw Error('Import source pin differs');return b;});
const starts=['-- SOURCE 20260912120000_commusoft_governed_import.sql','create or replace function import_row_preamble(','-- Person cards may carry their company','create function learn_import_batch_authority('];
// Production already owns contact_points, its normalizer and anchor indexes.
// Keep their definitions and grants; add only the same-company parent constraint.
const body='alter table public.contact_points add constraint contact_points_person_tenant_fk foreign key(tenant_id,person_id) references public.people(tenant_id,id) on delete cascade;\n'+
 inputs.map((b,i)=>'-- INPUT '+sources[i].path+'\n'+select(b,starts[i],'insert into of_test_deploy.migrations')).join('\n');
const base=JSON.parse(read('.verification-results/production-imports-baseline-v2/schema.json'));
const report=JSON.parse(read('.verification-results/production-imports-baseline-v2/report.json'));
const prior=JSON.parse(read('supabase/release/learn-production/007_capture_controls.manifest.json'));
if(report.state!=='offline_import_prerequisites_inspected'||!report.containerRemoved||JSON.stringify(report.archive)!==JSON.stringify(prior.baselineArchive))throw Error('Import baseline unavailable');
const newTables=[...body.matchAll(/^create table (?:if not exists )?(?:public\.)?(\w+)/gm)].map(m=>m[1]);
const newFunctions=[...new Set([...body.matchAll(/^create (?:or replace )?function (?:public\.)?(\w+)\(/gm)].map(m=>m[1]))];
if(base.tables.some(t=>newTables.includes(t.name))||base.functions.some(f=>newFunctions.includes(f.name)))throw Error('Import names already exist');
const tableNames=['tenants','profiles','view_as_context','people','companies','sites','jobs','data_imports','contact_points','customer_cards','import_row_provenance','import_profiles','job_number_aliases','communication_preferences','contact_suppressions'];
const tables=base.tables.filter(t=>tableNames.includes(t.name)).sort((a,b)=>a.name.localeCompare(b.name));
if(tables.length!==tableNames.length)throw Error('Missing shared connector prerequisites');
const helperNames=['marketing_normalize_endpoint','set_updated_at','current_tenant_id','current_user_role'];
const helpers=base.functions.filter(f=>helperNames.includes(f.name));
if(helpers.length!==helperNames.length)throw Error('Import helper dependency absent or overloaded');
if(Object.values(report.quality).some(n=>n!==0))throw Error('Existing identity conflicts require review');
const inventory=read('scripts/verify/learn-release-schema-inventory.sql').trim().replace(/;$/,'');
const sql=`-- DRAFT production governed imports. No provider access or activation.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production Import target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_capture_controls_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then raise exception 'Pinned production capture-control prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_governed_imports_v1')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array[${newTables.map(literal).join(',')}]))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${newFunctions.map(literal).join(',')}])) then
 raise exception 'Production Import candidate already exists; inspect before retry';end if;
 select jsonb_agg(t order by t->>'name') into observed from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array[${tableNames.map(literal).join(',')}]);
 if observed is distinct from ${literal(JSON.stringify(tables))}::jsonb then raise exception 'Production Import table baseline differs';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into actual_helpers from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array[${helperNames.map(literal).join(',')}]);
 if actual_helpers is distinct from ${literal(JSON.stringify(helpers))}::jsonb then raise exception 'Production Import helper baseline differs';end if;
 if exists(select 1 from import_profiles where tenant_id is null and source_system='commusoft' and name in ('Commusoft Prepared Customers','Commusoft Prepared Sites','Commusoft Prepared Jobs')) then raise exception 'Prepared import profiles already exist; review definitions before applying';end if;
 if exists(select 1 from contact_points c join people p on p.id=c.person_id where c.tenant_id<>p.tenant_id) then raise exception 'Existing contact parent mismatch';end if;
end $$;
-- Existing source/marketing structures remain intact. Three reusable import templates are added; no customer import or card backfill is performed.
${body}
insert into of_learn_deploy.migrations values('learn_governed_imports_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const out='supabase/release/learn-production/008_governed_imports';
writeFileSync(out+'.sql',sql);
writeFileSync(out+'.manifest.json',JSON.stringify({version:'learn-production-governed-imports/1',status:'draft_requires_rehearsal_and_production_approval',projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),priorSha256:prior.sha256,baselineArchive:prior.baselineArchive,sources,existingTables:tableNames,newTables,newFunctions,changedFunctions:[],newSequences:[],seededProfiles:['Commusoft Prepared Customers','Commusoft Prepared Sites','Commusoft Prepared Jobs'],newExistingConstraints:{contact_points:['contact_points_person_tenant_fk']},newExistingTriggers:{},newExistingIndexes:{customer_cards:['learn_customer_card_person_uk','learn_customer_card_company_uk']},
 limitations:['No hosted import, real customer projection or provider request.','Existing marketing permissions and source records remain unchanged.','Commusoft API intake, operator controls and current-data reconciliation follow as separate required release dependencies.','Synthetic source-to-card acceptance does not establish real provider coverage.']},null,2)+'\n');
console.log(JSON.stringify({sha256:hash(sql),tables:newTables.length,functions:newFunctions.length}));
