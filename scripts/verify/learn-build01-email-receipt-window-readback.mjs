/** Service-role, read-only count of the installed bounded Email update selector. */
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
const mode = process.argv.slice(2).join(" ");
const project = mode === "--test-read-only" ? TEST_PROJECT
  : mode === "--live-read-only" ? "tgbnakbxwcqjeimygroz" : null;
if (!project) throw Error("Exact TEST or LIVE read-only mode required");
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `begin read only;
set local role service_role;
set local statement_timeout='25s';
select count(*)::int selected from public.learn_projection_pending_email_updates(
 '${tenant}'::uuid,10);
rollback;`;
const started = performance.now();
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(35000),
  headers: { Authorization: `Bearer ${savedCliToken()}`,
    "Content-Type": "application/json" },
  body: JSON.stringify({ query, read_only: false }),
});
if (!response.ok) throw Error(`Email receipt-window readback HTTP ${response.status}`);
const rows = await response.json();
if (rows?.length !== 1 || !Number.isInteger(rows[0]?.selected) ||
    rows[0].selected < 0 || rows[0].selected > 10)
  throw Error("Email receipt-window readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  selected: rows[0].selected, elapsedMs: Math.round(performance.now()-started),
  sourceIdsReturned: false, productionDataWrites: false }));
