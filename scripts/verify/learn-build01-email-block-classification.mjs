/** Counts-only LIVE classification of held Email account cursors. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `select c.stream,c.state,c.block_code,a.status account_status,
  a.auth_state,count(*)::int accounts,min(c.updated_at) oldest_update,
  max(c.updated_at) newest_update
from public.email_ingestion_checkpoints c
join public.email_accounts a on a.id=c.email_account_id and a.tenant_id=c.tenant_id
where c.tenant_id='${tenant}'::uuid
group by 1,2,3,4,5 order by 1,2,3,4,5`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  },
);
if (!response.ok) throw Error(`LIVE Email block classification HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length > 30 ||
    rows.some((row) => !Number.isSafeInteger(row.accounts) || row.accounts < 1 ||
      typeof row.state !== "string" || typeof row.account_status !== "string"))
  throw Error("LIVE Email block classification shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  rows, accountIdsReturned: false, messageContentReturned: false,
  productionDataWrites: false }));
