/** Read-only aggregate of retained Email rows changed after projection receipt. */
import { savedCliToken } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `select count(*)::int committed_source_pairs,
 count(*) filter(where m.updated_at>r.created_at)::int source_updated_after_receipt,
 count(*) filter(where m.updated_at>r.created_at
   and m.updated_at<now()-interval '1 hour')::int older_than_hour,
 min(m.updated_at) filter(where m.updated_at>r.created_at) oldest_update_at,
 max(m.updated_at) filter(where m.updated_at>r.created_at) newest_update_at
 from public.learn_interaction_projection_receipts r
 join public.email_messages m on m.tenant_id=r.tenant_id and m.id=r.source_id
 where r.tenant_id='${tenant}'::uuid and r.source_kind='email'
 and r.receipt->>'state'='committed'`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
  headers: { Authorization: `Bearer ${savedCliToken()}`,
    "Content-Type": "application/json" }, body: JSON.stringify({ query }),
});
if (!response.ok) throw Error(`LIVE Email post-receipt readback HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 ||
  ["committed_source_pairs","source_updated_after_receipt","older_than_hour"]
    .some((key) => !Number.isInteger(rows[0]?.[key])))
  throw Error("LIVE Email post-receipt readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  ...rows[0], sourceIdsReturned: false, productionDataWrites: false }));
