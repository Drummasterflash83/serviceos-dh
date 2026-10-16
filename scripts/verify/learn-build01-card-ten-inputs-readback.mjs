/** Bounded read-only timings for the current ordinary LIVE ten-card sweep batch. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const token = savedCliToken();
async function read(query, timeoutMs = 20000) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${token}`,
        "Content-Type": "application/json" }, body: JSON.stringify({ query }),
    });
  if (!response.ok) throw Error(`LIVE card input HTTP ${response.status}`);
  return response.json();
}
async function readServiceFunction(query) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`,
        "Content-Type": "application/json" },
      body: JSON.stringify({ query: `begin read only;
        set local role service_role;
        set local statement_timeout='8s'; ${query}; rollback;`, read_only: false }),
    });
  if (!response.ok) throw Error(`LIVE card input HTTP ${response.status}`);
  return response.json();
}
const jobs = await read(`select payload->>'sweep_since' sweep_since,
  payload->>'limit' requested_limit from public.platform_jobs
  where tenant_id='${tenant}'::uuid and job_type='customer_card.sync'
    and status in ('retrying','dead_letter') and payload ? 'sweep_since'
  order by created_at desc,id desc limit 1`);
if (!Array.isArray(jobs) || jobs.length !== 1 ||
  !Number.isFinite(Date.parse(jobs[0]?.sweep_since)) ||
  !/^[0-9]{1,3}$/.test(jobs[0]?.requested_limit ?? ""))
  throw Error("LIVE ordinary card sweep unconfirmed");
const remainingRows = await read(`select count(*)::int remaining_in_sweep
  from public.customer_cards c where c.tenant_id='${tenant}'::uuid
   and c.status<>'archived'
   and c.updated_at<'${jobs[0].sweep_since}'::timestamptz`);
if (!Array.isArray(remainingRows) || remainingRows.length !== 1 ||
  !Number.isInteger(remainingRows[0]?.remaining_in_sweep))
  throw Error("LIVE ordinary card sweep count unconfirmed");
const cards = await read(`select c.id from public.customer_cards c
 where c.tenant_id='${tenant}'::uuid and c.status<>'archived'
  and c.updated_at<'${jobs[0].sweep_since}'::timestamptz
 order by c.updated_at,c.id limit 10`);
if (!Array.isArray(cards) || cards.length > 10 || cards.some((row) =>
  typeof row?.id !== "string" || !/^[a-f0-9-]{36}$/.test(row.id)))
  throw Error("LIVE ordinary card batch exceeds bounded readback");
const results = [];
for (const [position, card] of cards.entries()) {
  const started = Date.now();
  try {
    const rows = await readServiceFunction(`with x as materialized (
      select public.learn_card_projection_inputs('${tenant}'::uuid,
        '${card.id}'::uuid) as v
    ) select
      (v#>>'{coverage,eligibleInteractions}')::int eligible,
      v->>'version'='learn-card-inputs/1' version_ok,
      v->>'tenantId'='${tenant}' and v->>'cardId'='${card.id}' scope_ok,
      jsonb_typeof(v->'interactions')='array' and
        jsonb_typeof(v->'recommendations')='array' arrays_ok,
      case when jsonb_typeof(v->'interactions')='array' and
        jsonb_typeof(v->'recommendations')='array' then
        jsonb_array_length(v->'interactions')=least(100,
          (v#>>'{coverage,eligibleInteractions}')::int) and
        jsonb_array_length(v->'recommendations')=least(50,
          (v#>>'{coverage,eligibleRecommendations}')::int)
      else false end bounds_ok,
      (select bool_and(jsonb_typeof(v#>'{coverage}'->key)='number' and
        (v#>'{coverage}'->>key)::numeric>=0)
       from unnest(array['eligibleInteractions','excludedDraftInteractions',
        'interactionsLast7','interactionsPrev7','eligibleRecommendations',
        'excludedDraftRecommendations','urgentRecommendations']) key) counts_ok,
      (v#>>'{coverage,urgentRecommendations}')::int <=
        (v#>>'{coverage,eligibleRecommendations}')::int urgency_ok,
      (v#>>'{coverage,interactionLimit}')::int=100 and
        (v#>>'{coverage,recommendationLimit}')::int=50 limits_ok,
      length(v::text)::int input_json_chars,
      (v#>>'{coverage,eligibleRecommendations}')::int eligible_recommendations,
      (select coalesce(max(length(r->>'recommended_action')),0)::int
        from jsonb_array_elements(v->'recommendations') r) max_action_chars,
      v->>'capturedAt' captured_at from x`);
    if (!Array.isArray(rows) || rows.length !== 1 ||
      !Number.isInteger(rows[0]?.eligible)) throw Error("input_shape_changed");
    const contractValid = ["version_ok", "scope_ok", "arrays_ok",
      "bounds_ok", "counts_ok", "urgency_ok", "limits_ok"]
      .every((key) => rows[0]?.[key] === true) &&
      Number.isFinite(Date.parse(rows[0]?.captured_at));
    results.push({ position: position + 1, elapsedMs: Date.now() - started,
      eligibleInteractions: rows[0].eligible, success: contractValid,
      inputJsonChars: rows[0].input_json_chars,
      eligibleRecommendations: rows[0].eligible_recommendations,
      maxActionChars: rows[0].max_action_chars,
      ...(!contractValid ? { code: "input_contract_invalid" } : {}) });
  } catch (error) {
    results.push({ position: position + 1, elapsedMs: Date.now() - started,
      success: false, code: error?.name === "TimeoutError"
        ? "read_timeout" : "input_unconfirmed" });
  }
}
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  tenant, sweepSince: jobs[0].sweep_since, requestedLimit: jobs[0].requested_limit,
  effectiveLimit: 10, remainingInSweep: remainingRows[0].remaining_in_sweep,
  batchCards: cards.length, results, cardIdsReturned: false,
  customerContentReturned: false, productionDataWrites: false }));
