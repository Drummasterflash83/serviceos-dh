/** Build an additive production roster package from reviewed existing sources. Offline only. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(p,'utf8'),sha=v=>createHash('sha256').update(v).digest('hex');
const quote=v=>"'"+v.replaceAll("'","''")+"'",root='supabase/release/learn-production/';
const paths=['supabase/migrations/20260913120000_office_roster_controlplane.sql','supabase/migrations/20261029200000_learn_roster_recovery_guards.sql'];
const sources=paths.map(path=>({path,sha256:sha(read(path))}));
const baseline=JSON.parse(read('.verification-results/production-operator-baseline-v1/schema.json'));
const provenance=JSON.parse(read('.verification-results/production-operator-baseline-v1/report.json'));
const prior=JSON.parse(read(root+'015_operator_context.manifest.json'));
if(provenance.state!=='offline_operator_prerequisites_inspected'||!provenance.containerRemoved||
  JSON.stringify(provenance.archive)!==JSON.stringify(prior.baselineArchive)||
  prior.newTables.length||Object.keys(prior.extendedTables).length||prior.changedViews.length||
  sha(read(root+'015_operator_context.sql'))!==prior.sha256)throw Error('Prior unchanged-table baseline required');
const signatures=[
'cp_roster_upsert_member(uuid,uuid,text,uuid,text,text,text,text,timestamptz,text,text,text,boolean)',
'cp_member_lifecycle(uuid,uuid,text,timestamptz,text,text,text,boolean)',
'cp_upsert_responsibility(uuid,uuid,uuid,text,text,text,text,boolean,int,uuid,boolean,timestamptz,text,text,text,boolean)',
'cp_end_responsibility(uuid,uuid,timestamptz,text,text,text,boolean)',
'cp_grant_authority(uuid,uuid,text,text,text,boolean,text,text,text,boolean)',
'cp_end_authority(uuid,uuid,text,text,text,boolean)'];
if(signatures.some(s=>!read(paths[0]).includes("'"+s+"'")))throw Error('Roster signature source changed');
const functions=['learn_roster_write_guard',...signatures.map(s=>s.split('(')[0])];
let body=read(paths[1]).replace(/^create or replace function (cp_\w+)\(/gm,'create function public.$1(');
if((body.match(/^create function /gm)||[]).length!==7||baseline.functions.some(f=>functions.includes(f.name)))throw Error('Roster function baseline differs');
const tableNames=['authority_grants','authority_permissions','controlplane_change_log','org_units','responsibility_assignments','team_members','tenants'];
const tables=baseline.tables.filter(t=>tableNames.includes(t.name)).sort((a,b)=>a.name.localeCompare(b.name));
if(tables.length!==7||tables.find(t=>t.name==='team_members').columns.some(c=>['formal_role_status','target_role'].includes(c.name)))throw Error('Roster table baseline differs');
const columns=`alter table public.team_members add column formal_role_status text not null default 'proposed', add column target_role text;
alter table public.team_members add constraint team_members_formal_role_status_check check(formal_role_status in ('proposed','confirmed'));`;
const acl=signatures.map(s=>`revoke all on function public.${s} from public,anon,authenticated,service_role;\ngrant execute on function public.${s} to service_role;`).join('\n');
const inventory=read('scripts/verify/learn-release-schema-inventory.sql').trim().replace(/;$/,'');
const sql=`-- DRAFT: additive roster support; no tenant seeds, user grants or production execution.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production roster target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_operator_context_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then raise exception 'Pinned production roster prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_roster_support_v1')
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${functions.map(quote).join(',')}])) then raise exception 'Production roster candidate already exists; inspect before retry';end if;
 select jsonb_agg(t order by t->>'name') into observed from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array[${tableNames.map(quote).join(',')}]);
 if observed is distinct from ${quote(JSON.stringify(tables))}::jsonb then raise exception 'Production roster table baseline differs';end if;
end$$;
${columns}
${body}
${acl}
insert into of_learn_deploy.migrations values('learn_roster_support_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const stem=root+'016_roster_support';writeFileSync(stem+'.sql',sql);
writeFileSync(stem+'.manifest.json',JSON.stringify({version:'learn-production-roster-support/1',status:'draft_requires_rehearsal_and_production_approval',projectRef:'tgbnakbxwcqjeimygroz',sha256:sha(sql),priorSha256:prior.sha256,baselineArchive:prior.baselineArchive,sources,existingTables:tableNames,newTables:[],newFunctions:functions,changedFunctions:[],changedViews:[],newRole:null,newSequences:[],extendedTables:{team_members:['formal_role_status','target_role']},newExistingConstraints:{team_members:['team_members_formal_role_status_check']},newExistingIndexes:{},newExistingTriggers:{},newExistingPolicies:{},newStoragePolicies:[],newBuckets:[],limitations:['Adds six audited service-only roster actions and one private guard. Existing operator endpoint authenticates the original actor; no login, authority grant, staff assignment or tenant data is seeded.','Existing staff receive only the additive formal_role_status default proposed; original columns and rows must remain unchanged.','Requires isolated production-archive rehearsal and explicit production release approval.']},null,2)+'\n');
console.log(JSON.stringify({sha256:sha(sql),newFunctions:functions.length,extendedColumns:2}));
