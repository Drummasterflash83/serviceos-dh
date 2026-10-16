/** Aggregate-only LIVE Email revision receipt inventory. */
import { savedCliToken } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `select
 (select count(*)::int from public.email_messages
  where tenant_id='${tenant}'::uuid) saved_messages,
 (select count(*)::int from public.interactions
  where tenant_id='${tenant}'::uuid and source_table='email_messages') linked_interactions,
 (select count(*)::int from public.interactions
  where tenant_id='${tenant}'::uuid and source_table='email_messages'
   and metadata#>>'{source_projection,revision}' is not null) linked_with_revision,
 (select count(*)::int from public.learn_interaction_projection_receipts
  where tenant_id='${tenant}'::uuid and source_kind='email'
   and receipt->>'state'='committed') committed_receipts,
 (select count(distinct source_id)::int from public.learn_interaction_projection_receipts
  where tenant_id='${tenant}'::uuid and source_kind='email'
   and receipt->>'state'='committed') distinct_committed_sources,
 (select count(*)::int from public.learn_interaction_projection_receipts
  where tenant_id='${tenant}'::uuid and source_kind='email'
   and receipt->>'state'='review_required') held_receipts`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`,
    "Content-Type": "application/json" }, body: JSON.stringify({ query }),
});
if (!response.ok) throw Error(`LIVE Email receipt coverage HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 ||
  ["saved_messages","linked_interactions","linked_with_revision",
    "committed_receipts","distinct_committed_sources","held_receipts"]
    .some((key) => !Number.isInteger(rows[0]?.[key])))
  throw Error("LIVE Email receipt coverage shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  ...rows[0], sourceIdsReturned: false, productionDataWrites: false }));
