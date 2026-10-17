/** Exact LIVE roster/login metadata for the Chris-approved first human handoff. */
import { savedCliToken } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `select m.id member_id,m.display_name,m.profile_id,m.version,
  m.confirmed_at,m.effective_from,m.effective_to,m.observed_status,
  p.email login_email,p.role login_role,p.tenant_id login_tenant
  from public.team_members m left join public.profiles p on p.id=m.profile_id
  where m.tenant_id='${tenant}'::uuid and m.display_name='Owner / MD'
    and m.effective_to is null`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
if (!response.ok) throw Error(`Owner / MD readback HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] ||
    rows[0].login_tenant !== tenant || typeof rows[0].login_email !== "string" ||
    !Number.isSafeInteger(rows[0].version) || rows[0].version < 1)
  throw Error("Owner / MD login link is unavailable or ambiguous");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant, ...rows[0],
  sourceContentReturned: false, productionDataWrites: false }));
