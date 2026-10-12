/** Production-specific additive foundation/rules candidate. Builds files only. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const read=p=>readFileSync(p,'utf8');
const literal=s=>`'${s.replaceAll("'","''")}'`;
const root='supabase/release/learn-test/';
const sources=[['002_card_work_foundations','be6f2e94a8691469b82b45dce0c3c2011a68731fc8ae339e4a1ff11dfc3d5233'],
 ['004_rules_membership','37d1673acdc896d182b41e6e079475ef69da1d0cfc5c4fbc4017b9546be98562'],
 ['005_scorecard_conflict_codes','554a7020f1ae8370f730016d10cfdd9a40b5fe08250974165de67f25802d3479']].map(([name,sha])=>({path:root+name+'.sql',sha256:sha,sql:read(root+name+'.sql')}));
for(const s of sources)if(hash(s.sql)!==s.sha256)throw Error('Reviewed rules source differs');
const take=(s,start,end)=>{const a=s.indexOf(start),b=s.indexOf(end,a);if(a<0||b<=a)throw Error('Source selection differs');return s.slice(a,b);};
const foundation=take(sources[0].sql,'-- Validate declared same-tenant references','insert into of_test_deploy.migrations');
const rules=take(sources[1].sql,'-- SOURCE 20261029120000_learn_scorecard_drafts.sql','-- Explicitly release the current user');
const conflicts=take(sources[2].sql,'-- Business conflicts return HTTP 409','insert into of_test_deploy.migrations');
const original=JSON.parse(read('.verification-results/production-release-baseline-v1/schema.json'));
const baseline=JSON.parse(read('.verification-results/production-release-baseline-v1/report.json'));
const fm=JSON.parse(read(root+'002_card_work_foundations.manifest.json'));
const tableNames=[...fm.tables,'config_versions','view_as_context'].sort();
const expected=original.tables.filter(t=>tableNames.includes(t.name)).sort((a,b)=>a.name.localeCompare(b.name));
if(expected.length!==35||expected.some(t=>t.owner!=='postgres'||!t.rls))throw Error('Production foundations differ');
const helpers=original.functions.filter(f=>['current_tenant_id','current_user_role'].includes(f.name)&&f.arguments==='');
if(helpers.length!==2||helpers.some(f=>!f.authenticatedExecute))throw Error('Existing helper authority differs');
const names=[...new Set([...foundation.matchAll(/create function public\.(\w+)\(/g),...rules.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)].map(m=>m[1]))];
if(names.length!==11)throw Error('Function selection differs');
const inventorySql=read('scripts/verify/learn-release-schema-inventory.sql').trim().replace(/;$/,'');
const prior=JSON.parse(read('supabase/release/learn-production/001_launch_metadata_views.manifest.json'));
const audit=`-- Read-only validation mirrors the reference guard before enabling it.
do $$ declare tab text; fk record; tenant_expr text; extra_join text; invalid bigint; begin
 foreach tab in array array[${fm.tables.filter(t=>!['domain_object_types','state_definitions','state_transitions','authority_permissions','domain_entity_types'].includes(t)).map(literal).join(',')}] loop
  tenant_expr:=case when tab='org_unit_members' then 'g.tenant_id' else 't.tenant_id' end;
  extra_join:=case when tab='org_unit_members' then ' join public.org_units g on g.id=t.org_unit_id' else '' end;
  for fk in select pn.nspname as schema_name,pc.relname as table_name,sa.attname as child_column,pa.attname as parent_column
   from pg_constraint k join pg_class pc on pc.oid=k.confrelid join pg_namespace pn on pn.oid=pc.relnamespace
   join pg_attribute sa on sa.attrelid=k.conrelid and sa.attnum=k.conkey[1]
   join pg_attribute pa on pa.attrelid=k.confrelid and pa.attnum=k.confkey[1]
   where k.conrelid=('public.'||quote_ident(tab))::regclass and k.contype='f'
   and cardinality(k.conkey)=1 and cardinality(k.confkey)=1
   and exists(select 1 from pg_attribute a where a.attrelid=k.confrelid and a.attname='tenant_id' and not a.attisdropped)
  loop
   execute format('select count(*) from public.%I t %s left join %I.%I p on p.%I=t.%I where t.%I is not null and (p.%I is null or (%s is distinct from p.tenant_id and not (%L and p.tenant_id is null)))',
    tab,extra_join,fk.schema_name,fk.table_name,fk.parent_column,fk.child_column,fk.child_column,fk.parent_column,tenant_expr,
    fk.schema_name='public' and fk.table_name in ('config_versions','import_profiles')) into invalid;
   if invalid<>0 then raise exception 'Existing foundation reference conflict in %.%: % records require review',tab,fk.child_column,invalid;end if;
  end loop;
 end loop;
end $$;`;
const sql=`-- DRAFT production foundation and scorecard rules prerequisite. No hosted executor.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$ declare observed jsonb; actual_helpers jsonb; begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
  or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production target, deployer and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_launch_metadata_views_v1'
  and source_sha256='${prior.sha256}' and project_ref='tgbnakbxwcqjeimygroz') then raise exception 'Pinned production metadata prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_foundation_rules_v1')
  or to_regclass('public.learn_member_history') is not null or to_regclass('public.learn_scorecard_publications') is not null
  or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${names.map(literal).join(',')}])) then
  raise exception 'Production rules candidate objects already exist; inspect before retry';end if;
 select jsonb_agg(t order by t->>'name') into observed from (${inventorySql}) q,
  lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array[${tableNames.map(literal).join(',')}]);
 if observed is distinct from ${literal(JSON.stringify(expected))}::jsonb then raise exception 'Production foundation catalog differs from reviewed baseline';end if;
 select jsonb_agg(f order by f->>'name') into actual_helpers from (${inventorySql}) q,
  lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name' in ('current_tenant_id','current_user_role') and f->>'arguments'='';
 if actual_helpers is distinct from ${literal(JSON.stringify(helpers.sort((a,b)=>a.name.localeCompare(b.name))))}::jsonb then raise exception 'Production helper definition or authority differs';end if;
end $$;
${audit}
-- Existing foundation tables, policies, grants and View-As behavior are retained.
${foundation}
${rules}
${conflicts}
insert into of_learn_deploy.migrations values('learn_foundation_rules_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const directory='supabase/release/learn-production';
writeFileSync(directory+'/002_foundation_rules.sql',sql);
writeFileSync(directory+'/002_foundation_rules.manifest.json',JSON.stringify({version:'learn-production-foundation-rules/1',
 status:'draft_requires_rehearsal_and_production_approval',projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),
 priorSha256:prior.sha256,baselineArchive:baseline.archive,sources:sources.map(({sql,...s})=>s),
 existingTables:tableNames,newTables:['learn_member_history','learn_scorecard_publications'],newFunctions:names,
 selections:['Foundation reference guard and triggers only; all 33 production foundation tables already exist.',
 'Rule drafts, membership history, immutable publication and draft reader; existing View-As table/policies/grants retained.',
 'Reviewed conflict-code replacements merged into the same transaction.'],
 limitations:['No legacy source grants or policies are narrowed here; combined permission and existing-writer acceptance remain required.',
 'No retrospective membership history, rule publication, measurement or pay decision is seeded.',
 'Only the foundation/rules prerequisite; full combined release and live approval remain outstanding.']
},null,2)+'\n');
console.log(JSON.stringify({sha256:hash(sql),existingTables:tableNames.length,newFunctions:names.length}));
