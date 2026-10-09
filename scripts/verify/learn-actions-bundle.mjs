/** Governed actions prepared from retained sources; no tenant grant or baseline. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=new URL('../../',import.meta.url),hash=s=>createHash('sha256').update(s).digest('hex');
export const ACTIONS_RELEASE_NAME='learn_governed_work_actions_v1';
export const ACTIONS_FUNCTIONS=['learn_work_cover_day','learn_work_authority','work_transition_apply'];
export function buildActions(){
 const sources=[],parts=[];
 function source(name,select,selection){const path='supabase/migrations/'+name,original=readFileSync(new URL(path,root),'utf8'),selected=select(original);if(!selected)throw Error('Empty action selection');sources.push({path,sha256:hash(original),selectedSha256:hash(selected),selection});parts.push(`-- SOURCE ${name}\n-- Original SHA-256 ${hash(original)}\n${selected}`);}
 function between(s,a,b){const start=s.indexOf(a),end=s.indexOf(b,start);if(start<0||end<start)throw Error('Action source framing changed');return s.slice(start,end);}
 source('20260717120000_action_loop.sql',s=>between(s,'create table if not exists object_classes (','-- ── Universal object-to-object relationships').split('\n').filter(l=>!l.includes('add column if not exists learning_applied')).join('\n')+between(s,'alter table object_classes enable row level security;','alter table automation_intent_states enable row level security;'),'object-class registry, nullable taxonomy columns/FKs/index and registry read policy only; no links, automation or learning pointer');
 source('20260717120100_seed_action_loop.sql',s=>`insert into domain_object_types(domain,object_type,label,object_class) values\n ('serviceos','Action','Action','action'),('productos','Action','Action','action');\n`+between(s,'insert into state_definitions (','-- ── SLA for Actions'),'two Action type registrations and reference states/edges; no tenant enablement, policy, SLA or config seed');
 source('20260819120000_view_as_and_superadmin.sql',s=>between(s,'insert into authority_permissions (','-- ── 2. Secure server-resolved')+s.slice(s.indexOf('insert into state_transitions (')),'superadmin vocabulary and additive lifecycle edges only; no grants/View-As replacement');
 source('20261029210000_learn_work_scoped_authority.sql',s=>s,'current scoped authority and transactional writer');
 source('20261030070000_learn_work_action_validation.sql',s=>s,'repeat verb/evidence/guard constraints in persistence and hardened search paths');
 const beforePath='docs/operations/evidence/learn-test-action-registries-before-2026-10-09.json';
 const beforeSource=readFileSync(new URL(beforePath,root),'utf8'),before=JSON.parse(beforeSource);
 if(before.projectRef!=='saatxzwxvdvqevbnskxy'||['types','states','transitions'].some(k=>before.registries[k].length))throw Error('Unexpected action registry baseline');
 sources.push({path:beforePath,sha256:hash(beforeSource),selection:'exact pre-existing permission vocabulary; require empty action type/state/transition registries'});
 const sql=`-- Generated TEST-only governed work actions. No source backfill or tenant grants.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations,domain_object_types,state_definitions,state_transitions,authority_permissions in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target/checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_work_capture_collectors_v1' and source_sha256='d70e2cab5866488310f0907c203fb11796dc175ad3223640d3a2ecd437f64ff5' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Verified work capture prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='${ACTIONS_RELEASE_NAME}') then raise exception 'Action release already exists';end if;
 if to_regclass('public.object_classes') is not null or exists(select 1 from domain_object_types)
 or exists(select 1 from state_definitions) or exists(select 1 from state_transitions) then raise exception 'Action registry baseline differs';end if;
 if (select jsonb_agg(to_jsonb(p) order by permission) from authority_permissions p) is distinct from $permissions$${JSON.stringify(before.registries.permissions)}$permissions$::jsonb then raise exception 'Permission vocabulary differs';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${ACTIONS_FUNCTIONS.map(n=>`'${n}'`).join(',')}])) then raise exception 'Action function already exists';end if;
end $$;
${parts.join('\n')}
revoke all on public.object_classes from public,anon,authenticated,service_role;
grant select on public.object_classes to authenticated;
grant select,insert,update,delete on public.object_classes to service_role;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'${ACTIONS_RELEASE_NAME}','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
 return {sql,manifest:{version:'learn-actions-bundle/1',projectRef:'saatxzwxvdvqevbnskxy',releaseName:ACTIONS_RELEASE_NAME,sha256:hash(sql),tables:['object_classes'],functions:ACTIONS_FUNCTIONS,affectedTables:['domain_object_types','intelligence_objects','object_classes'],registryTables:['object_classes','domain_object_types','state_definitions','state_transitions','authority_permissions'],sources,
 existingChanges:['Nullable action taxonomy fields and controlled registry references; no work row updates.','Two reference Action types, 16 states, 30 unguarded edges and one permission vocabulary entry; no staff grant.'],
 deferred:['Edge endpoint deployment and real signed-in action acceptance.','Roster mutation concurrency adoption, full scoped work collection/UI and existing raw-history visibility.'],
 acceptanceNote:'Source capture and attributed transition history commit together. Retain synthetic actors, work and evidence; revoke access afterward.'}};
}
export function checkedActions(){const b=buildActions();if(readFileSync(new URL('supabase/release/learn-test/008_governed_work_actions.sql',root),'utf8')!==b.sql||readFileSync(new URL('supabase/release/learn-test/008_governed_work_actions.manifest.json',root),'utf8')!==JSON.stringify(b.manifest,null,2)+'\n')throw Error('Action bundle differs from retained sources');return b;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv[2]==='--write'){const b=buildActions();writeFileSync(new URL('supabase/release/learn-test/008_governed_work_actions.sql',root),b.sql);writeFileSync(new URL('supabase/release/learn-test/008_governed_work_actions.manifest.json',root),JSON.stringify(b.manifest,null,2)+'\n');console.log(b.manifest.sha256);}else{checkedActions();console.log('Action source manifest: PASS');}}
