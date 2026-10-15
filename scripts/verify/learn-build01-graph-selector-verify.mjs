/** Read-only exact-result comparison of installed Graph selector and prior SQL. */
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
const mode=process.argv[2];
if(!['--test-read-only','--live-read-only'].includes(mode)||process.argv.length!==3)
 throw Error('Exact Graph selector verify mode required');
const project=mode==='--test-read-only'?TEST_PROJECT:'tgbnakbxwcqjeimygroz';
const tenant='00000000-0000-0000-0000-000000000001';
const query=`begin read only;set local statement_timeout='30s';
 with prior as (
  select i.id from public.interactions i
  join public.tenants t on t.id=i.tenant_id and t.status='active'
  where i.tenant_id='${tenant}'::uuid and i.processing_status in('ready','enriched')
   and not exists(select 1 from public.graph_nodes n where n.tenant_id=i.tenant_id
    and n.node_type='interaction' and n.source_table='interactions' and n.source_id=i.id)
  order by i.occurred_at,i.id limit 200
 ), installed as (
  select id from public.learn_graph_missing_interactions('${tenant}'::uuid,200)
 ) select (select count(*)::int from prior) prior_count,
  (select count(*)::int from installed) installed_count,
  (select array_agg(id order by id) from prior) is not distinct from
   (select array_agg(id order by id) from installed) exact_id_set,
  (select md5(pg_get_functiondef('public.learn_graph_missing_interactions(uuid,integer)'::regprocedure))) installed_digest;
 commit;`;
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{
 method:'POST',headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
 body:JSON.stringify({query}),redirect:'error',signal:AbortSignal.timeout(90000)});
if(response.status!==201)throw Error(`Graph selector verify failed (HTTP ${response.status})`);
const rows=await response.json();
if(!Array.isArray(rows)||rows.length!==1||rows[0]?.exact_id_set!==true||
 rows[0].installed_count!==rows[0].prior_count||rows[0].installed_count>200||
 rows[0].installed_digest!=='2c6d16eb311d2caff7517284729ababb')
 throw Error('Graph selector exact result or installed digest differs');
console.log(JSON.stringify({environment:mode==='--test-read-only'?'TEST':'LIVE',
 observedAt:new Date().toISOString(),...rows[0],productionDataWrites:false}));
