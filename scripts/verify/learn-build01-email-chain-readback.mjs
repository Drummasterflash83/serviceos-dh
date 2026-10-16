/** Bounded, content-free LIVE readback of older Email ordinary continuation. */
import { savedCliToken } from './learn-test-readiness.mjs';
if(process.argv.slice(2).join(' ')!=='--live-read-only')
  throw Error('Exact LIVE read-only mode required');
const project='tgbnakbxwcqjeimygroz';
const tenant='00000000-0000-0000-0000-000000000001';
const query=`select j.created_at,j.updated_at,j.status,j.error_code,
 j.attempt_count,j.payload->>'limit' batch_limit,j.records_processed,
 coalesce((j.result->>'email_selected')::int,0) email_selected,
 coalesce((j.result->>'email_processed')::int,0) email_processed,
 coalesce((j.result->>'review_required')::int,0) review_required,
 coalesce((j.result->>'failed')::int,0) source_failures,
 coalesce((j.result->>'continued')::boolean,false) continued,
 exists(select 1 from public.platform_jobs c where c.tenant_id=j.tenant_id
  and c.parent_job_id=j.id) has_child,
 (select count(*)::int from public.learn_processing_publications p
  where p.tenant_id=j.tenant_id and p.job_id=j.id
   and p.source_kind='email' and p.receipt->>'state'='committed') committed_publications
from public.platform_jobs j where j.tenant_id='${tenant}'::uuid
 and j.job_type='interactions.sync' and j.payload->>'source'='email'
 and j.payload->>'lane' is null
 and j.created_at>='2026-10-16T19:45:00Z'::timestamptz
order by j.created_at asc limit 25`;
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
  headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
  body:JSON.stringify({query})});
if(!response.ok) throw Error(`Email continuation readback HTTP ${response.status}`);
const rows=await response.json();
if(!Array.isArray(rows)||rows.length>25||rows.some(row=>
  !Number.isInteger(row.attempt_count)||!Number.isInteger(row.committed_publications)||
  typeof row.has_child!=='boolean'||typeof row.continued!=='boolean'))
  throw Error('Email continuation shape changed');
console.log(JSON.stringify({observedAt:new Date().toISOString(),project,rows,
  messageContentReturned:false,productionDataWrites:false}));
