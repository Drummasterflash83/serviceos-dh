/** TEST-only counts for a hosted signed-delivery fixture; no IDs or secrets. */
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--test-read-only")
  throw Error("Explicit TEST read-only mode required");
const query = `select
 (select count(*)::int from public.slack_recurring_channels) recurring_rows,
 (select count(*)::int from public.slack_recurring_channels where enabled) enabled_rows,
 (select count(distinct tenant_id)::int from public.slack_recurring_channels where enabled) enabled_tenants,
 (select count(*)::int from public.connector_accounts a
  join public.tenant_connectors tc on tc.id=a.tenant_connector_id and tc.tenant_id=a.tenant_id
  where tc.connector_id='slack') slack_accounts,
 (select count(*)::int from public.provider_connections where provider='slack' and status='configured') configured_connections,
 (select count(*)::int from public.learn_slack_event_hints) event_hints,
 (select count(*)::int from public.platform_jobs where job_type='slack.event_sync') event_jobs`;
const response = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
if (!response.ok) throw Error(`TEST roster readback HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] ||
    !Object.values(rows[0]).every(value => Number.isSafeInteger(value) && value >= 0))
  throw Error("TEST roster readback shape changed");
console.log(JSON.stringify({ project: TEST_PROJECT, observedAtUtc: new Date().toISOString(),
  ...rows[0], sourceProviderRequests: 0, productionDataWrites: false }));
