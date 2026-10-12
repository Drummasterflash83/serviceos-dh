/** Generate a bounded release pause/restoration transaction. No hosted access.
 * The separate approved release runner must retain intent before submitting SQL.
 * Successful pause is not proof of drained HTTP requests or stopped manual calls.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const PROJECT = 'tgbnakbxwcqjeimygroz';
const IDS = [35, 36, 37, 38, 39, 40, 41, 42, 44];
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
export function scheduleTransition(baseline, mode, manifestSha256) {
  const rows = baseline.schedules;
  if (!['pause', 'restore'].includes(mode) || !/^[a-f0-9]{64}$/.test(manifestSha256) ||
      !Array.isArray(rows) || JSON.stringify(rows.map(r => r.jobid).sort((a,b) => a-b)) !== JSON.stringify(IDS) ||
      rows.some(r => typeof r.active !== 'boolean' || !/^[a-f0-9]{32}$/.test(r.command_hash) ||
        typeof r.jobname !== 'string' || typeof r.schedule !== 'string'))
    throw Error('Exact reviewed schedule baseline, mode and runtime pin required');
  const values = rows.map(r => `(${r.jobid},${q(r.jobname)},${q(r.schedule)},${q(r.command_hash)},${r.active})`).join(',\n');
  return `-- PREPARED ONLY. Requires the separate concrete production-release approval.
-- Restore returns original active states; it does not prove runtime compatibility.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$ begin
 if current_user <> 'postgres'
   or current_setting('serviceos.release_project',true) is distinct from '${PROJECT}'
   or current_setting('serviceos.release_manifest_sha256',true) is distinct from '${manifestSha256}'
   or current_setting('serviceos.release_schedule_action',true) is distinct from '${mode}' then
   raise exception 'Reviewed production release schedule target and action required';
 end if;
end $guard$;
select pg_advisory_xact_lock(hashtextextended('openfolk:learn-production-release',0));
-- The production postgres role can use cron.alter_job but cannot update or lock
-- cron.job directly. Its existing API holds the affected row locks to commit.
-- This advisory lock coordinates release runners; it does not fence other callers.
create temporary table release_expected_schedule(
 jobid bigint primary key,jobname text,schedule text,command_hash text,original_active boolean
) on commit drop;
insert into release_expected_schedule values
${values};
create temporary table release_prior_schedule on commit drop as select to_jsonb(j) row from cron.job j;
do $transition$ declare r record; begin
 if (select count(*) from cron.job j join release_expected_schedule e using(jobid)) <> 9
   or exists(select 1 from cron.job j join release_expected_schedule e using(jobid)
      where j.jobname is distinct from e.jobname or j.schedule is distinct from e.schedule
        or md5(j.command) is distinct from e.command_hash
        or j.active is distinct from ${mode === 'pause' ? 'e.original_active' : 'false'}) then
   raise exception 'Schedule baseline or active state differs; inspect before retry';
 end if;
 for r in select * from release_expected_schedule order by jobid loop
   perform cron.alter_job(r.jobid,active := ${mode === 'pause' ? 'false' : 'r.original_active'});
 end loop;
 -- Compare every column of every unrelated row and every non-active field of
 -- targeted rows. Commands never leave the database in the returned receipt.
 if exists(
   select 1 from release_prior_schedule p full join cron.job j
     on (p.row->>'jobid')::bigint=j.jobid
   left join release_expected_schedule e on e.jobid=j.jobid
   where p.row is null or j.jobid is null
     or case when e.jobid is null then p.row is distinct from to_jsonb(j)
       else (p.row-'active') is distinct from (to_jsonb(j)-'active')
         or j.active is distinct from ${mode === 'pause' ? 'false' : 'e.original_active'} end
 ) then raise exception 'Unexpected scheduler change; transaction rolled back'; end if;
end $transition$;
select jsonb_build_object('project','${PROJECT}','mode','${mode}',
 'manifestSha256','${manifestSha256}','observedAt',clock_timestamp(),
 'schedules',(select jsonb_agg(jsonb_build_object('jobId',j.jobid,'active',j.active,
    'commandHash',md5(j.command)) order by j.jobid)
   from cron.job j join release_expected_schedule e using(jobid)),
 'inFlightWorkVerifiedStopped',false) as schedule_transition;
commit;
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw Error('Offline generator accepts no arguments');
  const baselinePath = 'supabase/release/learn-production/scheduled-callers.manifest.json';
  const runtimePath = 'supabase/release/learn-production/runtime-candidate.manifest.json';
  const digest = b => createHash('sha256').update(b).digest('hex');
  const baseline = readFileSync(baselinePath), runtime = readFileSync(runtimePath);
  if (JSON.parse(runtime).projectRef !== PROJECT) throw Error('Wrong runtime target');
  const outputs = [];
  for (const mode of ['pause', 'restore']) {
    const path = `supabase/release/learn-production/schedules-${mode}.sql`;
    const sql = scheduleTransition(JSON.parse(baseline), mode, digest(runtime));
    writeFileSync(path, sql);
    outputs.push({mode,path,sha256:digest(sql)});
  }
  writeFileSync('supabase/release/learn-production/schedule-transition.manifest.json',JSON.stringify({
    version:'learn-production-schedule-transition/1',projectRef:PROJECT,state:'prepared_not_approved_or_executed',
    baseline:{path:baselinePath,sha256:digest(baseline)},runtime:{path:runtimePath,sha256:digest(runtime)},outputs,
    limitations:['Does not stop manual/external calls or prove existing work has drained.',
      'Requires separately reviewed release approval, durable intent/readback journal and compatibility decision before restoring schedules.',
      'A timeout or lost response is an unknown outcome: inspect current state before any retry.'],
  },null,2)+'\n');
  console.log(JSON.stringify({state:'prepared_not_executed',schedules:9,outputs:outputs.length}));
}
