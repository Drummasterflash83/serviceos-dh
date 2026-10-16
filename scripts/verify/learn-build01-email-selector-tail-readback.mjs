/** Read-only aggregate of the older Email selector's current tail. */
import { savedCliToken } from "./learn-test-readiness.mjs";
import { writeFileSync } from "node:fs";

const mode = process.argv.slice(2).join(" ");
if (!["--live-read-only", "--live-five-read-only",
  "--live-twelve-read-only", "--live-sixteen-read-only",
  "--live-no-hash-read-only"].includes(mode))
  throw Error("Exact LIVE read-only mode required");
const window = mode === "--live-five-read-only" ? 5
  : mode === "--live-twelve-read-only" ? 12
  : mode === "--live-sixteen-read-only" ? 16 : 32;

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `begin read only;
set local role postgres;
set local statement_timeout='20s';
${mode === "--live-no-hash-read-only" ? "set local enable_hashjoin=off;" : ""}
with recent as materialized (
 select m.id,m.created_at
 from public.email_messages m
 where m.tenant_id='${tenant}'::uuid
   and m.created_at>=clock_timestamp()-interval '30 days'
   and not exists(select 1 from public.interactions i
     where i.tenant_id=m.tenant_id and i.source_table='email_messages'
       and i.source_id=m.id)
   and not coalesce(m.provider='gmail' and
     m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
 order by m.created_at desc,m.id desc limit ${window}
), revisions as materialized (
 select m.id,public.learn_projection_revision(public.learn_email_source_fields(m),
   coalesce(to_jsonb(m)->>'origin_campaign_id','')) revision
 from recent r join public.email_messages m
   on m.tenant_id='${tenant}'::uuid and m.id=r.id
), eligible as (
 select v.id from revisions v
 where not exists(select 1 from public.learn_interaction_projection_receipts p
  where p.tenant_id='${tenant}'::uuid and p.source_kind='email'
    and p.source_id=v.id and p.source_revision=v.revision
    and p.receipt->>'state'='review_required')
)
select (select count(*)::int from recent) recent_unlinked,
 (select count(*)::int from revisions) revisions,
 (select count(*)::int from eligible) eligible,
 (select min(created_at) from recent) oldest_import_at,
 (select max(created_at) from recent) newest_import_at;
rollback;`;
const started = performance.now();
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
  headers: { Authorization: `Bearer ${savedCliToken()}`,
    "Content-Type": "application/json" }, body: JSON.stringify({ query }),
});
if (!response.ok) {
  const detail = await response.json().catch(() => ({}));
  writeFileSync(".verification-results/build01-email-selector-tail-error.private.json",
    JSON.stringify(detail, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ state: "unconfirmed", httpStatus: response.status,
    code: typeof detail?.code === "string" ? detail.code : null,
    timeout: /statement timeout|canceling statement/i.test(detail?.message ?? ""),
    elapsedMs: Math.round(performance.now()-started),
    sourceIdsReturned: false, productionDataWrites: false }));
  process.exitCode = 1;
  process.exit();
}
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 ||
  ["recent_unlinked","revisions","eligible"].some(
    (key) => !Number.isInteger(rows[0]?.[key])))
  throw Error("LIVE Email selector tail response changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  window, ...rows[0], elapsedMs: Math.round(performance.now()-started),
  sourceIdsReturned: false, productionDataWrites: false }));
