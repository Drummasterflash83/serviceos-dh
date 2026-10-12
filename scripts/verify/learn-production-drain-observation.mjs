/** Aggregate read-only release observation. Never declares a system drained.
 * Queue emptiness cannot prove that detached HTTP work/manual callers stopped.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { savedCliToken } from './learn-test-readiness.mjs';
const project = 'tgbnakbxwcqjeimygroz', output = process.argv[2];
if (process.env.LEARN_PRODUCTION_READ_ONLY_PROJECT !== project ||
    !/^\.verification-results\/[a-z0-9-]+\.json$/.test(output ?? ''))
  throw Error('Explicit production read-only target and private report required');
const candidate = JSON.parse(readFileSync('supabase/release/learn-production/runtime-candidate.manifest.json'));
const schedules = JSON.parse(readFileSync('supabase/release/learn-production/scheduled-callers.manifest.json')).schedules;
if (candidate.projectRef !== project || candidate.endpoints.length !== 37 || schedules.length !== 9 ||
    candidate.endpoints.some(e => !/^[a-z0-9-]+$/.test(e.name)) || schedules.some(s => !Number.isSafeInteger(s.jobid)))
  throw Error('Unexpected release scope');
const urls = candidate.endpoints.map(e => `'https://${project}.supabase.co/functions/v1/${e.name}'`).join(',');
const ids = schedules.map(s => s.jobid).join(',');
const query = `begin transaction read only;
set local statement_timeout='30s';
select jsonb_build_object(
 'observedAt',clock_timestamp(),
 'schedules',(select jsonb_agg(jsonb_build_object('id',jobid,'name',jobname,'active',active,
   'schedule',schedule,'commandHash',md5(command)) order by jobid) from cron.job where jobid in (${ids})),
 'cronExecutions',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (
   select jobid,status,count(*) count,min(start_time) oldest,max(start_time) newest
   from cron.job_run_details where jobid in (${ids}) and end_time is null
   group by jobid,status order by jobid,status) r),
 'platform',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (
   select status,count(*) count,count(*) filter(where lease_expires_at>now()) future_leases,
    count(*) filter(where lease_expires_at<=now()) expired_leases,
    min(updated_at) oldest_update,max(updated_at) newest_update
   from public.platform_jobs where status in ('running','queued','pending','retrying')
   group by status order by status) r),
 'phoneUnfinished',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (
   select status,count(*) count,min(started_at) oldest,max(started_at) newest
   from public.phone_sync_runs where completed_at is null group by status order by status) r),
 'emailUnfinished',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (
   select status,count(*) count,min(started_at) oldest,max(started_at) newest
   from public.email_sync_runs where completed_at is null group by status order by status) r),
 'networkQueue',(select jsonb_build_object('allPending',count(*),
   'candidatePending',count(*) filter(where split_part(url,'?',1) in (${urls})),
   'maxTimeoutMilliseconds',max(timeout_milliseconds)) from net.http_request_queue),
 'recentNetworkResponses',(select jsonb_build_object('lastTenMinutes',count(*),
   'timeouts',count(*) filter(where timed_out),'errors',count(*) filter(where error_msg is not null))
   from net._http_response where created>now()-interval '10 minutes')
) observation; commit;`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
  headers:{Authorization:'Bearer '+savedCliToken(),'Content-Type':'application/json'},body:JSON.stringify({query}),
});
if (!response.ok) {
  const error = await response.json().catch(()=>({}));
  writeFileSync(output+'.error',JSON.stringify({status:response.status,error}),{mode:0o600,flag:'wx'});
  throw Error('Read-only drain observation HTTP '+response.status);
}
const rows = await response.json();
if (rows.length !== 1 || !rows[0].observation?.observedAt) throw Error('Incomplete observation');
const report = {version:'learn-production-drain-observation/1',project,
  state:'observation_not_drain_acceptance',...rows[0].observation,
  productionChanges:0,providerRequests:0,inFlightWorkVerifiedStopped:false,
  limitations:[
    'Schedules remain active. This aggregate observation does not authorise or perform a pause.',
    'Unfinished run rows may be historical or stale; they must not be deleted or treated as proof of live execution.',
    'pg_net removes requests from its queue before HTTP completion. Queue zero and cron completion do not prove downstream or detached workers stopped.',
    'External/manual callers and active runtime requests need separate coordination before the release.',
  ]};
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify(report));
