// Focused test — the enqueue one-active-row invariant covers 'retrying'.
//
// Proves platform_jobs_active_job_key_uk (migration 20260804120000) rejects a second
// active job for the same (tenant, job_key) not only while the first is `queued`
// (always held) but also while it is `retrying` — the gap that produced duplicate
// active jobs. Also proves there is NO false lockout once the first job reaches a
// terminal state (`cancelled`).
//
// SAFE: every row uses a unique tagged job_key, a job_type with NO worker handler
// (`verify.collision_probe`), and an `available_at` one year in the future, so the
// worker never claims it; all rows are deleted in a finally block. Run against a DB
// with the migration applied:
//   set -a && . ./.env.verify && set +a && node scripts/queue-collision.test.mjs
//
// Exit 0 = invariant holds. Exit 1 = a duplicate active job was allowed (bug present
// or migration not deployed) or an assertion failed.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (source .env.verify)");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const TENANT = process.env.VERIFY_TENANT || "00000000-0000-0000-0000-000000000001";
const JOB_KEY = `verify:collision:${crypto.randomUUID()}`;
const JOB_TYPE = "verify.collision_probe"; // deliberately has NO handler
const FAR_FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

let failures = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failures++;
};

function baseRow() {
  return {
    tenant_id: TENANT,
    job_type: JOB_TYPE,
    job_key: JOB_KEY,
    status: "queued",
    available_at: FAR_FUTURE, // never due → worker never claims it
    payload: { test: "queue-collision" },
  };
}

// Insert one row; return { id, code } where code is the PG error code (or null on success).
async function insertProbe() {
  const { data, error } = await db.from("platform_jobs").insert(baseRow()).select("id").single();
  return { id: data?.id ?? null, code: error?.code ?? null, message: error?.message ?? null };
}

async function setStatus(id, status) {
  const { error } = await db.from("platform_jobs").update({ status }).eq("id", id);
  if (error) throw new Error(`could not set status=${status}: ${error.message}`);
}

async function activeCount() {
  const { count } = await db
    .from("platform_jobs")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", TENANT)
    .eq("job_key", JOB_KEY)
    .in("status", ["queued", "running", "retrying"]);
  return count ?? 0;
}

const createdIds = [];
try {
  // 1) First enqueue succeeds (the one active job).
  const first = await insertProbe();
  ok("first enqueue inserts an active job", !!first.id && first.code === null, first.message ?? "");
  if (!first.id) throw new Error("cannot proceed — first insert failed");
  createdIds.push(first.id);

  // 2) Collision while QUEUED is rejected (baseline invariant).
  const dupQueued = await insertProbe();
  if (dupQueued.id) createdIds.push(dupQueued.id);
  ok(
    "duplicate while status=queued is rejected (23505)",
    dupQueued.code === "23505" && !dupQueued.id,
    dupQueued.code ? `code=${dupQueued.code}` : "second active row was inserted",
  );

  // 3) Move the first job to RETRYING, then a collision must STILL be rejected.
  await setStatus(first.id, "retrying");
  const dupRetrying = await insertProbe();
  if (dupRetrying.id) createdIds.push(dupRetrying.id);
  ok(
    "duplicate while status=retrying is rejected (the fix)",
    dupRetrying.code === "23505" && !dupRetrying.id,
    dupRetrying.id
      ? "a second active job was allowed — migration 20260804120000 not applied?"
      : `code=${dupRetrying.code}`,
  );

  // 4) Exactly one active job throughout (no duplicate slipped through).
  ok("exactly one active job for the key", (await activeCount()) === 1);

  // 5) No FALSE lockout: once the first job is terminal, a fresh enqueue succeeds.
  await setStatus(first.id, "cancelled");
  const afterTerminal = await insertProbe();
  if (afterTerminal.id) createdIds.push(afterTerminal.id);
  ok(
    "a new enqueue succeeds after the prior job is terminal (no false lockout)",
    !!afterTerminal.id && afterTerminal.code === null,
    afterTerminal.message ?? "",
  );
} catch (e) {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  failures++;
} finally {
  // Cleanup — remove every row we created for this key (also catches any leaked dup).
  const { data: leftovers } = await db
    .from("platform_jobs")
    .select("id")
    .eq("tenant_id", TENANT)
    .eq("job_key", JOB_KEY);
  const ids = [...new Set([...createdIds, ...(leftovers ?? []).map((r) => r.id)])];
  if (ids.length) await db.from("platform_jobs").delete().in("id", ids);
  console.log(`cleanup: deleted ${ids.length} probe row(s)`);
}

console.log(
  failures === 0 ? "\nqueue-collision invariant holds ✓" : `\n${failures} assertion(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
