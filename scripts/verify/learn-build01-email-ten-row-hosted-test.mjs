/** Rollback-only TEST proof of the existing older Email selector at ten rows. */
import { randomUUID } from 'node:crypto';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
if(process.argv.slice(2).join(' ')!=='--test-rollback'||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)
  throw Error('Exact rollback-only TEST mode required');
const tenant=randomUUID();
const values=Array.from({length:11},(_,n)=>{
  const id=randomUUID();
  const draft=n===10;
  return `('${id}'::uuid,'${tenant}'::uuid,'gmail','synthetic-old-${id}',
    now()-interval '2 days',now(),'customer@example.invalid','[]',
    'Synthetic old message','Synthetic only','inbound',
    '${draft?'{"label_ids":["DRAFT"]}':'{}'}')`;
}).join(',\n');
const query=`begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
insert into public.tenants(id,slug,display_name)
  values('${tenant}'::uuid,'build01-ten-${tenant.slice(0,8)}','Synthetic older Email');
insert into public.email_messages(id,tenant_id,provider,provider_message_id,
  received_at,created_at,from_email,to_emails,subject,snippet,direction,raw_payload)
values ${values};
set local role service_role;
select count(*)::int selected,
  count(*) filter(where source_kind='email' and length(source_revision)=64)::int valid
from public.learn_projection_pending('${tenant}'::uuid,'email',10);
rollback;`;
const response=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
  headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
  body:JSON.stringify({query})});
if(!response.ok) throw Error(`TEST older Email selector HTTP ${response.status}`);
const rows=await response.json();
if(!Array.isArray(rows)||rows.length!==1||rows[0]?.selected!==10||rows[0]?.valid!==10)
  throw Error('TEST older Email selector result changed');
console.log(JSON.stringify({state:'hosted_test_rolled_back',project:TEST_PROJECT,
  tenSelected:true,draftExcluded:true,validRevisions:true,
  syntheticRowsPersisted:false,providerRequests:0,customerContentReturned:false}));
