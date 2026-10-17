/** Content-free proof of the first ordinary 50-request LIVE identity chain. */
import { savedCliToken } from './learn-test-readiness.mjs';
if(process.argv.slice(2).join(' ')!=='--live-read-only')
  throw Error('Exact LIVE read-only mode required');
const project='tgbnakbxwcqjeimygroz';
const tenant='00000000-0000-0000-0000-000000000001';
const created='2026-10-17 15:10:05.51224+00';
const query=`select j.status,j.error_code,j.attempt_count,j.records_processed,
  coalesce((j.result->>'resolved')::int,0) resolved,
  coalesce((j.result->>'reviews_recorded')::int,0) reviews_recorded,
  coalesce((j.result->>'failed')::int,0) failed,
  coalesce((j.payload->>'limit')::int,0) requested_limit,
  j.dead_lettered_at,j.updated_at,
  (select count(*)::int from public.platform_jobs c where c.tenant_id=j.tenant_id
    and c.parent_job_id=j.id and c.job_type='identity.resolve') continuations,
  (select max((c.payload->>'limit')::int) from public.platform_jobs c
    where c.tenant_id=j.tenant_id and c.parent_job_id=j.id
      and c.job_type='identity.resolve') child_requested_limit,
  (select min(c.priority)::int from public.platform_jobs c
    where c.tenant_id=j.tenant_id and c.parent_job_id=j.id
      and c.job_type='identity.resolve') child_priority,
  (select count(*)::int from public.learn_processing_publications p
    where p.tenant_id=j.tenant_id and p.job_id=j.id and p.attempt=1)
    immutable_publications
  from public.platform_jobs j where j.tenant_id='${tenant}'::uuid
    and j.job_type='identity.resolve' and j.created_at='${created}'::timestamptz`;
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`,{
  method:'POST',headers:{Authorization:`Bearer ${savedCliToken()}`,
    'Content-Type':'application/json'},body:JSON.stringify({query}),
  redirect:'error',signal:AbortSignal.timeout(45000)});
if(!response.ok)throw Error(`Ordinary 50 identity readback HTTP ${response.status}`);
const rows=await response.json();
if(!Array.isArray(rows)||rows.length!==1||
  !Number.isSafeInteger(rows[0].immutable_publications)||
  !Number.isSafeInteger(rows[0].continuations))
  throw Error('Ordinary 50 identity readback changed');
console.log(JSON.stringify({observedAt:new Date().toISOString(),project,tenant,
  jobCreatedAt:created,...rows[0],sourceContentReturned:false,
  identityReturned:false,productionDataWrites:false}));
