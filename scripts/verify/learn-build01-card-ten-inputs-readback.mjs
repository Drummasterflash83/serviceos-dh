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
        set local role service_role; ${query}; rollback;`, read_only: false }),
    });
  if (!response.ok) throw Error(`LIVE card input HTTP ${response.status}`);
  return response.json();
}
const jobs = await read(`select payload->>'sweep_since' sweep_since,
  payload->>'limit' requested_limit from public.platform_jobs
  where tenant_id='${tenant}'::uuid and job_type='customer_card.sync'
    and status='retrying' and payload ? 'sweep_since'
  order by created_at desc,id desc limit 1`);
if (!Array.isArray(jobs) || jobs.length !== 1 ||
  !Number.isFinite(Date.parse(jobs[0]?.sweep_since)) ||
  !/^[0-9]{1,3}$/.test(jobs[0]?.requested_limit ?? ""))
  throw Error("LIVE ordinary card sweep unconfirmed");
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
    const rows = await readServiceFunction(`select
      (public.learn_card_projection_inputs('${tenant}'::uuid,'${card.id}'::uuid)
        #>>'{coverage,eligibleInteractions}')::int eligible`);
    if (!Array.isArray(rows) || rows.length !== 1 ||
      !Number.isInteger(rows[0]?.eligible)) throw Error("input_shape_changed");
    results.push({ position: position + 1, elapsedMs: Date.now() - started,
      eligibleInteractions: rows[0].eligible, success: true });
  } catch (error) {
    results.push({ position: position + 1, elapsedMs: Date.now() - started,
      success: false, code: error?.name === "TimeoutError"
        ? "read_timeout" : "input_unconfirmed" });
  }
}
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  tenant, sweepSince: jobs[0].sweep_since, requestedLimit: jobs[0].requested_limit,
  effectiveLimit: 10, batchCards: cards.length, results, cardIdsReturned: false,
  customerContentReturned: false, productionDataWrites: false }));
