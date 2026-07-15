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
