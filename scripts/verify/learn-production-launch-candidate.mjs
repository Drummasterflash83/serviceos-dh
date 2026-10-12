/** Build a production-specific candidate; never connects to or changes a DB. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const sourcePath='supabase/release/learn-test/001_launch_metadata_views.sql';
const source=readFileSync(sourcePath,'utf8');
const sourceHash='5bbff33c4ece496cd6220a9beb1fc0d70cb31e205f2deaa4a10026e4a3e219aa';
if(hash(source)!==sourceHash)throw Error('Reviewed source differs');
const baseline=JSON.parse(readFileSync('.verification-results/production-release-baseline-v1/schema.json','utf8'));
const report=JSON.parse(readFileSync('.verification-results/production-release-baseline-v1/report.json','utf8'));
if(report.state!=='offline_release_baseline_recorded'||!report.containerRemoved)throw Error('Verified offline baseline required');
const inventorySql=readFileSync('scripts/verify/learn-release-schema-inventory.sql','utf8').trim().replace(/;$/,'');
if(hash(inventorySql+';\n')!==report.inventorySqlSha256)throw Error('Inventory definition differs');
const start=source.indexOf('create role learn_launch_metadata_reader '),end=source.indexOf('insert into of_test_deploy.migrations');
if(start<0||end<=start)throw Error('Reviewed selection boundary missing');
const body=source.slice(start,end);
const policies=[...body.matchAll(/create policy (\w+) on public\.(\w+) for select to learn_launch_metadata_reader\n using\(([\s\S]*?)\);\n/g)];
if(policies.length!==9||new Set(policies.map(p=>p[2])).size!==9)throw Error('Reader policy source differs');
const sourceTables=policies.map(p=>p[2]).sort();
const expected=baseline.tables.filter(t=>sourceTables.includes(t.name)).sort((a,b)=>a.name.localeCompare(b.name));
if(expected.length!==9||expected.some(t=>!t.rls||t.owner!=='postgres'))throw Error('Production source prerequisites differ');
const literal=s=>`'${s.replaceAll("'","''")}'`;
const restrictive=policies.map(p=>`create policy learn_launch_production_boundary on public.${p[2]} as restrictive for select to learn_launch_metadata_reader\n using(${p[3]});`).join('\n');
const sql=`-- DRAFT production-specific metadata step; no hosted execution is authorised.
-- Generated from reviewed source and archived production metadata. Never a full release.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$ declare observed jsonb; begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
  or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then
  raise exception 'Reviewed production target, deployer and package checksum required';end if;
 if to_regnamespace('of_learn_deploy') is not null or exists(select 1 from pg_roles where rolname='learn_launch_metadata_reader')
  or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'learn_launch_%') then
  raise exception 'Initial production release objects already exist; inspect before retry';end if;
 select jsonb_agg(t order by t->>'name') into observed from (${inventorySql}) q,
  lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array[${sourceTables.map(literal).join(',')}]);
 if observed is distinct from ${literal(JSON.stringify(expected))}::jsonb then
  raise exception 'Production source table catalog differs from reviewed baseline';end if;
end $$;
create schema of_learn_deploy authorization postgres;
revoke all on schema of_learn_deploy from public,anon,authenticated,service_role;
create table of_learn_deploy.migrations(
 migration_name text primary key, source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 project_ref text not null check(project_ref='tgbnakbxwcqjeimygroz'), applied_at timestamptz not null);
revoke all on of_learn_deploy.migrations from public,anon,authenticated,service_role;
${body}
-- Existing production policies may apply to PUBLIC. These boundaries must AND
-- with those policies, so their broader access cannot widen the new view role.
${restrictive}
insert into of_learn_deploy.migrations values('learn_launch_metadata_views_v1',
 current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const directory='supabase/release/learn-production';mkdirSync(directory,{recursive:true});
writeFileSync(directory+'/001_launch_metadata_views.sql',sql);
writeFileSync(directory+'/001_launch_metadata_views.manifest.json',JSON.stringify({
 version:'learn-production-launch-candidate/1',status:'draft_requires_offline_rehearsal_and_production_approval',
 projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),source:{path:sourcePath,sha256:sourceHash,
 selection:'reader role, views and column privileges only; TEST guards/ledger excluded'},
 baselineArchive:report.archive,sourceTables,inventorySqlSha256:report.inventorySqlSha256,
 productionAdjustments:['Exact production source catalog guard and separate restricted migration ledger.',
 'Restrictive reader-only profile and tenant/owner policies coexist with all original production policies.',
 'No source row, existing table grant, existing policy, trigger, index or constraint is removed or replaced.'],
 limitations:['Only the first metadata-read prerequisite, not the full LEARN release.',
 'No hosted executor or promotion approval. Refresh production baseline before an approved deployment.']
},null,2)+'\n');
console.log(JSON.stringify({candidate:directory+'/001_launch_metadata_views.sql',sha256:hash(sql),sourceTables:sourceTables.length}));
