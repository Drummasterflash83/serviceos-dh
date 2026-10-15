/** Aggregate-only LIVE audit of Workspace source-ineligible outcomes.
 * Mailbox addresses, account IDs, payloads and provider error bodies are omitted.
 */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with failed as (
  select (j.payload->>'email_account_id')::uuid account_id,
    count(*)::int failed_jobs, max(j.updated_at) latest_failure
  from public.platform_jobs j
  where j.tenant_id='${tenant}'::uuid and j.job_type='email.workspace_sync'
    and j.status='dead_letter' and j.error_code='source_ineligible'
    and j.updated_at>=now()-interval '1 hour'
    and j.payload->>'email_account_id' ~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  group by (j.payload->>'email_account_id')::uuid
) select coalesce(a.status,'missing') account_status,
  coalesce(m.status,'missing') mailbox_status,
  coalesce(c.block_code,'none') recent_block_code,
  count(*)::int affected_accounts, sum(f.failed_jobs)::int failed_jobs,
  max(f.latest_failure) latest_failure
from failed f
left join public.email_accounts a on a.tenant_id='${tenant}'::uuid and a.id=f.account_id
left join public.google_workspace_mailboxes m on m.tenant_id=a.tenant_id
  and lower(m.email_address)=lower(a.email_address)
left join public.email_ingestion_checkpoints c on c.tenant_id=a.tenant_id
  and c.email_account_id=a.id and c.stream='recent'
group by a.status,m.status,c.block_code
order by affected_accounts desc,failed_jobs desc`;

const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    redirect: "error",
    signal: AbortSignal.timeout(45000),
  },
);
if (!response.ok) throw Error(`Workspace source audit failed (HTTP ${response.status})`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length > 100 || rows.some(row =>
  typeof row?.account_status !== "string" || typeof row.mailbox_status !== "string" ||
  typeof row.recent_block_code !== "string" || !Number.isInteger(row.affected_accounts) ||
  !Number.isInteger(row.failed_jobs))) throw Error("Workspace source audit shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  period: "last_hour", rows, productionDataWrites: false }));
