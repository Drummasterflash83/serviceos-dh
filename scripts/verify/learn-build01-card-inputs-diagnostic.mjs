/** Read-only aggregate shape/latency probe for stale unprojected LIVE cards. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
if (process.env.LEARN_LIVE_ALLOW_PROJECT_REF !== project)
  throw Error("Explicit LIVE project allowlist required");
const query = `with target as (
  select c.id from public.customer_cards c
  where c.tenant_id='${tenant}'::uuid and c.status<>'archived'
    and c.updated_at<clock_timestamp()-interval '1 hour'
    and not c.context?'projection'
  order by c.updated_at,c.id limit 3
) select count(*)::int target_count,
  max(p.answer->>'version') version,
  min(jsonb_array_length(p.answer->'interactions'))::int min_interaction_window,
  max(jsonb_array_length(p.answer->'interactions'))::int interaction_window,
  min(jsonb_array_length(p.answer->'recommendations'))::int min_recommendation_window,
  max(jsonb_array_length(p.answer->'recommendations'))::int recommendation_window,
  min((p.answer#>>'{coverage,eligibleInteractions}')::int)::int min_eligible_interactions,
  max((p.answer#>>'{coverage,eligibleInteractions}')::int)::int eligible_interactions,
  min((p.answer#>>'{coverage,eligibleRecommendations}')::int)::int min_eligible_recommendations,
  max((p.answer#>>'{coverage,eligibleRecommendations}')::int)::int eligible_recommendations
from target t cross join lateral (
  select public.learn_card_projection_inputs('${tenant}'::uuid,t.id) answer
) p`;
const started = Date.now();
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" },
    body: JSON.stringify({ query: `begin read only; ${query}; rollback;`, read_only: false }),
  });
if (!response.ok) {
  const detail = await response.json().catch(() => ({}));
  const code = typeof detail?.code === "string" ? detail.code : "unclassified";
  const messages = [detail?.message, detail?.error, detail?.details];
  const known = messages.find((value) => typeof value === "string" &&
    /^(permission denied|function .* does not exist|aggregate function calls cannot|column .* does not exist|operator does not exist|canceling statement due to statement timeout|query execution failed)/i.test(value));
  const redacted = typeof detail?.message === "string" ? detail.message
    .replace(/'[^']*'/g, "'<redacted>'")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<uuid>")
    .slice(0,160) : "query rejected";
  throw Error(`LIVE oldest-card inputs HTTP ${response.status} (${code}: ${known?.slice(0,160) ?? redacted}; keys ${Object.keys(detail).join(",")})`);
}
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 ||
  !Number.isInteger(rows[0]?.target_count) || rows[0].target_count < 0 ||
  rows[0].target_count > 3)
  throw Error("LIVE oldest-card input readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(),
  elapsedMs: Date.now() - started, ...rows[0], cardIdsReturned: false,
  sourceContentsReturned: false, productionDataWrites: false }));
