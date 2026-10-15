/** Aggregate-only LIVE scoring-policy and assessment readiness readback. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `select
  (select count(*)::int from public.operating_profile_entries
    where tenant_id='${tenant}'::uuid and namespace='learn_scorecards'
      and scope_kind='tenant' and key like 'definition.%') saved_definitions,
  (select count(*)::int from public.learn_scorecard_publications
    where tenant_id='${tenant}'::uuid) published_policies,
  (select count(*)::int from public.measurements
    where tenant_id='${tenant}'::uuid and policy_id is not null) scorecard_measurements,
  (select count(*)::int from public.learn_assessments
    where tenant_id='${tenant}'::uuid) saved_assessments`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(45000),
  },
);
if (!response.ok) throw Error(`Scoring readback failed (HTTP ${response.status})`);
const rows = await response.json();
const row = rows?.[0];
if (!Array.isArray(rows) || rows.length !== 1 || !row ||
    !["saved_definitions", "published_policies", "scorecard_measurements", "saved_assessments"]
      .every(key => Number.isInteger(row[key]) && row[key] >= 0))
  throw Error("Scoring readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  tenant, ...row, productionDataWrites: false,
  scope: "Counts only; definitions, evidence quality and human scoring acceptance require separate review." }));
