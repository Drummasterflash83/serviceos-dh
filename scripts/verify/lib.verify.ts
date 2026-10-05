// Unit tests for the Remote Verification Harness pure core. No database, no network —
// everything is injected. Run: node scripts/verify/lib.verify.ts

import {
  DEFAULT_VERIFY_TENANT,
  LEGACY_STUCK_RUN,
  VerificationRun,
  buildJobResult,
  canReleaseLock,
  classifyJob,
  classifyWorkerInvocation,
  describeJobResult,
  discoveryBlocked,
  fixtureTag,
  handlerOutcome,
  isCleanupSafe,
  IMMUTABLE_JOB_REFERENCE_TABLES,
  classifyLockAttempt,
  isRunJobKey,
  isVerificationFixture,
  jobStatusLabel,
  mergeEnv,
  newRunId,
  parseArgs,
  parseDotenv,
  planLockAcquire,
  planRunJobCleanup,
  pollJob,
  processJobStage,
  projectAllowed,
  projectRefFromUrl,
  redact,
  redactDeep,
  renderTerminal,
  resolveEnv,
  runGuarded,
  secretValues,
  shouldAcquireLock,
  stageJobKey,
  workerRequest,
  type JobTerminalResult,
  type LeaseRow,
  type PolledJob,
  type StageDeps,
  type VerifyEnv,
  type WorkerInvocation,
} from "./lib.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) failures++;
  console.log(
    `  [${cond ? "PASS" : "FAIL"}] ${name}${!cond ? ` — got ${JSON.stringify(detail)}` : ""}`,
  );
}

const SR = "service_role.aaaaaaaaaa.bbbbbbbbbb.cccccccccc";
const WS = "worker-secret-abcdef1234567890";

// ── Environment validation ──────────────────────────────────────────────────
console.log("Environment:");
const bad = resolveEnv({});
check(
  "missing required vars are reported",
  !bad.ok &&
    bad.missing.includes("SUPABASE_URL") &&
    bad.missing.includes("SUPABASE_SERVICE_ROLE_KEY"),
);
const good = resolveEnv({
  SUPABASE_URL: "https://abcdxyz.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SR,
  WORKER_SECRET: WS,
});
check(
  "valid env resolves",
  good.ok === true && good.env?.supabaseUrl === "https://abcdxyz.supabase.co",
);
check("project ref derived from url", good.env?.projectRef === "abcdxyz");
check("default tenant applied", good.env?.tenantId === DEFAULT_VERIFY_TENANT);
check(
  "VERIFY_CI flag parsed",
  resolveEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: SR,
    VERIFY_CI: "true",
  }).env?.ci === true,
);
check(
  "projectRefFromUrl",
  projectRefFromUrl("https://zzzz.supabase.co") === "zzzz" &&
    projectRefFromUrl("http://localhost") === null,
);

// ── Environment merge (file vs process.env; blank process must not clobber) ──
console.log("Environment merge:");
check(
  "populated file value survives a BLANK process value",
  mergeEnv({ SUPABASE_URL: "https://real.supabase.co" }, { SUPABASE_URL: "" }).SUPABASE_URL ===
    "https://real.supabase.co",
);
check(
  "populated process value overrides file value",
  mergeEnv({ A: "file" }, { A: "proc" }).A === "proc",
);
check("missing file value is supplied by process value", mergeEnv({}, { A: "proc" }).A === "proc");
check(
  "whitespace-only process value does NOT overwrite file value",
  mergeEnv({ A: "file" }, { A: "   " }).A === "file",
);
check(
  "secret is preserved EXACTLY (blank process, verbatim value)",
  mergeEnv({ SUPABASE_SERVICE_ROLE_KEY: SR }, { SUPABASE_SERVICE_ROLE_KEY: "" })
    .SUPABASE_SERVICE_ROLE_KEY === SR &&
    mergeEnv({}, { SUPABASE_SERVICE_ROLE_KEY: SR }).SUPABASE_SERVICE_ROLE_KEY === SR,
);
check(
  "undefined process value never overwrites file value",
  mergeEnv({ A: "file" }, { A: undefined }).A === "file",
);
check(
  "exported CI var (file absent) is carried through",
  mergeEnv(
    { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SR },
    { VERIFY_CI: "true" },
  ).VERIFY_CI === "true",
);
check(
  "dry-run/live: file env resolves despite blank exported values (the bug)",
  resolveEnv(
    mergeEnv(
      { SUPABASE_URL: "https://real.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SR },
      { SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", WORKER_SECRET: "" },
    ),
  ).ok === true,
);

console.log("Dotenv parsing:");
const parsed = parseDotenv(
  `# comment\nSUPABASE_URL=https://a.supabase.co\nSUPABASE_SERVICE_ROLE_KEY="quoted-secret"\n\nEMPTY=\n`,
);
check(
  "parses keys, strips quotes, skips comments/blanks",
  parsed.SUPABASE_URL === "https://a.supabase.co" &&
    parsed.SUPABASE_SERVICE_ROLE_KEY === "quoted-secret",
);

// ── Secret redaction ────────────────────────────────────────────────────────
console.log("Secret redaction:");
const env: VerifyEnv = good.env!;
const secrets = secretValues({ ...env, workerSecret: WS });
check("secret value is redacted in text", !redact(`key=${SR} tail`, secrets).includes(SR));
check("worker secret is redacted", !redact(`hdr ${WS}`, secrets).includes(WS));
check(
  "JWT-shaped token is masked",
  redact("Bearer aaaaaaaaaa.bbbbbbbbbb.cccccccccc", []).includes("«redacted-jwt»"),
);
const deep = redactDeep(
  { ok: true, service_role_key: SR, nested: { note: `has ${WS}` } },
  secrets,
) as Record<string, unknown>;
check("redactDeep drops sensitive keys", deep.service_role_key === "«redacted»");
check("redactDeep redacts secret values in nested strings", !JSON.stringify(deep).includes(WS));

// ── Run id + fixture tagging ────────────────────────────────────────────────
console.log("Run id + fixtures:");
const rid = newRunId(() => "abcd1234ef", "2026-07-15T10:00:00Z");
check("run id is deterministic + tagged", rid === "verify-20260715-abcd1234");
const tag = fixtureTag(rid);
check(
  "fixture tag carries run id + source",
  tag.verification_run_id === rid && tag.source === "remote-verification-harness",
);
check(
  "identifies own fixture",
  isVerificationFixture(tag as Record<string, unknown>, rid) === true,
);
check(
  "rejects other run's fixture",
  isVerificationFixture(fixtureTag("verify-other") as Record<string, unknown>, rid) === false,
);
check("rejects non-fixture", isVerificationFixture({ foo: 1 }, rid) === false);

// ── Cleanup scoping ─────────────────────────────────────────────────────────
console.log("Cleanup scoping:");
check(
  "immutable audit tables are never cleanup-safe",
  !isCleanupSafe("outcomes") &&
    !isCleanupSafe("automation_execution_attempts") &&
    !isCleanupSafe("objective_health"),
);
check(
  "mutable fixture tables are cleanup-safe",
  isCleanupSafe("automation_intents") &&
    isCleanupSafe("tenant_connectors") &&
    isCleanupSafe("config_versions"),
);

// ── Project allowlist (exact match required; no --confirm-project bypass) ────
console.log("Project allowlist:");
check(
  "missing allowlist ⇒ refused even with --confirm-project",
  projectAllowed({ ...env, allowProjectRef: null, projectRef: "abcdxyz", ci: false }, true).ok ===
    false,
);
check(
  "mismatched project ref ⇒ refused (no bypass)",
  projectAllowed({ ...env, allowProjectRef: "prod", projectRef: "abcdxyz", ci: false }, true).ok ===
    false,
);
check(
  "matching allowlist WITHOUT acknowledgement ⇒ refused",
  projectAllowed({ ...env, allowProjectRef: "abcdxyz", projectRef: "abcdxyz", ci: false }, false)
    .ok === false,
);
check(
  "matching allowlist + --confirm-project ⇒ allowed",
  projectAllowed({ ...env, allowProjectRef: "abcdxyz", projectRef: "abcdxyz", ci: false }, true)
    .ok === true,
);
check(
  "matching allowlist + VERIFY_CI ⇒ allowed (non-interactive)",
  projectAllowed({ ...env, allowProjectRef: "abcdxyz", projectRef: "abcdxyz", ci: true }, false)
    .ok === true,
);

// ── Arg parsing ─────────────────────────────────────────────────────────────
console.log("Arg parsing:");
check(
  "parses suite + flags",
  (() => {
    const a = parseArgs(["automation", "--dry-run", "--confirm-project", "--tenant=T"]);
    return a.suite === "automation" && a.dryRun && a.confirmProject && a.tenant === "T";
  })(),
);
check(
  "defaults to remote, no flags",
  (() => {
    const a = parseArgs([]);
    return a.suite === "remote" && !a.dryRun && !a.confirmProject;
  })(),
);

// ── Polling (bounded, DI clock) ─────────────────────────────────────────────
console.log("Job polling:");
async function polling() {
  // succeeds on the 3rd fetch
  let n = 0;
  const seq = ["queued", "running", "succeeded"];
  let t = 0;
  const r1 = await pollJob(async () => ({ status: seq[Math.min(n++, seq.length - 1)] }), {
    timeoutMs: 10000,
    intervalMs: 100,
    now: () => (t += 100),
    sleep: async () => {},
  });
  check("resolves on terminal success", r1.done && !r1.timedOut && r1.job?.status === "succeeded");

  // times out if never terminal (bounded — no infinite loop)
  let t2 = 0;
  const r2 = await pollJob(async () => ({ status: "running" }), {
    timeoutMs: 500,
    intervalMs: 100,
    now: () => (t2 += 100),
    sleep: async () => {},
  });
  check("times out (bounded) when never terminal", !r2.done && r2.timedOut);

  // dead_letter is terminal, surfaces error_code/last_error
  let t3 = 0;
  const r3 = await pollJob(
    async () => ({ status: "dead_letter", error_code: "boom", last_error: "bad" }),
    {
      timeoutMs: 1000,
      intervalMs: 100,
      now: () => (t3 += 100),
      sleep: async () => {},
    },
  );
  check(
    "dead_letter is terminal with error surfaced",
    r3.done && r3.job?.error_code === "boom" && r3.job?.last_error === "bad",
  );
}

// ── Reporting + dry-run flag ────────────────────────────────────────────────
console.log("Reporting:");
const run = new VerificationRun({
  runId: rid,
  suite: "automation",
  projectRef: "abcdxyz",
  tenantId: DEFAULT_VERIFY_TENANT,
  dryRun: true,
  startedAt: "2026-07-15T10:00:00Z",
});
run.assert("a1", true);
run.assert("a2", false, `token ${WS} in detail`);
run.fixture("automation_intent", "11111111-1111-1111-1111-111111111111", "automation_intents");
run.retain(
  "execution_attempt",
  "22222222-2222-2222-2222-222222222222",
  "automation_execution_attempts",
);
const rep = run.finish("2026-07-15T10:01:00Z");
check("run fails when any assertion fails", rep.passed === false);
check("dry-run flag carried in report", rep.dryRun === true);
check("retained audit recorded", rep.retainedAudit.length === 1);
const term = renderTerminal(rep, secrets);
check("terminal output redacts secrets", !term.includes(WS));
check("terminal shows pass/fail lines", term.includes("[PASS] a1") && term.includes("[FAIL] a2"));

await polling();

// ── Failure-safe restoration (runGuarded: finally always runs) ──────────────
console.log("Failure-safe restoration:");
async function restoration() {
  let finallyRan = 0;
  const okOut = await runGuarded(
    async () => {},
    async () => {
      finallyRan++;
    },
  );
  check("restoration runs after success", finallyRan === 1 && !okOut.bodyThrew);

  finallyRan = 0;
  const failOut = await runGuarded(
    async () => {
      throw new Error("assertion failed");
    },
    async () => {
      finallyRan++;
    },
  );
  check(
    "restoration runs after assertion failure",
    finallyRan === 1 && failOut.bodyThrew && failOut.bodyError === "assertion failed",
  );

  finallyRan = 0;
  const timeoutOut = await runGuarded(
    async () => {
      return Promise.reject(new Error("job timed out"));
    },
    async () => {
      finallyRan++;
    },
  );
  check("restoration runs after timeout/rejection", finallyRan === 1 && timeoutOut.bodyThrew);

  const cleanupFail = await runGuarded(
    async () => {},
    async () => {
      throw new Error("cleanup boom");
    },
  );
  check(
    "cleanup failure is captured, not swallowed",
    cleanupFail.finallyThrew && cleanupFail.finallyError === "cleanup boom",
  );
}
await restoration();

// A cleanup_failed disposition fails the suite.
const cf = new VerificationRun({
  runId: "verify-x-1",
  suite: "automation",
  projectRef: "p",
  tenantId: DEFAULT_VERIFY_TENANT,
  dryRun: false,
  startedAt: "2026-07-15T10:00:00Z",
});
cf.assert("ok", true);
cf.dispose("tenant_connector", "verify-controlled", "cleanup_failed", "delete rejected");
const cfReport = cf.finish("2026-07-15T10:01:00Z");
check(
  "cleanup_failed disposition fails the suite",
  cfReport.passed === false && cfReport.cleanup.failed === 1,
);
const rr = new VerificationRun({
  runId: "verify-x-2",
  suite: "automation",
  projectRef: "p",
  tenantId: DEFAULT_VERIFY_TENANT,
  dryRun: false,
  startedAt: "2026-07-15T10:00:00Z",
});
rr.assert("ok", true);
rr.dispose("mode_entry", "m1", "restored");
rr.dispose("connector", "verify-controlled", "deleted");
rr.dispose("attempt", "a1", "retained");
const rrReport = rr.finish("2026-07-15T10:01:00Z");
check(
  "clean dispositions pass + counts classified",
  rrReport.passed === true &&
    rrReport.cleanup.restored === 1 &&
    rrReport.cleanup.deleted === 1 &&
    rrReport.cleanup.retained === 1,
);

// ── Mutating-run lease ──────────────────────────────────────────────────────
console.log("Mutating-run lease:");
const now = Date.parse("2026-07-15T12:00:00Z");
const active: LeaseRow = {
  verification_run_id: "run-A",
  expires_at: "2026-07-15T12:05:00Z",
  released_at: null,
};
check(
  "first acquisition succeeds (no active lease)",
  planLockAcquire(null, now, "run-B").acquired === true,
);
check(
  "concurrent acquisition fails (active other run)",
  (() => {
    const p = planLockAcquire(active, now, "run-B");
    return p.acquired === false && p.holder === "run-A";
  })(),
);
check(
  "expired lease can be reclaimed",
  (() => {
    const p = planLockAcquire({ ...active, expires_at: "2026-07-15T11:00:00Z" }, now, "run-B");
    return p.acquired === true && p.reclaimedExpired === true;
  })(),
);
check(
  "release allows the next run",
  planLockAcquire({ ...active, released_at: "2026-07-15T12:01:00Z" }, now, "run-B").acquired ===
    true,
);
check(
  "wrong run id cannot release another run's lock",
  canReleaseLock(active, "run-B") === false && canReleaseLock(active, "run-A") === true,
);
check(
  "dry-run acquires no lock",
  shouldAcquireLock(true, true) === false &&
    shouldAcquireLock(true, false) === true &&
    shouldAcquireLock(false, false) === false,
);

// ── Lock error classification (RPC error ≠ contention) ──────────────────────
console.log("Lock error classification:");
const infra = classifyLockAttempt(
  { ok: false, error: 'column reference "expires_at" is ambiguous' },
  "automation",
);
check(
  "RPC error ⇒ infrastructure failure, NOT contention",
  infra.failure === "infra" &&
    !infra.proceed &&
    infra.message.includes("infrastructure") &&
    !infra.message.includes("holds the"),
);
const contended = classifyLockAttempt({ ok: true, acquired: false, holder: "run-A" }, "automation");
check(
  "clean acquired:false ⇒ contention",
  contended.failure === "contended" &&
    !contended.proceed &&
    contended.message.includes("holds the"),
);
const acquiredOk = classifyLockAttempt({ ok: true, acquired: true, holder: "run-B" }, "automation");
check("acquired ⇒ proceed, no failure", acquiredOk.proceed === true && acquiredOk.failure === null);

// ── Worker invocation contract (exact deployed platform-worker contract) ─────
console.log("Worker invocation contract:");
const wreq = workerRequest({ supabaseUrl: "https://abcdxyz.supabase.co", workerSecret: WS }, [
  "automation.execute",
]);
check("worker request method is POST", wreq.method === "POST");
check(
  "worker request targets functions/v1/platform-worker",
  wreq.url === "https://abcdxyz.supabase.co/functions/v1/platform-worker",
);
check(
  "worker auth uses the x-schedule-secret header == WORKER_SECRET",
  wreq.headers["x-schedule-secret"] === WS,
);
check(
  "worker request sends NO Authorization/apikey header (verify_jwt=false contract)",
  !("authorization" in wreq.headers) &&
    !("Authorization" in wreq.headers) &&
    !("apikey" in wreq.headers),
);
check(
  "worker request body carries batch_size + job_types",
  (() => {
    const b = JSON.parse(wreq.body) as { batch_size?: number; job_types?: string[] };
    return (
      b.batch_size === 5 && Array.isArray(b.job_types) && b.job_types[0] === "automation.execute"
    );
  })(),
);
check(
  "WORKER_SECRET is a header value only — never in the url or body",
  !wreq.url.includes(WS) && !wreq.body.includes(WS),
);
check(
  "workerRequest refuses to build without a secret",
  (() => {
    try {
      workerRequest({ supabaseUrl: "https://x.supabase.co", workerSecret: null });
      return false;
    } catch {
      return true;
    }
  })(),
);
check(
  "non-2xx worker response ⇒ infrastructure failure",
  classifyWorkerInvocation(200).ok &&
    !classifyWorkerInvocation(200).infrastructure &&
    classifyWorkerInvocation(403).infrastructure &&
    classifyWorkerInvocation(500).infrastructure &&
    classifyWorkerInvocation(0).infrastructure,
);

// ── Job classification (never undefined; DB row is the source of truth) ──────
console.log("Job classification:");
check(
  "classifyJob: worker failure ⇒ infrastructure_error",
  classifyJob({ status: "queued" }, false, true) === "infrastructure_error",
);
check(
  "classifyJob: null job ⇒ infrastructure_error",
  classifyJob(null, false, false) === "infrastructure_error",
);
check(
  "classifyJob: terminal DB status wins",
  classifyJob({ status: "succeeded" }, true, false) === "succeeded",
);
check(
  "classifyJob: dead_letter/cancelled/failed are terminal",
  classifyJob({ status: "dead_letter" }, false, false) === "dead_letter" &&
    classifyJob({ status: "cancelled" }, false, false) === "cancelled" &&
    classifyJob({ status: "failed" }, false, false) === "failed",
);
check(
  "classifyJob: non-terminal + timeout ⇒ timed_out",
  classifyJob({ status: "running" }, true, false) === "timed_out",
);
check(
  "classifyJob: still running, no timeout ⇒ running",
  classifyJob({ status: "running" }, false, false) === "running",
);
check(
  "jobStatusLabel is ALWAYS a defined, non-undefined string",
  jobStatusLabel(null) === "infrastructure_error" &&
    jobStatusLabel(undefined) === "infrastructure_error" &&
    !jobStatusLabel(null).includes("undefined"),
);

// ── Timeout diagnostics carry the last known DB state + worker response ──────
console.log("Timeout diagnostics:");
const timedResult: JobTerminalResult = buildJobResult({
  classification: "timed_out",
  jobId: "job-1",
  jobKey: "verify:run:automation:discovery",
  reused: false,
  job: {
    status: "running",
    attempt_count: 2,
    claimed_by: "worker-abc",
    lease_expires_at: "2026-07-15T16:20:00Z",
    last_error: "none",
    error_code: "e_code",
    result: { status: "blocked" },
  },
  worker: { ok: true, status: 200, body: '{"success":true}' },
});
const diag = describeJobResult(timedResult);
check(
  "timeout diagnostics include jobId/jobKey/dbStatus/attempt/claimed_by/lease/error/worker",
  diag.includes("jobId=job-1") &&
    diag.includes("jobKey=verify:run:automation:discovery") &&
    diag.includes("dbStatus=running") &&
    diag.includes("attempt_count=2") &&
    diag.includes("claimed_by=worker-abc") &&
    diag.includes("lease_expires_at=2026-07-15T16:20:00Z") &&
    diag.includes("error_code=e_code") &&
    diag.includes("last_error=none") &&
    diag.includes("worker_http=200"),
);
check("diagnostics never render the literal 'undefined'", !diag.includes("undefined"));
check(
  "handlerOutcome reads the persisted job.result (never the HTTP body)",
  handlerOutcome(timedResult).status === "blocked",
);
check("handlerOutcome tolerates a null result", Object.keys(handlerOutcome(null)).length === 0);

// ── Discovery proof is DB-state based, not HTTP-response based ────────────────
console.log("Discovery block proof (DB state):");
check(
  "discovery block proof holds when all persisted facts present",
  discoveryBlocked({ intentStatus: "pending", attempts: 0, outcomes: 0, blockGuards: 1 }) === true,
);
check(
  "discovery proof FAILS if the guard never ran (unprocessed job)",
  discoveryBlocked({ intentStatus: "pending", attempts: 0, outcomes: 0, blockGuards: 0 }) === false,
);
check(
  "discovery proof FAILS if an attempt or outcome slipped through",
  discoveryBlocked({ intentStatus: "pending", attempts: 1, outcomes: 0, blockGuards: 1 }) ===
    false &&
    discoveryBlocked({ intentStatus: "pending", attempts: 0, outcomes: 1, blockGuards: 1 }) ===
      false,
);
check(
  "discovery proof FAILS if the intent did not stay pending",
  discoveryBlocked({ intentStatus: "succeeded", attempts: 0, outcomes: 0, blockGuards: 1 }) ===
    false,
);

// ── Deterministic per-stage keys (retry is a genuinely NEW stage) ────────────
console.log("Per-stage job keys:");
const rid2 = "verify-20260715-abcd1234";
const kDisc = stageJobKey(rid2, "automation", "discovery");
const kTrust = stageJobKey(rid2, "automation", "trusted");
const kRetry = stageJobKey(rid2, "automation", "idempotency-retry");
check("stage key is deterministic + run-scoped", kDisc === `verify:${rid2}:automation:discovery`);
check(
  "each stage has a DISTINCT key (retry ≠ discovery ≠ trusted)",
  kDisc !== kTrust && kTrust !== kRetry && kDisc !== kRetry,
);
check(
  "stage keys carry the run prefix (own-run only)",
  isRunJobKey(kDisc, rid2) && isRunJobKey(kRetry, rid2) && !isRunJobKey(kDisc, "verify-other"),
);

// ── Run-scoped cleanup planning (never touches unrelated jobs) ────────────────
console.log("Run-scoped cleanup planning:");
const cleanupPlan = planRunJobCleanup(
  [
    { id: "own-active", job_key: `verify:${rid2}:automation:trusted`, status: "running" },
    { id: "own-done", job_key: `verify:${rid2}:automation:discovery`, status: "succeeded" },
    { id: "other-run", job_key: "verify:verify-other:automation:trusted", status: "running" },
    { id: "unrelated", job_key: "automation.execute:tenant:intent", status: "running" },
    { id: "no-key", job_key: null, status: "queued" },
  ],
  rid2,
);
check(
  "cleanup deletes ONLY this run's jobs",
  cleanupPlan.delete.slice().sort().join(",") === "own-active,own-done",
);
check("cleanup cancels ONLY this run's ACTIVE jobs", cleanupPlan.cancel.join(",") === "own-active");
check(
  "cleanup SKIPS every job not owned by this run",
  cleanupPlan.skip.slice().sort().join(",") === "no-key,other-run,unrelated",
);
check(
  "legacy stuck-run constant targets verify-20260715-a78555ae",
  LEGACY_STUCK_RUN === "verify-20260715-a78555ae",
);

// ── Immutable-lineage classification (retained, never deleted) ────────────────
console.log("Immutable-lineage cleanup classification:");
const lineagePlan = planRunJobCleanup(
  [
    // Owned + anchors immutable audit (guard decision / outcome) ⇒ retained.
    {
      id: "guarded-job",
      job_key: `verify:${rid2}:automation:discovery`,
      status: "succeeded",
      hasImmutableLineage: true,
    },
    // Owned + an ACTIVE job that still anchors lineage ⇒ retained (never cancelled).
    {
      id: "active-guarded",
      job_key: `verify:${rid2}:automation:trusted`,
      status: "running",
      hasImmutableLineage: true,
    },
    // Owned + no immutable references ⇒ deletable mutable fixture.
    {
      id: "mutable-job",
      job_key: `verify:${rid2}:automation:idempotency-retry`,
      status: "succeeded",
      hasImmutableLineage: false,
    },
    // Owned + active + mutable ⇒ cancel then delete.
    {
      id: "active-mutable",
      job_key: `verify:${rid2}:automation:probe`,
      status: "queued",
      hasImmutableLineage: false,
    },
    // Not owned by this run ⇒ skipped even though it carries lineage.
    {
      id: "foreign-guarded",
      job_key: "verify:verify-other:automation:trusted",
      status: "succeeded",
      hasImmutableLineage: true,
    },
  ],
  rid2,
);
check(
  "platform_job with immutable guard-decision lineage is RETAINED",
  lineagePlan.retain.slice().sort().join(",") === "active-guarded,guarded-job",
);
check(
  "platform_job WITHOUT immutable references can be DELETED",
  lineagePlan.delete.slice().sort().join(",") === "active-mutable,mutable-job",
);
check(
  "an immutable-lineage job is NEVER cancelled or deleted",
  !lineagePlan.cancel.includes("guarded-job") &&
    !lineagePlan.cancel.includes("active-guarded") &&
    !lineagePlan.delete.includes("guarded-job") &&
    !lineagePlan.delete.includes("active-guarded"),
);
check(
  "only ACTIVE mutable jobs are cancelled before delete",
  lineagePlan.cancel.join(",") === "active-mutable",
);
check(
  "a foreign job is skipped even when it carries lineage",
  lineagePlan.skip.join(",") === "foreign-guarded" &&
    !lineagePlan.retain.includes("foreign-guarded"),
);
check(
  "retain ∪ delete ∪ skip partitions every input job (no loss/overlap)",
  lineagePlan.retain.length + lineagePlan.delete.length + lineagePlan.skip.length === 5,
);
// Every immutable job-reference table is itself an immutable (never-deleted) audit
// table — so no immutable table row is ever a cleanup delete target.
check(
  "immutable job-reference tables are all immutable audit tables",
  IMMUTABLE_JOB_REFERENCE_TABLES.every((r) => !isCleanupSafe(r.table)),
);
check(
  "guard-decision / outcome / objective-health audit tables are never cleanup-safe",
  !isCleanupSafe("automation_execution_guard_decisions") &&
    !isCleanupSafe("outcomes") &&
    !isCleanupSafe("automation_execution_attempts") &&
    !isCleanupSafe("objective_health") &&
    !isCleanupSafe("objective_contribution_assessments"),
);

// ── Enqueue-once / poll-the-same-job orchestration (DI: no clock/network) ────
console.log("Stage orchestration (enqueue once, poll same job):");
async function stageOrchestration() {
  // A) one enqueue → one retained id → polls BY ID → terminal succeeded
  let enqueueCallsA = 0;
  const readIdsA: string[] = [];
  let tA = 0;
  const depsA: StageDeps = {
    enqueue: async () => {
      enqueueCallsA++;
      return { id: "job-A", duplicate: false, error: null };
    },
    invokeWorker: async () => ({ ok: true, status: 200, body: "{}" }) as WorkerInvocation,
    readJob: async (id) => {
      readIdsA.push(id);
      return { status: "succeeded", result: { status: "blocked" } } as PolledJob;
    },
    now: () => (tA += 100),
    sleep: async () => {},
  };
  const rA = await processJobStage(depsA, {
    jobKey: "verify:r:automation:discovery",
    timeoutMs: 5000,
    intervalMs: 100,
  });
  check(
    "ONE enqueue call, returns + retains ONE job id",
    enqueueCallsA === 1 && rA.jobId === "job-A",
  );
  check(
    "polling uses the job ID, not the key",
    readIdsA.length >= 1 && readIdsA.every((x) => x === "job-A"),
  );
  check("happy path classifies succeeded", rA.classification === "succeeded");

  // B) active duplicate key ⇒ REUSE + poll, never a second insert
  let enqueueCallsB = 0;
  const depsB: StageDeps = {
    enqueue: async () => {
      enqueueCallsB++;
      return { id: "existing-1", duplicate: true, error: null };
    },
    invokeWorker: async () => ({ ok: true, status: 200, body: "{}" }) as WorkerInvocation,
    readJob: async () => ({ status: "succeeded", result: {} }) as PolledJob,
    now: () => 0,
    sleep: async () => {},
  };
  const rB = await processJobStage(depsB, {
    jobKey: "verify:r:automation:trusted",
    timeoutMs: 5000,
    intervalMs: 100,
  });
  check(
    "active duplicate ⇒ reuse existing job (no second insert)",
    enqueueCallsB === 1 && rB.reused === true && rB.jobId === "existing-1",
  );

  // C) non-2xx worker ⇒ infrastructure_error immediately (single invocation)
  let invokeC = 0;
  const depsC: StageDeps = {
    enqueue: async () => ({ id: "job-C", duplicate: false, error: null }),
    invokeWorker: async () => {
      invokeC++;
      return { ok: false, status: 403, body: "forbidden" } as WorkerInvocation;
    },
    readJob: async () => ({ status: "queued" }) as PolledJob,
    now: () => 0,
    sleep: async () => {},
  };
  const rC = await processJobStage(depsC, { jobKey: "k", timeoutMs: 45000, intervalMs: 1500 });
  check(
    "non-2xx worker ⇒ infrastructure_error, immediately",
    rC.classification === "infrastructure_error" && invokeC === 1 && rC.workerHttpStatus === 403,
  );

  // D) never terminal ⇒ timed_out with full diagnostics (status never undefined)
  let tD = 0;
  const depsD: StageDeps = {
    enqueue: async () => ({ id: "job-D", duplicate: false, error: null }),
    invokeWorker: async () => ({ ok: true, status: 200, body: "{}" }) as WorkerInvocation,
    readJob: async () =>
      ({
        status: "running",
        attempt_count: 1,
        claimed_by: "w1",
        lease_expires_at: "L",
      }) as PolledJob,
    now: () => (tD += 1500),
    sleep: async () => {},
  };
  const rD = await processJobStage(depsD, {
    jobKey: "verify:r:automation:discovery",
    timeoutMs: 4500,
    intervalMs: 1500,
  });
  check("never-terminal ⇒ timed_out", rD.classification === "timed_out");
  check(
    "timed_out carries last DB state + a defined label",
    rD.dbStatus === "running" &&
      rD.claimedBy === "w1" &&
      rD.leaseExpiresAt === "L" &&
      jobStatusLabel(rD) === "timed_out",
  );

  // E) enqueue truly fails (not a duplicate) ⇒ infrastructure_error, jobId null
  const depsE: StageDeps = {
    enqueue: async () => ({ id: null, duplicate: false, error: "insert boom" }),
    invokeWorker: async () => ({ ok: true, status: 200, body: "{}" }) as WorkerInvocation,
    readJob: async () => null,
    now: () => 0,
    sleep: async () => {},
  };
  const rE = await processJobStage(depsE, { jobKey: "k", timeoutMs: 1000, intervalMs: 100 });
  check(
    "failed enqueue ⇒ infrastructure_error, no job id",
    rE.classification === "infrastructure_error" && rE.jobId === null,
  );
}
await stageOrchestration();

// ── Intelligence-ingest suite: fixture planning + registration ───────────────
console.log("Intelligence-ingest suite (fixture planning):");
const {
  SUITES: ALL_SUITES,
  buildIngestInteractionFixture,
  intelligenceIngestSuite,
} = await import("./suites.ts");
const { observeJobKey: obsKey } =
  await import("../../supabase/functions/_shared/observation_ingest.ts");

check(
  "intelligence-ingest suite is registered, mutating, with a plan",
  ALL_SUITES["intelligence-ingest"] === intelligenceIngestSuite &&
    intelligenceIngestSuite.mutating === true &&
    intelligenceIngestSuite.plan().length >= 10,
);

const fxRun = "verify-20260724-abcd1234";
const emailFx = buildIngestInteractionFixture({
  runId: fxRun,
  tenantId: DEFAULT_VERIFY_TENANT,
  channel: "email",
  interactionId: "int-e",
  nowIso: "2026-07-24T10:00:00Z",
});
const phoneFx = buildIngestInteractionFixture({
  runId: fxRun,
  tenantId: DEFAULT_VERIFY_TENANT,
  channel: "phone",
  interactionId: "int-p",
  nowIso: "2026-07-24T10:00:00Z",
});
check(
  "email fixture planning: enriched, tagged, email provenance",
  emailFx.source_type === "email" &&
    emailFx.source_table === "email_messages" &&
    emailFx.interaction_type === "email_message" &&
    emailFx.processing_status === "enriched" &&
    isVerificationFixture(emailFx.metadata as Record<string, unknown>, fxRun),
);
check(
  "phone fixture planning: enriched, tagged, phone provenance",
  phoneFx.source_type === "phone" &&
    phoneFx.source_table === "phone_calls" &&
    phoneFx.interaction_type === "phone_call" &&
    phoneFx.from_address === null &&
    phoneFx.phone_from === "+440000000000" &&
    isVerificationFixture(phoneFx.metadata as Record<string, unknown>, fxRun),
);
check(
  "email + phone share IDENTICAL business content (differ only in provenance)",
  emailFx.subject === phoneFx.subject &&
    emailFx.summary === phoneFx.summary &&
    emailFx.body_preview === phoneFx.body_preview &&
    emailFx.direction === phoneFx.direction &&
    emailFx.processing_status === phoneFx.processing_status &&
    emailFx.source_type !== phoneFx.source_type,
);
check(
  "fixture planning is deterministic (same inputs ⇒ identical row)",
  JSON.stringify(
    buildIngestInteractionFixture({
      runId: fxRun,
      tenantId: DEFAULT_VERIFY_TENANT,
      channel: "email",
      interactionId: "int-e",
      nowIso: "2026-07-24T10:00:00Z",
    }),
  ) === JSON.stringify(emailFx),
);
check(
  "ineligible fixture planning: overrides processing_status",
  buildIngestInteractionFixture({
    runId: fxRun,
    tenantId: DEFAULT_VERIFY_TENANT,
    channel: "phone",
    interactionId: "int-x",
    nowIso: "2026-07-24T10:00:00Z",
    processingStatus: "pending",
  }).processing_status === "pending",
);
check(
  "observe job key is deterministic per interaction (same handler + mapper path)",
  obsKey(DEFAULT_VERIFY_TENANT, "int-e", "obs-ingest/1") !==
    obsKey(DEFAULT_VERIFY_TENANT, "int-p", "obs-ingest/1") &&
    obsKey(DEFAULT_VERIFY_TENANT, "int-e", "obs-ingest/1") ===
      obsKey(DEFAULT_VERIFY_TENANT, "int-e", "obs-ingest/1"),
);

console.log(failures === 0 ? "\nALL HARNESS UNIT CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
