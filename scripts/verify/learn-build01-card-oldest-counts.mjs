/** Counts-only source volume for oldest currently sweepable LIVE card. */
import { savedCliToken } from './learn-test-readiness.mjs';
if(process.argv.slice(2).join(' ')!=='--live-read-only'||
 process.env.LEARN_LIVE_ALLOW_PROJECT_REF!=='tgbnakbxwcqjeimygroz')
 throw Error('Exact LIVE read-only mode required');
const project='tgbnakbxwcqjeimygroz',tenant='00000000-0000-0000-0000-000000000001';
const query=`with c as (select id,person_id,company_id,updated_at
 from public.customer_cards where tenant_id='${tenant}'::uuid and status<>'archived'
 order by updated_at,id limit 1)
select (select count(*)::int from public.interactions i where i.tenant_id='${tenant}'::uuid
 and i.related_person_id=c.person_id) person_interactions,
 (select count(*)::int from public.interactions i where i.tenant_id='${tenant}'::uuid
 and i.related_company_id=c.company_id) company_interactions,
 (select count(*)::int from public.recommendations r where r.tenant_id='${tenant}'::uuid
 and r.card_id=c.id and r.status='open') open_recommendations,
 c.person_id is not null has_person,c.company_id is not null has_company,
 c.updated_at oldest_updated_at from c`;
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`,{
 method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
 headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
 body:JSON.stringify({query})});
if(!response.ok)throw Error(`LIVE oldest card counts HTTP ${response.status}`);
const rows=await response.json();
if(!Array.isArray(rows)||rows.length!==1||
 ['person_interactions','company_interactions','open_recommendations'].some(k=>
  !Number.isInteger(rows[0][k])||rows[0][k]<0))throw Error('Oldest card counts invalid');
console.log(JSON.stringify({observedAt:new Date().toISOString(),...rows[0],cardIdReturned:false,
 contentReturned:false,productionWrites:false}));
