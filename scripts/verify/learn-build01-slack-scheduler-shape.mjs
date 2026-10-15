/** Read only the installed scheduler expression needed for a guarded patch. */
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
const project = mode === "--live-read-only" ? "tgbnakbxwcqjeimygroz"
  : mode === "--test-read-only" ? TEST_PROJECT : null;
if (!project) throw Error("Exact read-only target required");
const query = `with d as (select pg_get_functiondef('public.learn_slack_schedule_recurring(integer)'::regprocedure) body)
select length(body)::int definition_length,
  substring(body from greatest(position('15 minutes' in body)-120,1) for 300) ending_expression,
  position('learn_slack_queue_recurring_threads' in body)>0 reply_gate_present,
  position('learn_slack_credential_field' in body)>0 credential_gate_present
from d`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(45000),
});
if (!response.ok) throw Error(`Scheduler-shape readback failed (HTTP ${response.status})`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 || !Number.isInteger(rows[0]?.definition_length))
  throw Error("Scheduler-shape readback changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, ...rows[0], productionDataWrites: false }));
