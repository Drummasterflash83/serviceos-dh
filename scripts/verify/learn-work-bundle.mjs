/** Forward capture and collectors, preserving previously installed writer fixes. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=new URL('../../',import.meta.url),hash=s=>createHash('sha256').update(s).digest('hex');
export const WORK_RELEASE_NAME='learn_work_capture_collectors_v1';
export function buildWork(){
 const inputs=['20261029180000_learn_work_transition_history.sql','20261029190000_learn_work_source_capture.sql','20261029230000_learn_work_handoff_measurements.sql','20261030010000_learn_work_residence_measurements.sql','20261030060000_learn_work_collection_release_guards.sql'];
 const parts=[],sources=[];
 for(const name of inputs){const original=readFileSync(new URL('supabase/migrations/'+name,root),'utf8');let selected=original,selection='whole file';
  if(name.includes('transition_history')){const end=original.indexOf('create or replace function public.work_transition_apply(');if(end<0)throw Error('Work history source framing changed');selected=original.slice(0,end);selection='history columns, immutable-row guard and grants only; governed transition writer deferred with action registries/authority';}
  if(name.includes('handoff_measurements')){const start=original.indexOf('-- Retain the existing append contract'),end=original.indexOf('create function public.learn_work_handoffs_collect(');if(start<0||end<start)throw Error('Handoff source framing changed');selected=original.slice(0,start)+original.slice(end);selection='receipt table and collector; retain installed append implementation and use latest owner resolver from residence migration';}
  sources.push({path:'supabase/migrations/'+name,sha256:hash(original),selectedSha256:hash(selected),selection});parts.push(`-- SOURCE ${name}\n-- Original SHA-256 ${hash(original)}\n${selected}`);
 }
 const body=parts.join('\n'),functions=[...body.matchAll(/^create (?:or replace )?function public\.(\w+)\(/gm)].map(m=>m[1]);
 if(functions.length!==8||new Set(functions).size!==8)throw Error('Work function contract changed');
 const sql=`-- Generated TEST-only forward work capture/collection. No historical baseline.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target/checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_measurements_reviews_v1' and source_sha256='8a1b32fd0a1896946a7a6f79dd3598eabfec237ca418a4fab6d3b7ee155a15e8' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Verified measurement prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='${WORK_RELEASE_NAME}') then raise exception 'Work release already exists';end if;
 if to_regclass('public.learn_work_measurement_runs') is not null or to_regclass('public.learn_work_capture_sequence') is not null then raise exception 'Work capture objects already exist';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${functions.map(f=>`'${f}'`).join(',')}])) then raise exception 'Work function already exists';end if;
end $$;
${body}
create trigger learn_work_receipt_reference_guard before insert or update on public.learn_work_measurement_runs
 for each row execute function public.learn_foundation_reference_guard();
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'${WORK_RELEASE_NAME}','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
 return {sql,manifest:{version:'learn-work-bundle/1',projectRef:'saatxzwxvdvqevbnskxy',releaseName:WORK_RELEASE_NAME,sha256:hash(sql),tables:['learn_work_measurement_runs'],sequences:['learn_work_capture_sequence'],functions,sources,
  affectedTables:['intelligence_objects','object_state_history','learn_work_measurement_runs'],modifiedFunctions:['learn_performance_append'],
  existingChanges:['Paired snapshots/capture fields, indexes and immutability/truncation guards on object_state_history.','Forward capture trigger on intelligence_objects, without baseline or row updates.','One added evidence table in the retained performance append allowlist; conflict and historical group validation remain unchanged.'],
  deferred:['Governed work-transition writer, action registry/state seeds, scoped authority and Edge endpoint.','Staff/team collection permissions, source reconciliation and approved calendars/exclusions.'],
  acceptanceNote:'Work captures, calculations, measurements and reviewer/actor identities are retained; use marked TEST fixtures and revoke synthetic access.'}};
}
export function checkedWork(){const b=buildWork();if(readFileSync(new URL('supabase/release/learn-test/007_work_capture_collectors.sql',root),'utf8')!==b.sql||readFileSync(new URL('supabase/release/learn-test/007_work_capture_collectors.manifest.json',root),'utf8')!==JSON.stringify(b.manifest,null,2)+'\n')throw Error('Work bundle differs from retained sources');return b;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv[2]==='--write'){const b=buildWork();writeFileSync(new URL('supabase/release/learn-test/007_work_capture_collectors.sql',root),b.sql);writeFileSync(new URL('supabase/release/learn-test/007_work_capture_collectors.manifest.json',root),JSON.stringify(b.manifest,null,2)+'\n');console.log(b.manifest.sha256);}else{checkedWork();console.log('Work source manifest: PASS');}}
