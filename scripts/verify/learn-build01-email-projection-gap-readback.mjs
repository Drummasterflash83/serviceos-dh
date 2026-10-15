/** Aggregate-only LIVE readback of email source-to-interaction coverage. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with missing as (
  select m.id,m.created_at,
    exists(select 1 from public.learn_interaction_projection_receipts r
      where r.tenant_id=m.tenant_id and r.source_kind='email'
        and r.source_id=m.id and r.receipt->>'state'='review_required') review_held,
    exists(select 1 from public.learn_interaction_projection_receipts r
      where r.tenant_id=m.tenant_id and r.source_kind='email'
        and r.source_id=m.id and r.receipt->>'state'='committed') committed_receipt
  from public.email_messages m
  where m.tenant_id='${tenant}'::uuid
    and not coalesce(m.provider='gmail'
      and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
    and not exists(select 1 from public.interactions i
      where i.tenant_id=m.tenant_id and i.source_table='email_messages'
        and i.source_id=m.id)
) select count(*)::int eligible_missing,
  count(*) filter(where review_held)::int with_review_hold,
  count(*) filter(where committed_receipt)::int with_committed_receipt,
  count(*) filter(where not review_held and not committed_receipt)::int without_receipt,
  count(*) filter(where created_at>=now()-interval '1 hour')::int created_last_hour,
  count(*) filter(where created_at<now()-interval '1 day')::int older_than_day,
  min(created_at) oldest_source_at,max(created_at) newest_source_at
  from missing`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    redirect: "error",
    signal: AbortSignal.timeout(45000),
  },
);
if (!response.ok) throw Error(`Email projection gap readback failed (HTTP ${response.status})`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 ||
  !Number.isInteger(rows[0]?.eligible_missing)) throw Error("Email projection gap shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  tenant, ...rows[0], productionDataWrites: false }));
