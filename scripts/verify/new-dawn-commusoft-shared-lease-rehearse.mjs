/** Rollback-only TEST application of the exact lease migration. No provider GET,
 * credentials, flags, queue mutation or retained TEST change. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

if (process.argv.slice(2).join(' ') !== '--test-rollback-only')
  throw Error('Exact TEST rollback-only mode required');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const source=readFileSync(resolve(root,'supabase/migrations/20261106140000_new_dawn_commusoft_shared_lease.sql'),'utf8');
if (!/\nbegin;\n/i.test(source) || !/\ncommit;\s*$/i.test(source)) throw Error('Migration transaction fence changed');
const sql=source.replace(/\ncommit;\s*$/i,`
select set_config('request.jwt.claim.role','service_role',true);
select public.learn_commusoft_shared_lease_acquire(repeat('f',64),'source_page',
 'ffffffff-ffff-4fff-8fff-ffffffffffff:1')->>'state' as lease_state;
rollback;`);
const token=savedCliToken();
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
const endpoint=`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`;
const result=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
 headers,body:JSON.stringify({query:sql,read_only:false})});
if(!result.ok)throw Error(`TEST lease rollback HTTP ${result.status}: ${(await result.text()).slice(0,600)}`);
const rows=await result.json();
if(!Array.isArray(rows)||rows.at(-1)?.lease_state!=='ready')throw Error('TEST lease claim marker missing');
const after=await fetch(endpoint+'/read-only',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
 headers,body:JSON.stringify({query:`select not exists(select 1 from information_schema.columns
 where table_schema='public' and table_name='learn_business_input_request_gates'
 and column_name='lease_owner_id') as absent`})});
if(!after.ok||(await after.json())[0]?.absent!==true)throw Error('TEST lease rehearsal did not roll back');
console.log(JSON.stringify({state:'passed_rolled_back',project:TEST_PROJECT,providerRequests:0}));
