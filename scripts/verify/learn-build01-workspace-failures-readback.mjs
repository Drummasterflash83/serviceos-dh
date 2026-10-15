/** Aggregate-only LIVE readback of recent Workspace job and run failures. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `select 'job' kind,status,coalesce(error_code,'none') reason,
  count(*)::int total,max(updated_at) latest_at
  from public.platform_jobs where tenant_id='${tenant}'::uuid
    and job_type='email.workspace_sync' and updated_at>=now()-interval '1 hour'
    and status in ('failed','dead_letter','retrying')
  group by status,coalesce(error_code,'none')
  union all
  select 'source_run' kind,status,coalesce(error_message,'none') reason,
    count(*)::int total,max(completed_at) latest_at
  from public.email_sync_runs where tenant_id='${tenant}'::uuid
    and provider='gmail' and sync_type='workspace_messages'
    and completed_at>=now()-interval '1 hour' and status='failed'
  group by status,coalesce(error_message,'none')
  order by kind,status,reason`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    redirect: "error",
    signal: AbortSignal.timeout(45000),
  },
);
if (!response.ok) throw Error(`Workspace readback failed (HTTP ${response.status})`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length > 40 || rows.some(row =>
  !["job", "source_run"].includes(row?.kind) || typeof row.reason !== "string" ||
  !Number.isInteger(row.total))) throw Error("Workspace readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  tenant, period: "last_hour", rows, productionDataWrites: false }));
