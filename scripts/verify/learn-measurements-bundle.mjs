/** Reproducible TEST objective/measurement/review prerequisite release. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=new URL('../../',import.meta.url),hash=s=>createHash('sha256').update(s).digest('hex');
export const MEASUREMENTS_RELEASE_NAME='learn_measurements_reviews_v1';
export function buildMeasurements(){
 const inputs=['20260720120000_objectives.sql','20260720120100_objectives_hardening.sql','20261029150000_learn_performance_measurements.sql','20261029160000_learn_performance_reviews.sql','20261030040000_learn_measurement_conflicts_retention.sql','20261030050000_learn_measurement_group_history.sql'];
 const sources=[],parts=[];
 for(const name of inputs){
  const original=readFileSync(new URL('supabase/migrations/'+name,root),'utf8');let selected=original,selection='whole file';
  if(name==='20260720120000_objectives.sql'){
   const start=original.indexOf('-- ── Graph projection:'),end=original.indexOf('-- ── RLS:');
   if(start<0||end<start)throw Error('Objective source framing changed');
   selected=original.slice(0,start)+original.slice(end);selection='schema and controlled registries; graph node-type seed deferred with objective projection';
  }
  if(name.includes('202610291')){
   if(selected.split('\nbegin;\n').length!==2||selected.split('\ncommit;\n').length!==2)throw Error('Measurement transaction framing changed');
   selected=selected.replace('\nbegin;\n','\n').replace('\ncommit;\n','\n');selection='whole file inside enclosing release transaction';
  }
  sources.push({path:'supabase/migrations/'+name,sha256:hash(original),selectedSha256:hash(selected),selection});
  parts.push(`-- SOURCE ${name}\n-- Original SHA-256 ${hash(original)}\n${selected}`);
 }
 const body=parts.join('\n');
 const tables=[...body.matchAll(/^create table (?:if not exists )?(?:public\.)?(\w+)\s*\(/gm)].map(m=>m[1]);
 const functions=[...body.matchAll(/^create (?:or replace )?function (?:public\.)?(\w+)\(/gm)].map(m=>m[1]);
 if(tables.length!==16||functions.length!==9)throw Error(`Measurement object contract changed: ${tables.length} tables, ${functions.length} functions`);
 const tenantTables=['metric_definitions','measurements','objectives','objective_metrics','objective_constraints','objective_links','objective_health','learn_performance_reviews'];
 const sql=`-- Generated TEST-only measurement/review release. No tenant data, imports or baseline.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ declare n text;begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_scorecard_conflict_codes_v1'
 and project_ref='saatxzwxvdvqevbnskxy' and source_sha256='554a7020f1ae8370f730016d10cfdd9a40b5fe08250974165de67f25802d3479') then raise exception 'Verified rules prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='${MEASUREMENTS_RELEASE_NAME}') then raise exception 'Measurement release already exists';end if;
 foreach n in array array[${tables.map(t=>`'${t}'`).join(',')}] loop
  if to_regclass('public.'||n) is not null then raise exception 'Measurement table already exists: %',n;end if;
 end loop;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${functions.map(f=>`'${f}'`).join(',')}])) then raise exception 'Measurement function already exists';end if;
end $$;
${body}
-- Explicit role access, with an unconditional tenant boundary over legacy provider reads.
do $$ declare t text;begin
 foreach t in array array[${tables.map(t=>`'${t}'`).join(',')}] loop
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated,service_role',t);
 end loop;
 foreach t in array array[${tenantTables.map(t=>`'${t}'`).join(',')}] loop
  execute format('create policy learn_measurement_tenant_boundary on public.%I as restrictive for select to authenticated using (tenant_id=public.current_tenant_id())',t);
  execute format('create trigger learn_measurement_reference_guard before insert or update on public.%I for each row execute function public.learn_foundation_reference_guard()',t);
 end loop;
 -- Trusted objective/measurement adapters retain DML; immutable ledgers reject edits.
 foreach t in array array[${tenantTables.filter(t=>t!=='learn_performance_reviews').map(t=>`'${t}'`).join(',')}] loop
  execute format('grant insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
-- Trigger-only functions do not need direct application execution.
revoke all on function public.objectives_strategic_guard(),public.objectives_child_guard(),
 public.metric_definitions_guard(),public.objectives_append_only(),public.learn_metric_scope_guard()
 from public,anon,authenticated,service_role;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'${MEASUREMENTS_RELEASE_NAME}','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
 return {sql,manifest:{version:'learn-measurements-bundle/1',releaseName:MEASUREMENTS_RELEASE_NAME,projectRef:'saatxzwxvdvqevbnskxy',sha256:hash(sql),tables,functions,tenantTables,sources,
  existingChanges:['No existing public table/function definitions change; deployment receipt is appended.'],
  deferred:['Work transition/capture and collection adapters.','Real source adapters, review UI acceptance and full LEARN rollout.'],
  acceptanceNote:'Measurements/reviews are retained. Reviewer profiles are referenced by retained review rows; revoke synthetic access rather than deleting that evidence or disabling guards.'}};
}
export function checkedMeasurements(){const b=buildMeasurements();if(readFileSync(new URL('supabase/release/learn-test/006_measurements_reviews.sql',root),'utf8')!==b.sql||readFileSync(new URL('supabase/release/learn-test/006_measurements_reviews.manifest.json',root),'utf8')!==JSON.stringify(b.manifest,null,2)+'\n')throw Error('Measurement release differs from retained sources');return b;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv[2]==='--write'){const b=buildMeasurements();writeFileSync(new URL('supabase/release/learn-test/006_measurements_reviews.sql',root),b.sql);writeFileSync(new URL('supabase/release/learn-test/006_measurements_reviews.manifest.json',root),JSON.stringify(b.manifest,null,2)+'\n');console.log(JSON.stringify(b.manifest));}else{checkedMeasurements();console.log('Measurement manifest: PASS');}}
