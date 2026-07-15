// Remote Verification Harness — pure core.
//
// Everything here is PURE and dependency-free (no @supabase/supabase-js, no network,
// no filesystem, no real clock) so it is fully unit-testable with injected mocks. The
// impure client + suites live elsewhere. Secrets are handled by value only so they can
// be redacted; they are never persisted.

// ── Environment ─────────────────────────────────────────────────────────────

export interface VerifyEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  projectRef: string | null;
  workerSecret: string | null;
  /** The project ref this harness is ALLOWED to touch (safety allowlist). */
  allowProjectRef: string | null;
  /** Default tenant for controlled fixtures (harness-only default, never product). */
  tenantId: string;
  ci: boolean;
}

export const DEFAULT_VERIFY_TENANT = "00000000-0000-0000-0000-000000000001";

/** Minimal dotenv parser (no dependency). Ignores comments/blank lines; strips
 *  surrounding quotes; keeps values verbatim otherwise. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export interface ResolveEnvResult {
  ok: boolean;
  env?: VerifyEnv;
  missing: string[];
}

/** Resolve + validate the harness environment from a plain source map (process.env
 *  merged with a dotenv file). Returns the missing REQUIRED names on failure — the
 *  caller prints a clear setup error. Never throws, never logs. */
export function resolveEnv(source: Record<string, string | undefined>): ResolveEnvResult {
  const get = (k: string) => {
    const v = source[k];
    return typeof v === "string" && v.length > 0 ? v : null;
  };
  const supabaseUrl = get("SUPABASE_URL");
  const serviceRoleKey = get("SUPABASE_SERVICE_ROLE_KEY");
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    missing: [],
    env: {
      supabaseUrl: supabaseUrl as string,
      serviceRoleKey: serviceRoleKey as string,
      projectRef: get("SUPABASE_PROJECT_REF") ?? projectRefFromUrl(supabaseUrl as string),
      workerSecret: get("WORKER_SECRET"),
      allowProjectRef: get("VERIFY_ALLOW_PROJECT_REF"),
      tenantId: get("VERIFY_TENANT") ?? DEFAULT_VERIFY_TENANT,
      ci: get("VERIFY_CI") === "true",
    },
  };
}

/**
 * Merge a `.env.verify` file map with process.env SAFELY. A non-empty process value
 * overrides the file (so exported CI vars still win); an EMPTY or whitespace-only
 * process value must NOT clobber a populated file value (the bug: a blank exported
 * `SUPABASE_URL=""` was overwriting the real file value because process.env was
 * spread last). Emptiness is decided by trimming; the stored value is kept VERBATIM
 * so secrets are never corrupted.
 */
export function mergeEnv(
  fileEnv: Record<string, string>,
  processEnv: Record<string, string | undefined>,
): Record<string, string> {
  const merged: Record<string, string> = { ...fileEnv };
  for (const [k, v] of Object.entries(processEnv)) {
    if (typeof v === "string" && v.trim().length > 0) {
      merged[k] = v; // non-empty process value wins — verbatim, not trimmed
    }
    // empty / whitespace-only / undefined process values never overwrite a file value
  }
  return merged;
}

/** Derive the project ref from a Supabase URL (https://<ref>.supabase.co). */
export function projectRefFromUrl(url: string): string | null {
  const m = url.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.(?:co|in|net)/i);
  return m ? m[1] : null;
}

// ── Secret redaction ────────────────────────────────────────────────────────

/** The literal secret values this run must never emit. */
export function secretValues(env: VerifyEnv): string[] {
  return [env.serviceRoleKey, env.workerSecret].filter((s): s is string => !!s && s.length >= 8);
}

/**
 * Redact known secret VALUES from any string, and defensively mask JWT-like and long
 * bearer-token-like substrings. Deterministic and pure — used on every log/report
 * line so a key can never leak into terminal output or a result artifact.
 */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (!s) continue;
    out = out.split(s).join("«redacted-secret»");
  }
  // JWT (three base64url segments) and long opaque tokens.
  out = out.replace(
    /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    "«redacted-jwt»",
  );
  out = out.replace(/\b(service_role|sb_secret|sbp_)[A-Za-z0-9_-]{12,}\b/g, "«redacted-token»");
  return out;
}

/** Recursively redact secrets from a JSON-serialisable value (for result artifacts). */
export function redactDeep(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return redact(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, secrets));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // Drop obviously-sensitive keys entirely.
      if (/service_role|secret|password|credential|apikey|api_key|authorization/i.test(k)) {
        out[k] = "«redacted»";
        continue;
      }
      out[k] = redactDeep(v, secrets);
    }
    return out;
  }
  return value;
}

// ── Run identity + fixture tagging ──────────────────────────────────────────

/** Deterministic verification run id (given injected randomness + clock). */
export function newRunId(rand: () => string, nowIso: string): string {
  const day = nowIso.slice(0, 10).replace(/-/g, "");
  return `verify-${day}-${rand().slice(0, 8)}`;
}

export const VERIFY_SOURCE = "remote-verification-harness";

/** The tag stamped into every controlled fixture (parameters/settings/metadata). */
export function fixtureTag(runId: string): Record<string, unknown> {
  return { verification: true, verification_run_id: runId, source: VERIFY_SOURCE };
}

/** True iff a row is a verification fixture (optionally for a specific run). */
export function isVerificationFixture(
  bag: Record<string, unknown> | null | undefined,
  runId?: string,
): boolean {
  if (!bag || typeof bag !== "object") return false;
  if (bag.source !== VERIFY_SOURCE && bag.verification !== true) return false;
  if (runId && bag.verification_run_id !== runId) return false;
  return true;
}

// ── Cleanup scoping ─────────────────────────────────────────────────────────

/** Tables whose rows are IMMUTABLE audit facts — never deleted by cleanup; their
 *  ids are reported as retained instead. */
export const IMMUTABLE_TABLES: ReadonlySet<string> = new Set([
  "automation_execution_attempts",
  "automation_execution_guard_decisions",
  "automation_approvals",
  "outcomes",
  "objective_health",
  "objective_contribution_assessments",
  "measurements",
  "decision_log",
  "object_state_history",
]);

/** Cleanup may delete from a table only if it is not an immutable audit table. */
export function isCleanupSafe(table: string): boolean {
  return !IMMUTABLE_TABLES.has(table);
}

/**
 * IMMUTABLE audit tables that anchor to a platform_jobs row via a `job_id` FK. A
 * platform job referenced by any of these is LINEAGE — deleting it would either
 * violate the FK or require cascading an immutable audit row, both forbidden. Such
 * a job is classified `retained`, never `deleted`/`cleanup_failed`. Every table here
 * MUST also be in IMMUTABLE_TABLES (asserted in the harness tests). */
export const IMMUTABLE_JOB_REFERENCE_TABLES: ReadonlyArray<{ table: string; column: string }> = [
  { table: "automation_execution_guard_decisions", column: "job_id" },
  { table: "objective_health", column: "job_id" },
  { table: "objective_contribution_assessments", column: "job_id" },
];

// ── Project allowlist ───────────────────────────────────────────────────────

/**
 * Mutation is permitted ONLY when SUPABASE_PROJECT_REF exactly equals
 * VERIFY_ALLOW_PROJECT_REF. There is NO `--confirm-project` bypass for an unknown or
 * mismatched project — the exact match is a hard gate. `--confirm-project` (or
 * VERIFY_CI=true) is an ADDITIONAL acknowledgement on top of the match, never a way
 * around it. This must be checked BEFORE the client is created.
 */
export function projectAllowed(
  env: VerifyEnv,
  confirmFlag: boolean,
): { ok: boolean; reason: string } {
  if (!env.allowProjectRef) {
    return {
      ok: false,
      reason: "VERIFY_ALLOW_PROJECT_REF is not set — refusing to mutate an unconfirmed project",
    };
  }
  if (!env.projectRef || env.projectRef !== env.allowProjectRef) {
    return {
      ok: false,
      reason: `project ${env.projectRef ?? "?"} ≠ allowlisted ${env.allowProjectRef} — refusing (no --confirm-project bypass)`,
    };
  }
  if (!confirmFlag && !env.ci) {
    return {
      ok: false,
      reason: `project ${env.projectRef} matches the allowlist; pass --confirm-project (or set VERIFY_CI=true) to acknowledge mutation`,
    };
  }
  return {
    ok: true,
    reason: `project ${env.projectRef} matches allowlist and mutation acknowledged`,
  };
}

// ── Failure-safe control flow (restoration always runs) ─────────────────────

export interface GuardedOutcome {
  bodyThrew: boolean;
  bodyError: string | null;
  finallyThrew: boolean;
  finallyError: string | null;
}

/**
 * Run `body`, then ALWAYS run `onFinally` — even if `body` throws, rejects, or the
 * job polling times out (which surfaces as a thrown/rejected body). Errors from each
 * are captured separately so a cleanup failure is reported, never swallowed.
 */
export async function runGuarded(
  body: () => Promise<void>,
  onFinally: () => Promise<void>,
): Promise<GuardedOutcome> {
  const out: GuardedOutcome = {
    bodyThrew: false,
    bodyError: null,
    finallyThrew: false,
    finallyError: null,
  };
  try {
    await body();
  } catch (e) {
    out.bodyThrew = true;
    out.bodyError = e instanceof Error ? e.message : String(e);
  } finally {
    try {
      await onFinally();
    } catch (e) {
      out.finallyThrew = true;
      out.finallyError = e instanceof Error ? e.message : String(e);
    }
  }
  return out;
}

// ── Mutating-run lease (pure decision logic; the SQL RPC enforces atomically) ─

export interface LeaseRow {
  verification_run_id: string;
  expires_at: string;
  released_at: string | null;
}

export interface LockPlan {
  acquired: boolean;
  reclaimedExpired: boolean;
  holder: string | null;
  reason: string;
}

/** Decide whether THIS run may acquire the tenant+suite lease, given the current
 *  active lease (if any). Mirrors verification_acquire_lock — kept pure for tests. */
export function planLockAcquire(active: LeaseRow | null, nowMs: number, myRunId: string): LockPlan {
  if (!active || active.released_at) {
    return { acquired: true, reclaimedExpired: false, holder: myRunId, reason: "no active lease" };
  }
  const exp = Date.parse(active.expires_at);
  if (!Number.isNaN(exp) && exp < nowMs) {
    return {
      acquired: true,
      reclaimedExpired: true,
      holder: myRunId,
      reason: "reclaimed expired lease",
    };
  }
  if (active.verification_run_id === myRunId) {
    return {
      acquired: true,
      reclaimedExpired: false,
      holder: myRunId,
      reason: "already held by this run",
    };
  }
  return {
    acquired: false,
    reclaimedExpired: false,
    holder: active.verification_run_id,
    reason: `held by ${active.verification_run_id}`,
  };
}

/** Only the owning run may release the lease (a wrong run id cannot release it). */
export function canReleaseLock(active: LeaseRow | null, myRunId: string): boolean {
  return !!active && active.released_at == null && active.verification_run_id === myRunId;
}

/** Dry-run never takes a lock; only mutating, live runs do. */
export function shouldAcquireLock(mutating: boolean, dryRun: boolean): boolean {
  return mutating && !dryRun;
}

/** The outcome of attempting to acquire the lease. An `ok:false` is an
 *  INFRASTRUCTURE failure (the RPC threw); it is NOT contention. */
export type LockAttempt =
  { ok: true; acquired: boolean; holder: string | null } | { ok: false; error: string };

export interface LockClassification {
  proceed: boolean;
  failure: "infra" | "contended" | null;
  message: string;
}

/**
 * Classify a lock-acquire attempt. A thrown RPC error is reported as a **lock
 * infrastructure failure** (abort before mutation — never infer contention); a clean
 * `acquired:false` is genuine contention. This fixes the misleading double message
 * where an ambiguous-column RPC error was reported as "another run holds the lease".
 */
export function classifyLockAttempt(attempt: LockAttempt, suite: string): LockClassification {
  if (!attempt.ok) {
    return {
      proceed: false,
      failure: "infra",
      message: `lock infrastructure failure — aborting before mutation: ${attempt.error}`,
    };
  }
  if (!attempt.acquired) {
    return {
      proceed: false,
      failure: "contended",
      message: `another verification run holds the '${suite}' lease (holder=${attempt.holder ?? "?"}) — refusing concurrent mutating run`,
    };
  }
  return { proceed: true, failure: null, message: `acquired the '${suite}' lease` };
}

// ── CLI argument parsing ────────────────────────────────────────────────────

export interface CliArgs {
  suite: string;
  dryRun: boolean;
  confirmProject: boolean;
  json: boolean;
  tenant: string | null;
}

const SUITES = new Set(["remote", "automation", "objectives", "intelligence", "all"]);

export function parseArgs(argv: string[]): CliArgs {
  let suite = "remote";
  let dryRun = false;
  let confirmProject = false;
  let json = false;
  let tenant: string | null = null;
  for (const a of argv) {
    if (SUITES.has(a)) suite = a;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--confirm-project") confirmProject = true;
    else if (a === "--json") json = true;
    else if (a.startsWith("--tenant=")) tenant = a.slice("--tenant=".length);
  }
  return { suite, dryRun, confirmProject, json, tenant };
}

// ── Bounded job polling (DI: no real clock/network) ─────────────────────────

export interface PolledJob {
  status: string;
  error_code?: string | null;
  last_error?: string | null;
  result?: unknown;
  attempt_count?: number;
  claimed_by?: string | null;
  lease_expires_at?: string | null;
}

export interface PollOptions {
  timeoutMs: number;
  intervalMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  onTick?: (elapsedMs: number, status: string) => void;
}

const TERMINAL_JOB_STATES = new Set(["succeeded", "dead_letter", "cancelled"]);

export interface PollResult {
  done: boolean;
  timedOut: boolean;
  job: PolledJob | null;
  ticks: number;
}

/**
 * Poll a job to a terminal state (succeeded / dead_letter / cancelled) with a bounded
 * timeout — never an infinite loop. `fetchJob` is injected, so this is fully testable
 * without a database. Returns the last observed job, whether it finished, and whether
 * it timed out.
 */
export async function pollJob(
  fetchJob: () => Promise<PolledJob | null>,
  opts: PollOptions,
): Promise<PollResult> {
  const start = opts.now();
  let ticks = 0;
  // Hard iteration cap as a second guard against a mis-injected clock.
  const maxTicks = Math.max(1, Math.ceil(opts.timeoutMs / Math.max(1, opts.intervalMs)) + 2);
  let last: PolledJob | null = null;
  while (ticks < maxTicks) {
    last = await fetchJob();
    ticks++;
    const status = last?.status ?? "unknown";
    opts.onTick?.(opts.now() - start, status);
    if (last && TERMINAL_JOB_STATES.has(last.status)) {
      return { done: true, timedOut: false, job: last, ticks };
    }
    if (opts.now() - start >= opts.timeoutMs) {
      return { done: false, timedOut: true, job: last, ticks };
    }
    await opts.sleep(opts.intervalMs);
  }
  return { done: false, timedOut: true, job: last, ticks };
}

// ── Platform job lifecycle (harness view) ────────────────────────────────────
//
// The DB job row is the SOURCE OF TRUTH. The harness never infers job state from
// the worker's HTTP response — it invokes the worker to make progress, then reads
// platform_jobs. These helpers give the harness a controlled lifecycle so an
// assertion can never print `status=undefined`.

/** Queue statuses from which the worker can still make progress. */
export function isActiveJobStatus(status: string | null | undefined): boolean {
  return status === "queued" || status === "running" || status === "retrying";
}

/** Queue statuses the harness treats as terminal (no further progress). */
export function isTerminalJobStatus(status: string | null | undefined): boolean {
  return (
    status === "succeeded" ||
    status === "dead_letter" ||
    status === "cancelled" ||
    status === "failed"
  );
}

/** The full, closed set of job classifications the harness can report. Never a
 *  free-form/undefined value — every assertion label comes from here. */
export type JobLifecycle =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "dead_letter"
  | "cancelled"
  | "timed_out"
  | "infrastructure_error";

/** The controlled terminal result of driving one job to completion (or timeout /
 *  infrastructure failure). Carries the full last-known DB state for diagnostics. */
export interface JobTerminalResult {
  classification: JobLifecycle;
  jobId: string | null;
  jobKey: string;
  reused: boolean;
  dbStatus: string | null;
  attemptCount: number | null;
  claimedBy: string | null;
  leaseExpiresAt: string | null;
  lastError: string | null;
  errorCode: string | null;
  /** The persisted platform_jobs.result payload (handler outcome — source of truth). */
  result: unknown;
  workerHttpStatus: number | null;
  workerBody: string | null;
}

/**
 * Classify the outcome of driving a job. Precedence: a non-2xx worker invocation
 * (or a job that could not be enqueued/read) is an INFRASTRUCTURE failure; a DB
 * terminal status wins next; otherwise a timeout is `timed_out` and a still-active
 * status is surfaced verbatim. Pure + total — the return is never undefined.
 */
export function classifyJob(
  job: PolledJob | null,
  timedOut: boolean,
  workerFailed: boolean,
): JobLifecycle {
  if (workerFailed) return "infrastructure_error";
  if (!job) return "infrastructure_error";
  switch (job.status) {
    case "succeeded":
      return "succeeded";
    case "dead_letter":
      return "dead_letter";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
  }
  if (timedOut) return "timed_out";
  if (job.status === "running") return "running";
  return "queued";
}

/** Assemble a JobTerminalResult from the last-known job + worker invocation. */
export function buildJobResult(args: {
  classification: JobLifecycle;
  jobId: string | null;
  jobKey: string;
  reused: boolean;
  job: PolledJob | null;
  worker: WorkerInvocation | null;
}): JobTerminalResult {
  const j = args.job;
  return {
    classification: args.classification,
    jobId: args.jobId,
    jobKey: args.jobKey,
    reused: args.reused,
    dbStatus: j?.status ?? null,
    attemptCount: j?.attempt_count ?? null,
    claimedBy: j?.claimed_by ?? null,
    leaseExpiresAt: j?.lease_expires_at ?? null,
    lastError: j?.last_error ?? null,
    errorCode: j?.error_code ?? null,
    result: j?.result ?? null,
    workerHttpStatus: args.worker?.status ?? null,
    workerBody: args.worker?.body ?? null,
  };
}

/** A stable, non-undefined status label for assertion details. */
export function jobStatusLabel(r: JobTerminalResult | null | undefined): string {
  return r?.classification ?? "infrastructure_error";
}

/** The handler outcome persisted on platform_jobs.result (e.g. blocked/succeeded/
 *  already_completed). Read from the DB row — never from the worker HTTP response. */
export function handlerOutcome(r: JobTerminalResult | null | undefined): Record<string, unknown> {
  const res = r?.result;
  return res && typeof res === "object" ? (res as Record<string, unknown>) : {};
}

/** Full diagnostic line for a non-terminal / infrastructure outcome — includes the
 *  last known DB job state AND the worker HTTP status + sanitized body. */
export function describeJobResult(r: JobTerminalResult): string {
  return [
    `classification=${r.classification}`,
    `jobId=${r.jobId ?? "?"}`,
    `jobKey=${r.jobKey}`,
    `dbStatus=${r.dbStatus ?? "?"}`,
    `attempt_count=${r.attemptCount ?? "?"}`,
    `claimed_by=${r.claimedBy ?? "?"}`,
    `lease_expires_at=${r.leaseExpiresAt ?? "?"}`,
    `error_code=${r.errorCode ?? "?"}`,
    `last_error=${r.lastError ?? "?"}`,
    `worker_http=${r.workerHttpStatus ?? "?"}`,
    `worker_body=${r.workerBody ?? "?"}`,
  ].join(" ");
}

/**
 * The Discovery-mode block proof, computed from PERSISTED DB state ONLY (never the
 * worker HTTP response shape). A genuine block requires: the intent still pending,
 * zero execution attempts, zero outcomes, AND at least one guard BLOCK record — the
 * last clause distinguishes a real guard block from a job that simply never ran
 * (which would also leave the intent pending with zero attempts). Pure + testable.
 */
export function discoveryBlocked(state: {
  intentStatus: string | null | undefined;
  attempts: number;
  outcomes: number;
  blockGuards: number;
}): boolean {
  return (
    state.intentStatus === "pending" &&
    state.attempts === 0 &&
    state.outcomes === 0 &&
    state.blockGuards >= 1
  );
}

// ── Worker invocation contract (matches the deployed platform-worker) ─────────
//
// The deployed contract (see supabase/functions/platform-worker/index.ts and the
// cron in 20260709180000_scheduler_cron.sql): POST, JSON body { batch_size, job_types? },
// authenticated by the shared `x-schedule-secret` header == WORKER_SECRET. There is
// NO Authorization/apikey header (the function is deployed verify_jwt=false). The
// secret is a header VALUE only — it is never placed in the URL, the body, or logs.

export interface WorkerRequestSpec {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

/** Build the exact HTTP request the deployed platform-worker expects. Pure +
 *  testable. Throws if the secret is absent (the harness cannot invoke without it). */
export function workerRequest(
  env: { supabaseUrl: string; workerSecret: string | null },
  jobTypes?: string[] | null,
): WorkerRequestSpec {
  if (!env.workerSecret) {
    throw new Error("WORKER_SECRET is required to invoke the platform-worker");
  }
  const list = Array.isArray(jobTypes) ? jobTypes.filter((t) => typeof t === "string") : null;
  return {
    url: `${env.supabaseUrl}/functions/v1/platform-worker`,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-schedule-secret": env.workerSecret,
    },
    body: JSON.stringify({ batch_size: 5, ...(list && list.length ? { job_types: list } : {}) }),
  };
}

/** The captured result of one worker invocation. `body` is a truncated snippet of
 *  the response (redacted at the reporting layer); it is diagnostic only and is
 *  NEVER used to infer job state. */
export interface WorkerInvocation {
  ok: boolean;
  status: number;
  body: string | null;
}

/** A worker HTTP response is an infrastructure failure iff it is not 2xx. */
export function classifyWorkerInvocation(status: number): { ok: boolean; infrastructure: boolean } {
  const ok = Number.isFinite(status) && status >= 200 && status < 300;
  return { ok, infrastructure: !ok };
}

// ── Deterministic per-stage job keys ─────────────────────────────────────────

/** Deterministic, run-scoped job key for one verification stage. The `verify:<run>:`
 *  prefix makes run-scoped cleanup exact (see planRunJobCleanup). Each stage gets a
 *  DISTINCT key so stages never collide on platform_jobs_active_job_key_uk and a
 *  genuinely new stage (e.g. idempotency-retry) is a genuinely new job. */
export function stageJobKey(runId: string, suite: string, stage: string): string {
  return `verify:${runId}:${suite}:${stage}`;
}

// ── Enqueue-once / poll-the-same-job orchestration (DI: no clock/network) ─────

/** Injected effects for processJobStage — real ones in client/suites, fakes in tests. */
export interface StageDeps {
  /** Enqueue exactly one job for `jobKey`. On an active-duplicate it MUST resolve the
   *  existing active job's id and return { duplicate: true } — never insert twice. */
  enqueue: (
    jobKey: string,
  ) => Promise<{ id: string | null; duplicate: boolean; error: string | null }>;
  /** Invoke the deployed worker (captures HTTP status + sanitized body). */
  invokeWorker: () => Promise<WorkerInvocation>;
  /** Read the authoritative job row BY ID (never by key — the key can be reused). */
  readJob: (id: string) => Promise<PolledJob | null>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface StageOptions {
  jobKey: string;
  timeoutMs: number;
  intervalMs: number;
}

/**
 * Enqueue ONE job, then repeatedly invoke the worker and poll THAT job id until it
 * is terminal, times out, or the worker returns a non-2xx (infrastructure error,
 * surfaced immediately). Re-invoking each cycle means a single missed claim no
 * longer guarantees a timeout — the defect behind verify-20260715-a78555ae. The
 * DB row is the source of truth; the worker response only gates infra failure.
 */
export async function processJobStage(
  deps: StageDeps,
  opts: StageOptions,
): Promise<JobTerminalResult> {
  const enq = await deps.enqueue(opts.jobKey);
  if (!enq.id) {
    // Could not enqueue OR resolve an existing active job → infrastructure error.
    return buildJobResult({
      classification: "infrastructure_error",
      jobId: null,
      jobKey: opts.jobKey,
      reused: enq.duplicate,
      job: null,
      worker: enq.error ? { ok: false, status: 0, body: enq.error } : null,
    });
  }
  const jobId = enq.id;
  const start = deps.now();
  const interval = Math.max(1, opts.intervalMs);
  const maxTicks = Math.max(1, Math.ceil(opts.timeoutMs / interval) + 2);

  let job: PolledJob | null = null;
  let worker: WorkerInvocation | null = null;
  let workerFailed = false;
  let timedOut = false;
  let ticks = 0;

  while (ticks < maxTicks) {
    worker = await deps.invokeWorker();
    ticks++;
    if (!worker.ok) {
      workerFailed = true; // non-2xx ⇒ infrastructure failure, immediately
      break;
    }
    job = await deps.readJob(jobId); // poll BY ID
    if (job && isTerminalJobStatus(job.status)) break;
    if (deps.now() - start >= opts.timeoutMs) {
      timedOut = true;
      break;
    }
    await deps.sleep(interval);
  }
  if (!workerFailed && !timedOut && !(job && isTerminalJobStatus(job.status))) {
    timedOut = true; // exhausted maxTicks without a terminal state
  }

  return buildJobResult({
    classification: classifyJob(job, timedOut, workerFailed),
    jobId,
    jobKey: opts.jobKey,
    reused: enq.duplicate,
    job,
    worker,
  });
}

// ── Run-scoped platform-job cleanup planning ─────────────────────────────────

/** True iff a job_key belongs to this verification run (exact prefix match). */
export function isRunJobKey(jobKey: string | null | undefined, runId: string): boolean {
  return typeof jobKey === "string" && jobKey.startsWith(`verify:${runId}:`);
}

export interface RunJobRow {
  id: string;
  job_key: string | null;
  status: string;
  /** True iff an IMMUTABLE audit row references this job (see
   *  IMMUTABLE_JOB_REFERENCE_TABLES). Such a job is retained, never deleted. */
  hasImmutableLineage?: boolean;
}

export interface RunJobCleanupPlan {
  /** Active jobs (with NO immutable lineage) to cancel through the lifecycle before deleting. */
  cancel: string[];
  /** Mutable run-owned jobs safe to remove (no immutable audit references them). */
  delete: string[];
  /** Run-owned jobs anchoring immutable audit lineage — kept for history (never deleted). */
  retain: string[];
  /** Jobs left untouched because they do NOT belong to this run. */
  skip: string[];
}

/**
 * Decide cleanup for a set of platform_jobs, scoped STRICTLY to this run's key
 * prefix. Classification:
 *   • not owned by the run          → skip (never touched)
 *   • owned + immutable lineage      → retain (required for audit; never cancelled/deleted)
 *   • owned + mutable (no lineage)   → delete (cancel first if still active)
 * Pure — the caller performs the DB writes and reports the ids. A job that anchors
 * an immutable guard-decision / outcome / attempt is retained so the FK protecting
 * that audit history is never violated (the cause of the cleanup FAIL).
 */
export function planRunJobCleanup(jobs: RunJobRow[], runId: string): RunJobCleanupPlan {
  const plan: RunJobCleanupPlan = { cancel: [], delete: [], retain: [], skip: [] };
  for (const j of jobs) {
    if (!isRunJobKey(j.job_key, runId)) {
      plan.skip.push(j.id);
      continue;
    }
    if (j.hasImmutableLineage) {
      plan.retain.push(j.id); // immutable lineage — keep for audit/history
      continue;
    }
    if (isActiveJobStatus(j.status)) plan.cancel.push(j.id);
    plan.delete.push(j.id);
  }
  return plan;
}

/** The one-time remediation target from the failed live run (see the suite's
 *  preflight). Cleared idempotently; safe to leave in place after it is gone. */
export const LEGACY_STUCK_RUN = "verify-20260715-a78555ae";

// ── Result model + reporting ────────────────────────────────────────────────

export interface AssertionResult {
  name: string;
  ok: boolean;
  detail?: string;
}
export interface FixtureRef {
  kind: string;
  id: string;
  table?: string;
}

/** How every controlled fixture ended the run. */
export type FixtureDisposition = "restored" | "deleted" | "retained" | "cleanup_failed";
export interface DispositionRef {
  kind: string;
  id: string;
  disposition: FixtureDisposition;
  detail?: string;
}

export interface SuiteReport {
  runId: string;
  suite: string;
  projectRef: string | null;
  tenantId: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  assertions: AssertionResult[];
  fixtures: FixtureRef[];
  retainedAudit: FixtureRef[];
  dispositions: DispositionRef[];
  cleanup: { restored: number; deleted: number; retained: number; failed: number; status: string };
  errors: string[];
  passed: boolean;
}

/** Collects assertions/fixtures/errors for one suite run. Pure state container. */
export class VerificationRun {
  readonly report: SuiteReport;
  constructor(init: {
    runId: string;
    suite: string;
    projectRef: string | null;
    tenantId: string;
    dryRun: boolean;
    startedAt: string;
  }) {
    this.report = {
      ...init,
      finishedAt: null,
      assertions: [],
      fixtures: [],
      retainedAudit: [],
      dispositions: [],
      cleanup: { restored: 0, deleted: 0, retained: 0, failed: 0, status: "not_run" },
      errors: [],
      passed: false,
    };
  }
  assert(name: string, ok: boolean, detail?: string): boolean {
    this.report.assertions.push({ name, ok, detail });
    return ok;
  }
  fixture(kind: string, id: string, table?: string): void {
    this.report.fixtures.push({ kind, id, table });
  }
  retain(kind: string, id: string, table?: string): void {
    this.report.retainedAudit.push({ kind, id, table });
  }
  /** Classify how a fixture was disposed of at cleanup. */
  dispose(kind: string, id: string, disposition: FixtureDisposition, detail?: string): void {
    this.report.dispositions.push({ kind, id, disposition, detail });
  }
  error(msg: string): void {
    this.report.errors.push(msg);
  }
  finish(finishedAt: string): SuiteReport {
    this.report.finishedAt = finishedAt;
    const c = { restored: 0, deleted: 0, retained: 0, failed: 0 };
    for (const d of this.report.dispositions) {
      if (d.disposition === "restored") c.restored++;
      else if (d.disposition === "deleted") c.deleted++;
      else if (d.disposition === "retained") c.retained++;
      else if (d.disposition === "cleanup_failed") c.failed++;
    }
    this.report.cleanup = { ...c, status: this.report.cleanup.status };
    // A cleanup failure fails the suite, as does any error or failed assertion.
    this.report.passed =
      this.report.errors.length === 0 &&
      this.report.assertions.every((a) => a.ok) &&
      c.failed === 0;
    return this.report;
  }
}

/** Human-readable terminal summary (secrets already excluded by construction). */
export function renderTerminal(r: SuiteReport, secrets: string[]): string {
  const line = (s: string) => redact(s, secrets);
  const lines: string[] = [];
  lines.push(line(`▐ verification: ${r.suite}  run=${r.runId}`));
  lines.push(line(`▐ project=${r.projectRef ?? "?"}  tenant=${r.tenantId}  dryRun=${r.dryRun}`));
  for (const a of r.assertions) {
    lines.push(
      line(`  [${a.ok ? "PASS" : "FAIL"}] ${a.name}${a.detail && !a.ok ? ` — ${a.detail}` : ""}`),
    );
  }
  for (const e of r.errors) lines.push(line(`  [ERROR] ${e}`));
  if (r.retainedAudit.length > 0) {
    lines.push(
      line(
        `  retained immutable audit: ${r.retainedAudit.map((x) => `${x.kind}:${x.id}`).join(", ")}`,
      ),
    );
  }
  for (const d of r.dispositions.filter((x) => x.disposition === "cleanup_failed")) {
    lines.push(line(`  [CLEANUP-FAILED] ${d.kind}:${d.id}${d.detail ? ` — ${d.detail}` : ""}`));
  }
  lines.push(
    line(
      `  cleanup: ${r.cleanup.status} (restored=${r.cleanup.restored}, deleted=${r.cleanup.deleted}, retained=${r.cleanup.retained}, failed=${r.cleanup.failed})`,
    ),
  );
  const passed = r.assertions.filter((a) => a.ok).length;
  lines.push(line(`▐ ${r.passed ? "PASS" : "FAIL"} — ${passed}/${r.assertions.length} assertions`));
  return lines.join("\n");
}
