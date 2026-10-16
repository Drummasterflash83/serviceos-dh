/** Guarded partial DRAFT lookup index for counts-preserving card inputs. */
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const mode=process.argv.slice(2).join(' ');
const project=mode==='--test'?TEST_PROJECT:mode==='--live'?'tgbnakbxwcqjeimygroz':null;
if(!project||(project===TEST_PROJECT?process.env.LEARN_TEST_ALLOW_PROJECT_REF:
 process.env.LEARN_LIVE_ALLOW_PROJECT_REF)!==project)
 throw Error('Exact TEST or LIVE project allowlist required');
const token=savedCliToken(),headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
async function sql(query,readOnly){
 const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly?'/read-only':''}`,{
  method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(120000),
  body:JSON.stringify({query,...(readOnly?{}:{read_only:false})})});
 if(!response.ok){const detail=await response.json().catch(()=>({}));
  throw Error(`Card DRAFT index query HTTP ${response.status} (${typeof detail.code==='string'?detail.code:'unknown'})`);}
 return response.json();
}
const catalog=`select c.relname index_name,i.indisvalid valid,i.indisready ready,
  pg_get_indexdef(i.indexrelid) definition
 from pg_index i join pg_class c on c.oid=i.indexrelid
 join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='learn_card_email_draft_idx'`;
const before=await sql(catalog,true);
if(!Array.isArray(before)||before.length!==0)throw Error('Index name already exists; inspect before changing');
if(project!==TEST_PROJECT){
 const t=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,{
  method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(30000),
  body:JSON.stringify({query:catalog})});
 if(!t.ok)throw Error('TEST index preflight unavailable');
 const rows=await t.json();
 if(rows.length!==1||rows[0].valid!==true||rows[0].ready!==true||
  !rows[0].definition.includes('learn_card_email_draft_idx'))
  throw Error('TEST index acceptance changed');
}
const ddl=`create index concurrently learn_card_email_draft_idx
 on public.email_messages (tenant_id,id)
 where provider='gmail' and raw_payload->'label_ids' @> '["DRAFT"]'::jsonb`;
await sql(ddl,false);
const after=await sql(catalog,true);
if(after.length!==1||after[0].valid!==true||after[0].ready!==true||
 !after[0].definition.includes('email_messages')||
 !after[0].definition.includes('raw_payload'))
 throw Error('Created card DRAFT index requires inspection');
console.log(JSON.stringify({state:'card_draft_index_ready',project,
 index:after[0].index_name,valid:after[0].valid,ready:after[0].ready,
 concurrent:true,sourceRowsChanged:false}));
