/** Read only bounded metadata of the exact Email selector in TEST or LIVE. */
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
const mode=process.argv.slice(2).join(' ');
const project=mode==='--test-read-only'?TEST_PROJECT:
  mode==='--live-read-only'?'tgbnakbxwcqjeimygroz':null;
if(!project) throw Error('Exact TEST/LIVE read-only mode required');
const query=`select md5(pg_get_functiondef(p.oid)) digest,
 pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.proconfig::text settings,
 position('and m.created_at>=clock_timestamp()-interval ''30 days''' in pg_get_functiondef(p.oid))>0 recent_30_day,
 position('order by m.created_at desc,m.id desc' in pg_get_functiondef(p.oid))>0 recent_order,
 position('limit least(2000,greatest(200,bound+100))' in pg_get_functiondef(p.oid))>0 window_200,
 position('limit least(2000,greatest(32,bound+22))' in pg_get_functiondef(p.oid))>0 window_32,
 position('return query select * from public.learn_projection_pending_full(p_tenant,p_source,bound);' in pg_get_functiondef(p.oid))>0 full_fallback
 from pg_proc p where p.oid='public.learn_projection_pending(uuid,text,integer)'::regprocedure`;
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`,{
 method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
 headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
 body:JSON.stringify({query})});
if(!response.ok) throw Error(`Selector catalog HTTP ${response.status}`);
const rows=await response.json();
if(!Array.isArray(rows)||rows.length!==1||!rows[0]?.digest)
 throw Error('Selector catalog shape changed');
console.log(JSON.stringify({project,...rows[0],productionDataWrites:false}));
