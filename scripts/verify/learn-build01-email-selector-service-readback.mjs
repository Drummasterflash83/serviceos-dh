/** Execute one bounded LIVE selector read as its service role, in a read-only transaction. */
import { writeFileSync } from 'node:fs';
import { savedCliToken } from './learn-test-readiness.mjs';
const mode=process.argv.slice(2).join(' ');
if (!['--live-one-read-only','--live-five-read-only',
  '--live-ten-read-only','--live-fifty-read-only','--live-review-read-only',
  '--live-revision-five-postgres-read-only'].includes(mode))
  throw Error('Exact LIVE selector read-only mode required');
const project = 'tgbnakbxwcqjeimygroz';
const tenant = '00000000-0000-0000-0000-000000000001';
const requested=mode==='--live-fifty-read-only'?50:
  mode==='--live-ten-read-only'?10:mode==='--live-five-read-only'?5:1;
const selectSql=mode==='--live-revision-five-postgres-read-only'
  ? `with selected as materialized (
    select m.id from public.email_messages m
    where m.tenant_id='${tenant}'::uuid
      and m.created_at>=clock_timestamp()-interval '30 days'
      and not exists(select 1 from public.interactions i
        where i.tenant_id=m.tenant_id and i.source_table='email_messages'
          and i.source_id=m.id)
      and not coalesce(m.provider='gmail' and
        m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
    order by m.created_at desc,m.id desc limit 5
  ), revisions as materialized (
    select public.learn_projection_revision(public.learn_email_source_fields(m),
      coalesce(m.origin_campaign_id::text,'')) revision
    from selected s join public.email_messages m
      on m.tenant_id='${tenant}'::uuid and m.id=s.id
  ) select coalesce(sum(length(revision)),0)::int selected from revisions;`
  : mode==='--live-review-read-only'
  ? `select public.learn_projection_review_count('${tenant}'::uuid,'email')::int selected;`
  : `select count(*)::int selected from public.learn_projection_pending(
  '${tenant}'::uuid,'email',${requested});`;
const sql = `begin read only;
${mode==='--live-revision-five-postgres-read-only'?'':'set local role service_role;'}
set local statement_timeout='${mode==='--live-five-read-only'||mode==='--live-ten-read-only'?'8s':'20s'}';
${selectSql}
rollback;`;
const start = performance.now();
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
  headers: { Authorization: `Bearer ${savedCliToken()}`,
    'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }),
});
if (!response.ok) {
  const detail = await response.json().catch(() => ({}));
  writeFileSync('.verification-results/build01-email-selector-service-error.private.json',
    JSON.stringify(detail,null,2)+'\n',{mode:0o600});
  const message = typeof detail?.message === 'string' ? detail.message : '';
  console.log(JSON.stringify({ mode, state: 'unconfirmed', httpStatus: response.status,
    timeout: /statement timeout|canceling statement/i.test(message),
    permission: /permission|privilege|denied/i.test(message),
    elapsedMs: Math.round(performance.now()-start), sourceIdsReturned: false,
    productionDataWrites: false }));
  process.exitCode=1;
} else {
  const rows=await response.json();
  if (!Array.isArray(rows) || rows.length!==1 ||
    !Number.isInteger(rows[0]?.selected) || rows[0].selected<0)
    throw Error('Selector result shape changed');
  console.log(JSON.stringify({mode,state:'confirmed', selected:rows[0].selected,
    elapsedMs:Math.round(performance.now()-start),sourceIdsReturned:false,
    productionDataWrites:false}));
}
