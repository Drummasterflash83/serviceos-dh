/** Build governed work against the archived production registries, never deploy. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(p,'utf8'),hash=s=>createHash('sha256').update(s).digest('hex');
const literal=s=>`'${s.replaceAll("'","''")}'`;
const path='supabase/release/learn-test/008_governed_work_actions.sql';
const source=read(path),sourceHash='4f27681d0f6786b04374cb409fdea61babff40452f263ce8e3c9d43966f215f8';
if(hash(source)!==sourceHash)throw Error('Pinned action source differs');
const start=source.indexOf('-- SOURCE 20261029210000_learn_work_scoped_authority.sql');
const end=source.indexOf('revoke all on public.object_classes',start);
if(start<0||end<=start)throw Error('Action selection boundary differs');
const body=source.slice(start,end);
const baseline=JSON.parse(read('.verification-results/production-actions-baseline-v2/schema.json'));
const inspected=JSON.parse(read('.verification-results/production-actions-baseline-v2/report.json'));
if(inspected.state!=='offline_action_prerequisites_inspected'||!inspected.containerRemoved)throw Error('Offline prerequisite inspection incomplete');
const prior=JSON.parse(read('supabase/release/learn-production/003_measurements_work.manifest.json'));
if(JSON.stringify(inspected.archive)!==JSON.stringify(prior.baselineArchive))throw Error('Archive differs');
const registryTables=['object_classes','domain_object_types','state_definitions','state_transitions','authority_permissions'];
const authorityTables=['tenants','profiles','team_members','org_units','responsibility_assignments','authority_grants','view_as_context'];
const tableNames=[...registryTables,...authorityTables,'intelligence_objects','object_state_history','objectives','objective_links'].sort();
const expected=baseline.tables.filter(t=>tableNames.includes(t.name)).sort((a,b)=>a.name.localeCompare(b.name));
if(expected.length!==16)throw Error('Action table prerequisites differ');
const newFunctions=[...new Set([...body.matchAll(/^create (?:or replace )?function public\.(\w+)\(/gm)].map(m=>m[1]))];
if(newFunctions.length!==5||baseline.functions.some(f=>newFunctions.includes(f.name)))throw Error('Action function prerequisites differ');
const inventory=read('scripts/verify/learn-release-schema-inventory.sql').trim().replace(/;$/,'');
const sql=`-- DRAFT production governed work. Existing registry rows, policies and grants retained.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations,public.object_classes,public.domain_object_types,public.state_definitions,public.state_transitions,public.authority_permissions in share row exclusive mode;
do $$ declare observed jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
  or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production action target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_measurements_work_v1'
  and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then raise exception 'Pinned production work prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_governed_work_actions_v1')
  or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${newFunctions.map(literal).join(',')}])) then
  raise exception 'Production action candidate already exists; inspect before retry';end if;
 select jsonb_agg(t order by t->>'name') into observed from (${inventory}) q,
  lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array[${tableNames.map(literal).join(',')}]);
 if observed is distinct from ${literal(JSON.stringify(expected))}::jsonb then raise exception 'Production action baseline catalog differs';end if;
 -- Validate only the known Action vocabulary. Other domains, guards and permissions remain untouched.
 if not exists(select 1 from object_classes where class='action')
  or (select count(*) from domain_object_types where domain in ('serviceos','productos') and object_type='Action' and object_class='action')<>2
  or not exists(select 1 from authority_permissions where permission='tenant.superadmin')
  or exists(select 1 from (values ('proposed','ready',false),('ready','ready',false),('in_progress','monitoring',false),('waiting','waiting',false),('blocked','blocked',false),('escalated','escalated',false),('complete','complete',true),('cancelled','cancelled',true)) s(state,maps_to_universal,is_terminal)
   cross join (values ('serviceos'),('productos')) d(domain) where not exists(select 1 from state_definitions x where x.domain=d.domain and x.object_type='Action' and x.state=s.state and x.maps_to_universal=s.maps_to_universal and x.is_terminal=s.is_terminal))
  or exists(select 1 from (values ('proposed','ready'),('ready','in_progress'),('in_progress','waiting'),('waiting','in_progress'),('in_progress','blocked'),('blocked','escalated'),('in_progress','complete'),('ready','cancelled'),('proposed','cancelled'),('in_progress','cancelled'),('waiting','cancelled'),('blocked','cancelled'),('escalated','cancelled'),('blocked','in_progress'),('escalated','in_progress')) e(from_state,to_state)
   cross join (values ('serviceos'),('productos')) d(domain) where not exists(select 1 from state_transitions x where x.domain=d.domain and x.object_type='Action' and x.from_state=e.from_state and x.to_state=e.to_state and x.guard is null)) then
   raise exception 'Existing Action vocabulary requires review; no registry rows changed';end if;
end $$;
${body}
insert into of_learn_deploy.migrations values('learn_governed_work_actions_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const directory='supabase/release/learn-production/004_governed_work_actions';
writeFileSync(directory+'.sql',sql);
writeFileSync(directory+'.manifest.json',JSON.stringify({version:'learn-production-governed-work/1',status:'draft_requires_rehearsal_and_production_approval',projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),priorSha256:prior.sha256,baselineArchive:prior.baselineArchive,sources:[{path,sha256:sourceHash}],existingTables:tableNames,newFunctions,newTables:[],newSequences:[],registryTables,authorityTables,
 existingChanges:['Nineteen added triggers serialize roster, preview and registry changes against work actions.','Existing work registries, table definitions, policies, grants and functions are retained; no seeds or source backfill.','New service-only transition RPC validates actor, current authority, verb, state, ownership and evidence atomically.'],limitations:['Offline database acceptance is distinct from signed-in acceptance and provider integration.','Later work-history and authority fixes still need inclusion in the complete production release.','No hosted execution or production promotion approval.']},null,2)+'\n');
console.log(JSON.stringify({sha256:hash(sql),newFunctions:newFunctions.length,existingTables:tableNames.length}));
