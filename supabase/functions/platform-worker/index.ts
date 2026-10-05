// ServiceOS — Edge Function: platform-worker (Async Worker Queue v1)
//
// The generic queue worker. Invoked on a 1-minute cron (secret-gated), it:
//   1. releases expired leases (reclaims jobs whose worker died),
//   2. atomically CLAIMS a small batch (FOR UPDATE SKIP LOCKED — no double work),
//   3. dispatches each job by job_type to the EXISTING authoritative worker
//      function (no business logic is duplicated here),
//   4. completes / retries (exponential backoff) / dead-letters each independently.
//
// Because the claimed queue job is 'running' with the SAME job_key the child
// function uses, the child's active-key de-dup makes it defer to THIS row (it
// skips creating its own) — so there is exactly one platform_jobs row per unit of
// work, owned by the queue.
//
// Fast return: claiming is quick; the heavy dispatch runs inside
// EdgeRuntime.waitUntil so it COMPLETES even if the (pg_net) caller disconnects at
// its 5s timeout. The response carries the outcome when processing finishes in
// time; otherwise the outcome lands in platform_jobs and the Operations Centre.
//
// Auth: shared secret `x-schedule-secret` == WORKER_SECRET. NOT a user session,
// NOT tenant-bound — the queue is cross-tenant infrastructure. Service-role only.
//
// Request body: { batch_size?: number, job_types?: string[] }
// Runtime: Supabase Edge Functions (Deno). Deploy with verify_jwt=false.

import { createSupabaseAdmin } from "../_shared/simwood.ts";
import {
  claimJobs,
  completeJob,
  deadLetterJob,
  enqueueJob,
  failJob,
  releaseExpiredLeases,
  type JobRow,
} from "../_shared/platform_queue.ts";
import { getWorkerHandler } from "../_shared/worker_handlers/index.ts";
import { healthComponentForJob, recordHealthCheck } from "../_shared/system_health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-schedule-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_BATCH = 3;
const MAX_BATCH = 20;
const LEASE_SECONDS = 300;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
function fail(code: string, message: string, status: number): Response {
  return json({ success: false, error: { code, message } }, status);
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function num(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : def;
  return Math.max(min, Math.min(max, n));
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const expected = Deno.env.get("WORKER_SECRET");
  if (!expected) return fail("config_error", "WORKER_SECRET is not configured", 500);
  const provided = req.headers.get("x-schedule-secret") ?? "";
  if (!safeEqual(provided, expected)) return fail("forbidden", "Invalid or missing secret", 403);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createSupabaseAdmin();
  if (!serviceKey || !admin) return fail("config_error", "Service role is not configured", 500);

  let body: { batch_size?: unknown; job_types?: unknown } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    body = {};
  }
  const batch = num(body.batch_size, DEFAULT_BATCH, 1, MAX_BATCH);
  const jobTypes = Array.isArray(body.job_types)
    ? (body.job_types.filter((t) => typeof t === "string") as string[])
    : null;

  const startedMs = Date.now();
  const worker = `worker-${crypto.randomUUID().slice(0, 8)}`;

  // 1) reclaim dead workers' jobs, then 2) claim a batch atomically.
  await releaseExpiredLeases(admin);
  const claimed = await claimJobs(admin, {
    worker,
    batch,
    leaseSeconds: LEASE_SECONDS,
    jobTypes: jobTypes && jobTypes.length ? jobTypes : null,
  });

  const counts = { claimed: claimed.length, succeeded: 0, retrying: 0, dead_lettered: 0 };

  async function processOne(job: JobRow): Promise<void> {
    const id = job.id as string;
    const tenantId = job.tenant_id as string;
    const jobType = job.job_type as string;
    const attempt = (job.attempt_count as number) ?? 1;
    const maxAttempts = (job.max_attempts as number) ?? 5;

    // Preferred: a shared handler runs the business logic IN-PROCESS (no HTTP).
    const handler = getWorkerHandler(jobType);
    if (handler) {
      const payload = (job.payload as Record<string, unknown> | null) ?? {};
      // The one place every pipeline stage reports health: map the job to its sensor
      // component and emit healthy on success / degraded (retry) / failed (dead-letter).
      const component = healthComponentForJob(jobType);
      const r = await handler({ supabaseAdmin: admin, tenantId, jobId: id, payload });
      if (r.success) {
        await completeJob(admin, id, {
          recordsProcessed: r.recordsProcessed,
          result: r.result ?? {},
        });
        // Self-continued drain: the job is now terminal, so its idempotent active
        // job_key is free. Enqueue the handler's requested follow-on batch. If a
        // base-scheduler job is already active for that key, enqueueJob de-dups
        // (23505) and returns { duplicate: true } — so at most one is ever live and
        // there is never a stampede. Best-effort: a continuation failure never fails
        // the completed job.
        if (r.continuation) {
          try {
            await enqueueJob(admin, {
              tenantId,
              jobType: r.continuation.jobType,
              jobKey: r.continuation.jobKey,
              connectorId: r.continuation.connectorId ?? (job.connector_id as string | null) ?? null,
              moduleId: r.continuation.moduleId ?? (job.module_id as string | null) ?? null,
              priority: r.continuation.priority ?? 50,
              payload: r.continuation.payload ?? {},
            });
          } catch (_e) {
            // swallow — the base scheduler will re-prime on its next tick.
          }
        }
        if (component)
          await recordHealthCheck(admin, {
            tenantId,
            component,
            status: "healthy",
            metadata: { job_type: jobType, records: r.recordsProcessed ?? 0 },
          });
        counts.succeeded += 1;
        return;
      }
      const hOutcome = await failJob(
        admin,
        { id, attempt, maxAttempts },
        {
          errorCode: r.error?.code ?? "handler_error",
          message: r.error?.message ?? "handler failed",
          retryable: r.error?.retryable ?? true,
        },
      );
      if (component)
        await recordHealthCheck(admin, {
          tenantId,
          component,
          status: hOutcome === "retrying" ? "degraded" : "failed",
          error: r.error?.message ?? "handler failed",
          metadata: { job_type: jobType, code: r.error?.code ?? "handler_error", outcome: hOutcome },
        });
      if (hOutcome === "retrying") counts.retrying += 1;
      else counts.dead_lettered += 1;
      return;
    }

    // No shared handler for this job_type → unsupported. Never retried forever.
    await deadLetterJob(admin, id, {
      errorCode: "unsupported_job",
      message: `No handler for job_type '${jobType}'`,
    });
    counts.dead_lettered += 1;
  }

  // Heavy dispatch runs in the background (survives caller disconnect) AND is
  // awaited so the response reflects the outcome when it finishes in time.
  const work = Promise.all(claimed.map((job) => processOne(job).catch(() => {})));
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime;
  if (er?.waitUntil) er.waitUntil(work);
  await work;

  const failed = counts.claimed - counts.succeeded - counts.retrying - counts.dead_lettered;
  return json({
    success: true,
    claimed: counts.claimed,
    succeeded: counts.succeeded,
    retrying: counts.retrying,
    dead_lettered: counts.dead_lettered,
    failed: Math.max(0, failed),
    duration_ms: Date.now() - startedMs,
  });
});
