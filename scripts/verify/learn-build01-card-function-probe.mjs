/** Counts-only hosted card-input function probe, no source content or IDs. */
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
const mode=process.argv.slice(2).join(' ');
const project=mode==='--test-read-only'?TEST_PROJECT:
 ['--live-oldest-read-only','--live-heavy-read-only'].includes(mode)?'tgbnakbxwcqjeimygroz':null;
if(!project||(project===TEST_PROJECT?process.env.LEARN_TEST_ALLOW_PROJECT_REF:
 process.env.LEARN_LIVE_ALLOW_PROJECT_REF)!==project)
 throw Error('Exact project read-only mode required');
const target=mode==='--live-heavy-read-only'?`heavy_company as (
 select related_company_id from public.interactions
 where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
  and related_company_id is not null
 group by related_company_id having count(*)>50000
 order by count(*) desc limit 1),
 target as (select c.tenant_id,c.id from public.customer_cards c
 join heavy_company h on h.related_company_id=c.company_id
 where c.tenant_id='00000000-0000-0000-0000-000000000001'::uuid
  and c.status<>'archived' order by c.updated_at desc,c.id limit 1)`:
 mode==='--test-read-only'?`target as (select c.tenant_id,c.id from public.customer_cards c
 join public.tenants t on t.id=c.tenant_id and t.status='active'
 order by c.updated_at desc,c.id limit 1)`:
 `target as (select c.tenant_id,c.id from public.customer_cards c
 where c.tenant_id='00000000-0000-0000-0000-000000000001'::uuid
  and c.status<>'archived' order by c.updated_at,c.id limit 1)`;
const query=`with ${target},
 answer as (select public.learn_card_projection_inputs(t.tenant_id,t.id) value from target t)
 select value->>'version' version,jsonb_array_length(value->'interactions') interaction_window,
 jsonb_array_length(value->'recommendations') recommendation_window,
 (value#>>'{coverage,eligibleInteractions}')::int eligible_interactions,
 (value#>>'{coverage,excludedDraftInteractions}')::int excluded_drafts,
 (value#>>'{coverage,interactionsLast7}')::int last7,
 (value#>>'{coverage,eligibleRecommendations}')::int eligible_recommendations,
 (value#>>'{coverage,urgentRecommendations}')::int urgent_recommendations
 from answer`;
const started=Date.now();
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{
 method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
 headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
 body:JSON.stringify({query:`begin read only; set local statement_timeout='25s'; ${query}; rollback;`,read_only:false})});
if(!response.ok){const detail=await response.json().catch(()=>({}));
 throw Error(`Card function probe HTTP ${response.status} (${typeof detail.code==='string'?detail.code:'unknown'})`);}
const rows=await response.json();
if(!Array.isArray(rows)||rows.length!==1||rows[0]?.version!=='learn-card-inputs/1'||
 ['interaction_window','recommendation_window','eligible_interactions','excluded_drafts',
  'last7','eligible_recommendations','urgent_recommendations'].some(k=>
  !Number.isInteger(rows[0][k])||rows[0][k]<0))throw Error('Card function probe shape changed');
console.log(JSON.stringify({observedAt:new Date().toISOString(),project,
 elapsedMs:Date.now()-started,...rows[0],cardIdsReturned:false,
 sourceContentReturned:false,productionWrites:false}));
