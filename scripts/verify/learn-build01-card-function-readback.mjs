/** Preserve current LIVE card-input function source for exact, guarded repair. */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const mode=process.argv.slice(2).join(' ');
const project=mode==='--test-read-only'?TEST_PROJECT:
  mode==='--live-read-only'?'tgbnakbxwcqjeimygroz':null;
if(!project||(project===TEST_PROJECT?process.env.LEARN_TEST_ALLOW_PROJECT_REF:
  process.env.LEARN_LIVE_ALLOW_PROJECT_REF)!==project)
  throw Error('Exact project read-only mode required');
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
  headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
  body:JSON.stringify({query:`select pg_get_functiondef(p.oid) definition,
    r.rolname owner,p.prosecdef security_definer,p.proconfig settings,
    has_function_privilege('service_role',p.oid,'EXECUTE') service_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    join pg_roles r on r.oid=p.proowner
    where n.nspname='public' and p.proname='learn_card_projection_inputs'
    and pg_get_function_identity_arguments(p.oid)='p_tenant uuid, p_card uuid'`}),
});
if(!response.ok)throw Error(`LIVE function readback HTTP ${response.status}`);
const rows=await response.json();
if(!Array.isArray(rows)||rows.length!==1||typeof rows[0]?.definition!=='string'||
  rows[0].security_definer!==true||rows[0].service_execute!==true||
  rows[0].authenticated_execute!==false)throw Error('LIVE card function baseline changed');
const path=`.verification-results/build01-card-inputs-${project===TEST_PROJECT?'test':'live'}-source.sql`;
writeFileSync(path,rows[0].definition,{flag:'w',mode:0o600});
console.log(JSON.stringify({project,sourceSha256:createHash('sha256').update(rows[0].definition).digest('hex'),
  owner:rows[0].owner,settings:rows[0].settings,serviceExecute:rows[0].service_execute,
  authenticatedExecute:rows[0].authenticated_execute,privatePath:path,
  productionWrites:false}));
