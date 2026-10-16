/** Read-only measure of bounded, receipt-aware Email change selection. */
import { savedCliToken } from "./learn-test-readiness.mjs";
import { writeFileSync } from "node:fs";
const mode = process.argv.slice(2).join(" ");
const bound = mode === "--live-ten-read-only" ? 10
  : mode === "--live-fifty-read-only" ? 50 : null;
if (!bound) throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const window = Math.max(64, bound + 22);
const query = `with selected as materialized (
 select m.id,m.updated_at,i.metadata#>>'{source_projection,revision}' prior_revision
 from public.email_messages m
 join public.interactions i on i.tenant_id=m.tenant_id
  and i.source_table='email_messages' and i.source_id=m.id
 where m.tenant_id='${tenant}'::uuid
  and i.metadata#>>'{source_projection,revision}' is not null
  and not coalesce(m.provider='gmail' and
   m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
  and m.updated_at>coalesce((select max(r.created_at)
   from public.learn_interaction_projection_receipts r
   where r.tenant_id=m.tenant_id and r.source_kind='email'
    and r.source_id=m.id and r.receipt->>'state'='committed'),'-infinity'::timestamptz)
  and not exists(select 1 from public.learn_interaction_projection_receipts h
   where h.tenant_id=m.tenant_id and h.source_kind='email'
    and h.source_id=m.id and h.receipt->>'state'='review_required'
    and h.created_at>=m.updated_at)
 order by m.updated_at desc,m.id desc limit ${window}
), revisions as materialized (
 select s.id,s.prior_revision,
  public.learn_projection_revision(public.learn_email_source_fields(m),
   coalesce(to_jsonb(m)->>'origin_campaign_id','')) revision
 from selected s join public.email_messages m on m.tenant_id='${tenant}'::uuid and m.id=s.id
), eligible as materialized (
 select r.* from revisions r
 where not exists(select 1 from public.learn_interaction_projection_receipts h
  where h.tenant_id='${tenant}'::uuid and h.source_kind='email'
   and h.source_id=r.id and h.source_revision=r.revision
   and h.receipt->>'state'='review_required')
) select (select count(*)::int from selected) candidates,
 (select count(*)::int from eligible) eligible,
 (select count(*)::int from eligible where revision=prior_revision) unchanged_revision,
 (select count(*)::int from eligible where revision<>prior_revision) changed_revision`;
const started = performance.now();
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`,
    "Content-Type": "application/json" },
  body: JSON.stringify({ query: `begin read only; set local statement_timeout='25s';\n${query};\nrollback;`, read_only: false }),
});
if (!response.ok) {
  const detail = await response.json().catch(() => ({}));
  writeFileSync(".verification-results/build01-email-updated-selector-error.private.json",
    JSON.stringify(detail, null, 2) + "\n", { mode: 0o600 });
  throw Error(`LIVE Email updated selector HTTP ${response.status} (${typeof detail.code === "string" ? detail.code : "unknown"})`);
}
const rows = await response.json();
if (rows?.length !== 1 || ["candidates","eligible","unchanged_revision","changed_revision"]
  .some((key) => !Number.isInteger(rows[0]?.[key])))
  throw Error("LIVE Email updated selector shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, bound, window,
  elapsedMs: Math.round(performance.now() - started), ...rows[0],
  sourceIdsReturned: false, productionDataWrites: false }));
