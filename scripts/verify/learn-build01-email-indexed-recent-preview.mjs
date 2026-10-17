/** Read-only LIVE cost check for the exact indexed-recent Email query shape. */
import { savedCliToken } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--live-ten-read-only", "--live-fifty-read-only"].includes(mode))
  throw Error("Exact LIVE indexed Email preview mode required");
const bound = mode.includes("fifty") ? 50 : 10;
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `begin read only;
set local role postgres;
set local statement_timeout='10s';
with bounds as materialized (select ${bound} bound), unlinked as materialized (
  select m.id,m.created_at from public.email_messages m cross join bounds b
  where m.tenant_id='${tenant}'::uuid
    and exists(select 1 from public.tenants t
      where t.id='${tenant}'::uuid and t.status='active')
    and m.created_at>=clock_timestamp()-interval '30 days'
    and not coalesce(m.provider='gmail' and
      m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
    and not exists(select 1 from public.interactions i
      where i.tenant_id=m.tenant_id and i.source_table='email_messages'
        and i.source_id=m.id)
  order by m.created_at desc,m.id desc
  limit (select least(512,greatest(64,bound*4)) from bounds)
), revisions as materialized (
  select m.id,m.created_at,
    public.learn_projection_revision(public.learn_email_source_fields(m),
      coalesce(to_jsonb(m)->>'origin_campaign_id','')) revision
  from unlinked u join public.email_messages m
    on m.tenant_id='${tenant}'::uuid and m.id=u.id
), eligible as materialized (
  select r.* from revisions r
  where not exists(select 1 from public.learn_interaction_projection_receipts h
    where h.tenant_id='${tenant}'::uuid and h.source_kind='email'
      and h.source_id=r.id and h.source_revision=r.revision
      and h.receipt->>'state'='review_required')
)
select (select count(*)::int from unlinked) candidates,
  (select count(*)::int from revisions) revisions,
  (select count(*)::int from eligible) eligible;
rollback;`;
const start = performance.now();
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(16000),
  headers: { Authorization: `Bearer ${savedCliToken()}`,
    "Content-Type": "application/json" }, body: JSON.stringify({ query }),
});
const elapsedMs = Math.round(performance.now() - start);
if (!response.ok) {
  const detail = await response.json().catch(() => ({}));
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
    bound, state: "unconfirmed", httpStatus: response.status,
    code: typeof detail.code === "string" ? detail.code : null,
    statementTimeout: /statement timeout|canceling statement/i.test(detail.message ?? ""),
    missingColumn: /column .* does not exist/i.test(detail.message ?? ""),
    permissionDenied: /permission denied|insufficient privilege/i.test(detail.message ?? ""),
    syntaxError: /syntax error/i.test(detail.message ?? ""),
    elapsedMs, sourceIdsReturned: false, messageContentReturned: false,
    productionDataWrites: false }));
  process.exitCode = 1;
} else {
  const rows = await response.json();
  const result = rows?.[0];
  if (!Array.isArray(rows) || rows.length !== 1 || !result ||
      ["candidates", "revisions", "eligible"].some(
        field => !Number.isSafeInteger(result[field]) || result[field] < 0))
    throw Error("Indexed Email preview shape changed");
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
    bound, state: "confirmed", elapsedMs, ...result,
    sourceIdsReturned: false, messageContentReturned: false,
    productionDataWrites: false }));
}
