/** Read-only exact recent-import revision-cost comparison; no source content output. */
import { savedCliToken } from './learn-test-readiness.mjs';
import { writeFileSync } from 'node:fs';
const mode=process.argv.slice(2).join(' ');
if(!['--live-200-read-only','--live-32-read-only',
  '--live-10-read-only','--live-1-read-only'].includes(mode))
  throw Error('Exact LIVE revision-cost read-only mode required');
const project='tgbnakbxwcqjeimygroz';
const tenant='00000000-0000-0000-0000-000000000001';
const limit=Number(mode.match(/^--live-(\d+)-read-only$/)?.[1]);
const timeout=limit<=32?'20s':'8s';
const query=`begin read only;
set local statement_timeout='${timeout}';
with unlinked as materialized (
 select m.id from public.email_messages m left join public.interactions i
  on i.tenant_id=m.tenant_id and i.source_table='email_messages' and i.source_id=m.id
 where m.tenant_id='${tenant}'::uuid and m.created_at>=clock_timestamp()-interval '30 days'
  and i.id is null and not coalesce(m.provider='gmail' and
   m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
 order by m.created_at desc,m.id desc limit ${limit}
), revisions as materialized (
 select public.learn_projection_revision(public.learn_email_source_fields(m),
  coalesce(to_jsonb(m)->>'origin_campaign_id','')) revision
 from unlinked u join public.email_messages m on m.tenant_id='${tenant}'::uuid and m.id=u.id
) select count(*)::int selected,coalesce(sum(length(revision)),0)::int revision_bytes
from revisions;
rollback;`;
const start=performance.now();
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(limit<=32?30000:15000),
  headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
  body:JSON.stringify({query})});
const elapsedMs=Math.round(performance.now()-start);
if(!response.ok){
  const detail=await response.json().catch(()=>({}));
  writeFileSync(`.verification-results/build01-email-revision-pressure-${limit}.private.json`,
    JSON.stringify(detail,null,2)+'\n',{mode:0o600});
  const message=String(detail?.message??'');
  console.log(JSON.stringify({limit,state:'unconfirmed',httpStatus:response.status,
    timedOut:/statement timeout|canceling statement/i.test(message),
    permission:/permission|privilege|denied/i.test(message),
    sqlSyntax:/syntax|column|ambiguous|function/i.test(message),
    elapsedMs,sourceIdsReturned:false,productionDataWrites:false}));
  process.exitCode=1;
}else{
  const rows=await response.json();
  if(!Array.isArray(rows)||rows.length!==1||
    !Number.isInteger(rows[0]?.selected)||!Number.isInteger(rows[0]?.revision_bytes))
    throw Error('Revision-cost result shape changed');
  console.log(JSON.stringify({limit,state:'confirmed',elapsedMs,
    selected:rows[0].selected,revisionBytes:rows[0].revision_bytes,
    sourceIdsReturned:false,productionDataWrites:false}));
}
