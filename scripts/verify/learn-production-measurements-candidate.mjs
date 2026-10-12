/** Build additive production measurement/work prerequisites, never deploy them. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(p,'utf8'),hash=s=>createHash('sha256').update(s).digest('hex');
const literal=s=>`'${s.replaceAll("'","''")}'`;
const sources=[['006_measurements_reviews','8a1b32fd0a1896946a7a6f79dd3598eabfec237ca418a4fab6d3b7ee155a15e8'],
 ['007_work_capture_collectors','d70e2cab5866488310f0907c203fb11796dc175ad3223640d3a2ecd437f64ff5']]
 .map(([n,h])=>({path:'supabase/release/learn-test/'+n+'.sql',sha256:h,sql:read('supabase/release/learn-test/'+n+'.sql')}));
for(const s of sources)if(hash(s.sql)!==s.sha256)throw Error('Pinned measurement/work source differs');
const select=(s,a,b)=>{const start=s.indexOf(a),end=s.indexOf(b,start);if(start<0||end<=start)throw Error('Selection boundary differs');return s.slice(start,end);};
const measurements=select(sources[0].sql,'-- SOURCE 20261029150000_learn_performance_measurements.sql','-- Explicit role access, with an unconditional tenant boundary');
const work=select(sources[1].sql,'-- SOURCE 20261029180000_learn_work_transition_history.sql','insert into of_test_deploy.migrations');
const baseline=JSON.parse(read('.verification-results/production-release-baseline-v1/schema.json'));
const archived=JSON.parse(read('.verification-results/production-release-baseline-v1/report.json'));
const mm=JSON.parse(read('supabase/release/learn-test/006_measurements_reviews.manifest.json'));
const tableNames=[...mm.tables.filter(n=>n!=='learn_performance_reviews'),'object_state_history','intelligence_objects'].sort();
const expected=baseline.tables.filter(t=>tableNames.includes(t.name)).sort((a,b)=>a.name.localeCompare(b.name));
if(expected.length!==17||expected.some(t=>t.owner!=='postgres'||!t.rls))throw Error('Existing objectives/work baseline differs');
const helperNames=['objectives_strategic_guard','objectives_child_guard','metric_definitions_guard','objectives_append_only'];
const helpers=baseline.functions.filter(f=>helperNames.includes(f.name)).sort((a,b)=>a.name.localeCompare(b.name));
if(helpers.length!==4)throw Error('Existing objective guard prerequisites missing');
const newFunctions=[...new Set([...(measurements+work).matchAll(/^create (?:or replace )?function public\.(\w+)\(/gm)].map(m=>m[1]))];
if(newFunctions.length!==13)throw Error('New function contract differs');
const inventory=read('scripts/verify/learn-release-schema-inventory.sql').trim().replace(/;$/,'');
const prior=JSON.parse(read('supabase/release/learn-production/002_foundation_rules.manifest.json'));
const references=mm.tenantTables.map(t=>`create trigger learn_measurement_reference_guard before insert or update on public.${t}
 for each row execute function public.learn_foundation_reference_guard();`).join('\n');
const sql=`-- DRAFT production measurements and forward work history. No hosted executor.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$ declare observed jsonb; actual_helpers jsonb; begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
  or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production measurement target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_foundation_rules_v1'
  and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then raise exception 'Pinned production rules prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_measurements_work_v1')
  or to_regclass('public.learn_performance_reviews') is not null or to_regclass('public.learn_work_measurement_runs') is not null
  or to_regclass('public.learn_work_capture_sequence') is not null
  or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${newFunctions.map(literal).join(',')}])) then
  raise exception 'Production measurement candidate already exists; inspect before retry';end if;
 select jsonb_agg(jsonb_set(t,'{triggers}',coalesce((select jsonb_agg(g order by g->>'name') from jsonb_array_elements(t->'triggers') g
   where g->>'name'<>'learn_foundation_reference_guard'),'[]')) order by t->>'name') into observed
  from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array[${tableNames.map(literal).join(',')}]);
 if observed is distinct from ${literal(JSON.stringify(expected))}::jsonb then raise exception 'Production measurement baseline catalog differs';end if;
 select jsonb_agg(f order by f->>'name') into actual_helpers from (${inventory}) q,
  lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array[${helperNames.map(literal).join(',')}]);
 if actual_helpers is distinct from ${literal(JSON.stringify(helpers))}::jsonb then raise exception 'Existing objective guard definitions differ';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.object_state_history'::regclass and tgname='learn_foundation_reference_guard')
  or not exists(select 1 from pg_trigger where tgrelid='public.intelligence_objects'::regclass and tgname='learn_foundation_reference_guard') then
  raise exception 'Foundation reference prerequisites missing';end if;
end $$;
-- Keep original objective schema, registry rows, policies, grants and guards.
${measurements}
${references}
revoke all on function public.learn_metric_scope_guard() from public,anon,authenticated,service_role;
${work}
insert into of_learn_deploy.migrations values('learn_measurements_work_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const directory='supabase/release/learn-production/003_measurements_work';
writeFileSync(directory+'.sql',sql);
writeFileSync(directory+'.manifest.json',JSON.stringify({version:'learn-production-measurements-work/1',status:'draft_requires_rehearsal_and_production_approval',
 projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),priorSha256:prior.sha256,baselineArchive:archived.archive,
 sources:sources.map(({sql,...s})=>s),existingTables:tableNames,newFunctions,
 newTables:['learn_performance_reviews','learn_work_measurement_runs'],newSequences:['learn_work_capture_sequence'],
 extendedTables:{metric_definitions:['measurement_scope'],measurements:['subject_kind','subject_id','policy_version_id','policy_id','policy_revision','metric_key','sample_count','covered_count','eligible_count','source_through','review_state','exclusions','supersedes','group_ids','request_payload','change_reason'],
 object_state_history:['work_before','work_after','transition_verb','capture_kind','capture_sequence']},
 privilegeChanges:['Existing tenant-wide objective reads and writes retain their original grants/policies.',
 'New staff-performance rows have owner/admin same-tenant read restrictions and validated adapter-only writes.',
 'Direct public/anonymous/authenticated work-history mutations and service-role truncation are revoked; existing service DML is retained.'],
 limitations:['This captures forward observations only; existing history receives no invented ownership snapshots.',
 'Later collector, calendar, corrections, authority and receipt fixes still need inclusion in the full production candidate.',
 'No hosted execution, historical scoring, real-source measurement or promotion approval.']
},null,2)+'\n');
console.log(JSON.stringify({sha256:hash(sql),newFunctions:newFunctions.length,extendedTables:3}));
