/** Aggregate-only size of the next ten older Email candidates; no IDs/content. */
import { savedCliToken } from './learn-test-readiness.mjs';
if(process.argv.slice(2).join(' ')!=='--live-read-only')
  throw Error('Exact LIVE read-only mode required');
const project='tgbnakbxwcqjeimygroz';
const tenant='00000000-0000-0000-0000-000000000001';
const query=`with selected as materialized (
 select m.id from public.email_messages m left join public.interactions i
  on i.tenant_id=m.tenant_id and i.source_table='email_messages' and i.source_id=m.id
 where m.tenant_id='${tenant}'::uuid and m.created_at>=clock_timestamp()-interval '30 days'
  and i.id is null and not coalesce(m.provider='gmail' and
   m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
 order by m.created_at desc,m.id desc limit 10
)
select count(*)::int candidates,
 min(pg_column_size(m))::int min_row_bytes,
 max(pg_column_size(m))::int max_row_bytes,
 max(pg_column_size(m.raw_payload))::int max_payload_bytes,
 max(length(m.subject))::int max_subject_chars,
 max(length(m.snippet))::int max_snippet_chars,
 count(*) filter(where m.origin_campaign_id is not null)::int campaign_rows
from selected s join public.email_messages m on m.id=s.id and m.tenant_id='${tenant}'::uuid`;
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
  headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
  body:JSON.stringify({query})});
if(!response.ok) throw Error(`First unlinked shape HTTP ${response.status}`);
const rows=await response.json();
if(!Array.isArray(rows)||rows.length!==1||!Number.isInteger(rows[0]?.candidates))
  throw Error('First unlinked shape changed');
console.log(JSON.stringify({observedAt:new Date().toISOString(),...rows[0],
  sourceIdsReturned:false,productionDataWrites:false}));
