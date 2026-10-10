import { settlePhoneJob } from "../_shared/phone-recovery-job.ts";
import {
  captureAdmission,
  captureSourceForJob,
  deferCaptureJob,
} from "../_shared/learn_capture_control.ts";
import { getBearerToken } from "../_shared/authz.ts";
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
// Auth: existing schedule secret OR the exact configured service-role bearer.
// User JWT claims are never authority here. The queue is cross-tenant infrastructure.
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
  const provided = req.headers.get("x-schedule-secret") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = getBearerToken(req);
  const scheduleAuthorized = !!expected && safeEqual(provided, expected);
  const internalKey = req.headers.get("x-serviceos-internal-key");
  const expectedInternalKey = Deno.env.get("SERVICEOS_INTERNAL_KEY") || serviceKey;
  const serviceAuthorized =
    !!serviceKey &&
    ((!!bearer && safeEqual(bearer, serviceKey)) ||
      (!!internalKey && !!expectedInternalKey && safeEqual(internalKey, expectedInternalKey)));
  if (!scheduleAuthorized && !serviceAuthorized)
    return fail("forbidden", "Invalid or missing worker authorization", 403);

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

  const counts = {
    claimed: claimed.length,
    succeeded: 0,
    retrying: 0,
    dead_lettered: 0,
    waiting: 0,
    unconfirmed: 0,
  };

  async function processOne(job: JobRow): Promise<void> {
    const id = job.id as string;
    const tenantId = job.tenant_id as string;
    const jobType = job.job_type as string;
    const attempt = (job.attempt_count as number) ?? 1;
    const maxAttempts = (job.max_attempts as number) ?? 5;
    const captureSource = captureSourceForJob(jobType);
    const durableEmail = [
      "email.gmail_sync",
      "email.workspace_sync",
      "email.workspace_backfill",
    ].includes(jobType);
    const captureClaim = { tenantId, jobId: id, claimedBy: job.claimed_by as string, attempt };
    if (captureSource && !durableEmail) {
      const admission = await captureAdmission(admin, tenantId, captureSource);
      if (!admission.allowed) {
        await deferCaptureJob(admin, captureClaim, admission.reason);
        counts.waiting += 1;
        return;
      }
    }

    // Preferred: a shared handler runs the business logic IN-PROCESS (no HTTP).
    const handler = getWorkerHandler(jobType);
    if (handler) {
      const payload = (job.payload as Record<string, unknown> | null) ?? {};
      // The one place every pipeline stage reports health: map the job to its sensor
      // component and emit healthy on success / degraded (retry) / failed (dead-letter).
      const component = healthComponentForJob(jobType);
      const r = await handler({
        supabaseAdmin: admin,
        tenantId,
        jobId: id,
        jobType,
        payload,
        claim: { claimedBy: job.claimed_by as string, attemptCount: attempt },
      });
      if (jobType === "phone.process_pending") {
        const outcome = await settlePhoneJob(
          admin,
          {
            tenantId,
            jobId: id,
            claim: { claimedBy: job.claimed_by as string, attemptCount: attempt },
          },
          r,
          maxAttempts,
        );
        if (outcome === "unconfirmed") counts.unconfirmed += 1;
        else if (outcome === "succeeded") counts.succeeded += 1;
        else if (outcome === "retrying") counts.retrying += 1;
        else counts.dead_lettered += 1;
        if (component && outcome !== "unconfirmed")
          await recordHealthCheck(admin, {
            tenantId,
            component,
            status:
              outcome === "succeeded"
                ? Number(r.result?.capture_waiting ?? 0) > 0 ||
                  r.result?.reason === "awaiting_retry_or_review"
                  ? "degraded"
                  : "healthy"
                : outcome === "retrying"
                  ? "degraded"
                  : "failed",
            ...(r.error ? { error: r.error.message } : {}),
            metadata: { job_type: jobType, outcome, records: r.recordsProcessed ?? 0 },
          });
        return;
      }
      if (r.queueOutcome) {
        const q = r.queueOutcome;
        if (
          !durableEmail ||
          q.jobId !== id ||
          !["completed", "failed"].includes(q.state) ||
          (q.state === "completed") !== r.success
        ) {
          counts.unconfirmed += 1;
          return;
        }
        if (q.state === "completed") {
          counts.succeeded += 1;
          // A recovered old receipt is not fresh healthy capture evidence.
          if (component && q.historicalReceipt === false)
            await recordHealthCheck(admin, {
              tenantId,
              component,
              status: "healthy",
              metadata: { job_type: jobType, records: r.recordsProcessed ?? 0 },
            });
        } else {
          counts.dead_lettered += 1;
          if (component)
            await recordHealthCheck(admin, {
              tenantId,
              component,
              status: "failed",
              error: r.error?.message ?? "Email capture requires review.",
              metadata: { job_type: jobType, code: r.error?.code ?? "capture_failed" },
            });
        }
        return;
      }
      if (
        durableEmail &&
        !["learn_capture_paused", "learn_capture_unavailable"].includes(r.error?.code ?? "")
      ) {
        counts.unconfirmed += 1;
        return;
      }
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
              connectorId:
                r.continuation.connectorId ?? (job.connector_id as string | null) ?? null,
              moduleId: r.continuation.moduleId ?? (job.module_id as string | null) ?? null,
              priority: r.continuation.priority ?? 50,
              payload: r.continuation.payload ?? {},
              availableAt: r.continuation.availableAt,
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
      if (
        captureSource &&
        ["learn_capture_paused", "learn_capture_unavailable"].includes(r.error?.code ?? "")
      ) {
        await deferCaptureJob(
          admin,
          captureClaim,
          r.error?.code === "learn_capture_paused" ? "paused" : "unavailable",
        );
        counts.waiting += 1;
        return;
      }
      const hOutcome = await failJob(
        admin,
        { id, attempt, maxAttempts },
        {
          errorCode: r.error?.code ?? "handler_error",
          message: r.error?.message ?? "handler failed",
          retryable: r.error?.retryable ?? true,
          retryAfterSeconds: r.error?.retryAfterSeconds,
        },
      );
      if (component)
        await recordHealthCheck(admin, {
          tenantId,
          component,
          status: hOutcome === "retrying" ? "degraded" : "failed",
          error: r.error?.message ?? "handler failed",
          metadata: {
            job_type: jobType,
            code: r.error?.code ?? "handler_error",
            outcome: hOutcome,
          },
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

  const failed =
    counts.claimed -
    counts.succeeded -
    counts.retrying -
    counts.dead_lettered -
    counts.waiting -
    counts.unconfirmed;
  return json({
    success: failed === 0 && counts.unconfirmed === 0,
    claimed: counts.claimed,
    succeeded: counts.succeeded,
    waiting: counts.waiting,
    unconfirmed: counts.unconfirmed,
    retrying: counts.retrying,
    dead_lettered: counts.dead_lettered,
    failed: Math.max(0, failed),
    duration_ms: Date.now() - startedMs,
  });
});
