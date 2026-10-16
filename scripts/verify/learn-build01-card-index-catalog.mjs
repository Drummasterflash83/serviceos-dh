/** Read-only index inventory for card interaction/draft-filtering plans. */
import { savedCliToken } from './learn-test-readiness.mjs';
if(process.argv.slice(2).join(' ')!=='--live-read-only'||
 process.env.LEARN_LIVE_ALLOW_PROJECT_REF!=='tgbnakbxwcqjeimygroz')
 throw Error('Exact LIVE read-only mode required');
const project='tgbnakbxwcqjeimygroz';
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`,{
 method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
 headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
 body:JSON.stringify({query:`select tablename,indexname,indexdef from pg_indexes
  where schemaname='public' and tablename in ('email_messages','interactions')
  order by tablename,indexname`})});
if(!response.ok)throw Error(`Index catalog HTTP ${response.status}`);
const rows=await response.json();
if(!Array.isArray(rows)||rows.length>100||rows.some(r=>
 !['email_messages','interactions'].includes(r.tablename)||
 typeof r.indexname!=='string'||typeof r.indexdef!=='string'))
 throw Error('Index catalog invalid');
console.log(JSON.stringify({project,rows,sourceContentReturned:false,productionWrites:false}));
