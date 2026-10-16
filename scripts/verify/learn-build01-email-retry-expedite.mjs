/** Advance the one known older Email retry after TEST acceptance, preserving its claim path. */
import { readFileSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--live-guarded" ||
    process.env.LEARN_LIVE_ALLOW_PROJECT_REF !== "tgbnakbxwcqjeimygroz")
  throw Error("Exact LIVE guarded Email recovery mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const token = savedCliToken();
const acceptance = JSON.parse(readFileSync(
  ".verification-results/learn-build01-email-receipt-window/test-hosted-acceptance-v2.json"));
if (acceptance.state !== "email_receipt_worker_test_accepted" ||
    acceptance.fixtureArchived !== true || acceptance.workerVersion !== 64)
  throw Error("Hosted TEST Email acceptance unavailable");
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
async function query(sql, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(45000),
    body: JSON.stringify({ query: sql, ...(!readOnly ? { read_only: false } : {}) }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw Error(`LIVE Email retry query HTTP ${response.status} (${typeof detail.code === "string" ? detail.code : "unknown"})`);
  }
  return response.json();
}
const inventory = await fetch(`https://api.supabase.com/v1/projects/${project}/functions`, {
  headers: { Authorization: `Bearer ${token}` }, redirect: "error",
  signal: AbortSignal.timeout(30000),
});
if (!inventory.ok) throw Error("LIVE worker inventory unavailable");
const worker = (await inventory.json()).find((row) => row.slug === "platform-worker");
if (worker?.version !== 105 || worker?.ezbr_sha256 !== acceptance.workerWireSha256 ||
    worker?.status !== "ACTIVE" || worker?.verify_jwt !== false)
  throw Error("TEST-accepted LIVE worker changed");
const functions = await query(`select md5(pg_get_functiondef('public.learn_processing_settle(uuid,uuid,text,integer,uuid,jsonb,text)'::regprocedure)) settlement,
 md5(pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure)) selector`);
if (functions.length !== 1 ||
    functions[0].settlement !== "050be6cdb67f0ba844c6d19ac102f280" ||
    functions[0].selector !== "fc08674aa8b078a028902d1e51906620")
  throw Error("LIVE Email SQL release changed");
const read = `select id,status,error_code,attempt_count,available_at,updated_at,payload
 from public.platform_jobs where tenant_id='${tenant}'::uuid
 and job_type='interactions.sync' and payload->>'source'='email'
 and payload->>'lane' is null and status='retrying'`;
const rows = await query(read);
if (!Array.isArray(rows) || rows.length !== 1) throw Error("Unique older Email retry changed");
const job = rows[0];
if (!/^[0-9a-f-]{36}$/i.test(job.id) ||
    job.error_code !== "projection_inventory_unconfirmed" || job.attempt_count !== 4 ||
    job.payload?.source !== "email" || job.payload?.limit !== 10 ||
    Object.keys(job.payload).length !== 2 ||
    Date.parse(job.available_at) < Date.now() + 15 * 60_000 ||
    !Number.isFinite(Date.parse(job.updated_at)))
  throw Error("Exact Email retry baseline changed");
const where = `id='${job.id}'::uuid and tenant_id='${tenant}'::uuid
 and job_type='interactions.sync' and status='retrying'
 and error_code='projection_inventory_unconfirmed' and attempt_count=4
 and payload='{"source":"email","limit":10}'::jsonb
 and available_at='${job.available_at}'::timestamptz
 and updated_at='${job.updated_at}'::timestamptz`;
const update = `update public.platform_jobs set available_at=clock_timestamp()
 where ${where}; get diagnostics changed = row_count;
 if changed<>1 then raise exception 'email_retry_guard_changed';end if;`;
await query(`begin;do $$declare changed integer;begin ${update} end$$;rollback;`, false);
const rehearsal = await query(read);
if (rehearsal.length !== 1 || rehearsal[0].available_at !== job.available_at ||
    rehearsal[0].updated_at !== job.updated_at)
  throw Error("Email retry rollback rehearsal did not preserve baseline");
await query(`do $$declare changed integer;begin ${update} end$$;`, false);
const after = await query(`select status,attempt_count,available_at from public.platform_jobs
 where id='${job.id}'::uuid and tenant_id='${tenant}'::uuid`);
if (after.length !== 1 ||
    !["retrying", "running", "succeeded", "dead_letter"].includes(after[0].status))
  throw Error("Email retry advancement unconfirmed");
console.log(JSON.stringify({ state: "email_retry_guardedly_advanced", project,
  testProject: TEST_PROJECT, workerVersion: worker.version,
  priorAvailableAt: job.available_at, newAvailableAt: after[0].available_at,
  newStatus: after[0].status, attemptCount: after[0].attempt_count,
  rollbackRehearsed: true, sourceOrInteractionDataWrites: false,
  ordinaryWorkerClaimStillRequired: true }));
