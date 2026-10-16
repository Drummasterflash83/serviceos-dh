/** Read-only timeout settings relevant to the LIVE PostgREST service role. */
import { savedCliToken } from './learn-test-readiness.mjs';
if(process.argv.slice(2).join(' ')!=='--live-read-only')
  throw Error('Exact LIVE read-only timeout mode required');
const project='tgbnakbxwcqjeimygroz';
const query=`select r.rolname,
  (select x from unnest(coalesce(r.rolconfig,array[]::text[])) x
    where x like 'statement_timeout=%' limit 1) role_timeout,
  (select x from pg_db_role_setting s,
    unnest(s.setconfig) x where s.setrole=r.oid and
    s.setdatabase in(0,(select oid from pg_database where datname=current_database()))
    and x like 'statement_timeout=%' order by s.setdatabase desc limit 1) database_role_timeout
from pg_roles r where r.rolname in('service_role','authenticator','postgres')
order by r.rolname`;
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
  headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
  body:JSON.stringify({query})});
if(!response.ok) throw Error(`LIVE role timeout readback HTTP ${response.status}`);
const rows=await response.json();
if(!Array.isArray(rows)||rows.length>3||rows.some(r=>
  !['service_role','authenticator','postgres'].includes(r.rolname)||
  [r.role_timeout,r.database_role_timeout].some(v=>v!==null&&
    !/^statement_timeout=[0-9]+(ms|s|min)?$/.test(v))))
  throw Error('LIVE role timeout shape changed');
console.log(JSON.stringify({project,rows,productionDataWrites:false}));
