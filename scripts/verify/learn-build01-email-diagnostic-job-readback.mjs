/** Exact-job, content-free LIVE readback of the manual Email diagnostic retry. */
import { readFileSync } from 'node:fs';
import { savedCliToken } from './learn-test-readiness.mjs';
if (process.argv.slice(2).join(' ') !== '--live-read-only')
  throw Error('Exact LIVE read-only mode required');
const record=JSON.parse(readFileSync(
  '.verification-results/build01-email-inventory-diagnostic-advance-result.json','utf8'));
const project='tgbnakbxwcqjeimygroz';
if (record.project!==project || !/^[a-f0-9-]{36}$/i.test(record.id))
  throw Error('Exact diagnostic journal changed');
const query=`select status,error_code,attempt_count,max_attempts,
  created_at,updated_at,available_at,lease_expires_at,records_processed,
  coalesce((result->>'email_selected')::int,0) email_selected,
  coalesce((result->>'email_processed')::int,0) email_processed,
  coalesce((result->>'reviews_recorded')::int,0) reviews_recorded,
  coalesce((result->>'review_required')::int,0) review_required,
  coalesce((result->>'failed')::int,0) failed,
  (select count(*)::int from public.learn_processing_publications p
    where p.job_id=j.id) publication_receipts,
  (select count(*)::int from public.learn_processing_settlements s
    where s.job_id=j.id) settlement_receipts
  from public.platform_jobs j where j.id='${record.id}'::uuid
    and j.tenant_id='${record.tenant}'::uuid`;
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
  headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
  body:JSON.stringify({query})});
if(!response.ok) throw Error(`Email exact job readback HTTP ${response.status}`);
const rows=await response.json();
if(!Array.isArray(rows)||rows.length!==1||!rows[0]||
  !Number.isInteger(rows[0].attempt_count)||!Number.isInteger(rows[0].publication_receipts))
  throw Error('Email exact job readback shape changed');
console.log(JSON.stringify({observedAt:new Date().toISOString(),project,
  ...rows[0],sourceIdsReturned:false,productionDataWrites:false}));
