/** Read-only, counts-only candidate for large-card draft filtering. */
import { savedCliToken } from './learn-test-readiness.mjs';
if(process.argv.slice(2).join(' ')!=='--live-read-only'||
 process.env.LEARN_LIVE_ALLOW_PROJECT_REF!=='tgbnakbxwcqjeimygroz')
 throw Error('Exact LIVE read-only mode required');
const project='tgbnakbxwcqjeimygroz',tenant='00000000-0000-0000-0000-000000000001';
const query=`with c as (select id,person_id,company_id from public.customer_cards
 where tenant_id='${tenant}'::uuid and status<>'archived'
 order by updated_at,id limit 1),
 drafts as materialized (select id from public.email_messages
  where tenant_id='${tenant}'::uuid and provider='gmail'
  and raw_payload->'label_ids' @> '["DRAFT"]'::jsonb),
 associated as materialized (select i.id,i.occurred_at,
  (i.source_table='email_messages' and d.id is not null) draft
  from c join public.interactions i on i.tenant_id='${tenant}'::uuid
   and (i.related_person_id=c.person_id or i.related_company_id=c.company_id)
  left join drafts d on i.source_table='email_messages' and d.id=i.source_id
  where coalesce(i.status,'') not in ('deleted','removed'))
select count(*)::int associated,
 count(*) filter(where draft)::int excluded_drafts,
 count(*) filter(where not draft)::int eligible,
 count(*) filter(where not draft and occurred_at>=statement_timestamp()-interval '7 days'
   and occurred_at<=statement_timestamp())::int last7
 from associated`;
const started=Date.now();
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{
 method:'POST',redirect:'error',signal:AbortSignal.timeout(35000),
 headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
 body:JSON.stringify({query:`begin read only; set local statement_timeout='30s'; ${query}; rollback;`,read_only:false})});
if(!response.ok){
 const detail=await response.json().catch(()=>({}));
 throw Error(`Candidate card count HTTP ${response.status} code ${typeof detail.code==='string'?detail.code:'unknown'}`);
}
const rows=await response.json();
if(!Array.isArray(rows)||rows.length!==1||
 ['associated','excluded_drafts','eligible','last7'].some(k=>
  !Number.isInteger(rows[0][k])||rows[0][k]<0))throw Error('Candidate shape invalid');
console.log(JSON.stringify({observedAt:new Date().toISOString(),elapsedMs:Date.now()-started,
 ...rows[0],cardIdReturned:false,contentReturned:false,productionWrites:false}));
