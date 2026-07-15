// Unit tests for the Remote Verification Harness pure core. No database, no network —
// everything is injected. Run: node scripts/verify/lib.verify.ts

import {
  DEFAULT_VERIFY_TENANT,
  VerificationRun,
  canReleaseLock,
  fixtureTag,
  isCleanupSafe,
  isVerificationFixture,
  newRunId,
  parseArgs,
  parseDotenv,
  planLockAcquire,
  pollJob,
  projectAllowed,
  projectRefFromUrl,
  redact,
  redactDeep,
  renderTerminal,
  resolveEnv,
  runGuarded,
  secretValues,
  shouldAcquireLock,
  type LeaseRow,
  type VerifyEnv,
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

console.log(failures === 0 ? "\nALL HARNESS UNIT CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
