// Remote Verification Harness — CLI entry.
//
// Usage: node scripts/verify/index.ts <suite> [--dry-run] [--confirm-project] [--json] [--tenant=<uuid>]
//   suite = remote | automation | objectives | intelligence | all
//
// Safety: never touches the remote in --dry-run (prints the plan only); refuses an
// unconfirmed project; redacts secrets from all output; writes an optional JSON report
// to the git-ignored .verification-results/ directory.

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  VerificationRun,
  classifyLockAttempt,
  mergeEnv,
  newRunId,
  parseArgs,
  parseDotenv,
  projectAllowed,
  redactDeep,
  renderTerminal,
  resolveEnv,
  secretValues,
  shouldAcquireLock,
  type LockAttempt,
  type SuiteReport,
} from "./lib.ts";
import { SUITES } from "./suites.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RESULTS_DIR = join(REPO, ".verification-results");
const LOCK_TTL_SECONDS = 600; // generous lease so it never expires mid-run

function loadEnvFile(): Record<string, string> {
  // Dedicated, git-ignored secrets file for the harness (NOT the public .env.example).
  const path = join(REPO, ".env.verify");
  if (!existsSync(path)) return {};
  try {
    return parseDotenv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const suiteNames = args.suite === "all" ? Object.keys(SUITES) : [args.suite];

  // ── Dry-run: print the plan, never connect, never mutate. ──────────────────
  if (args.dryRun) {
    const envCheck = resolveEnv(mergeEnv(loadEnvFile(), process.env));
    console.log(`▐ DRY RUN — no connection, no mutation`);
    console.log(
      envCheck.ok
        ? `▐ env OK — project=${envCheck.env!.projectRef ?? "?"} tenant=${args.tenant ?? envCheck.env!.tenantId}`
        : `▐ env NOT configured (missing: ${envCheck.missing.join(", ")}) — plan only`,
    );
    for (const name of suiteNames) {
      const suite = SUITES[name];
      if (!suite) {
        console.log(`  unknown suite: ${name}`);
        continue;
      }
      console.log(`\n▐ plan: ${suite.name}`);
      suite.plan().forEach((step, i) => console.log(`  ${String(i + 1).padStart(2)}. ${step}`));
    }
    console.log(`\n▐ DRY RUN complete — nothing was executed.`);
    return 0;
  }

  // ── Live: require env, confirm project, then run. ──────────────────────────
  const resolved = resolveEnv(mergeEnv(loadEnvFile(), process.env));
  if (!resolved.ok) {
    console.error(
      `Setup error: missing ${resolved.missing.join(", ")}.\n` +
        `Copy .env.verify.example → .env.verify (git-ignored) and fill in the values, or export them.\n` +
        `Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Recommended: WORKER_SECRET, SUPABASE_PROJECT_REF, VERIFY_ALLOW_PROJECT_REF.`,
    );
    return 2;
  }
  const env = resolved.env!;
  if (args.tenant) env.tenantId = args.tenant;
  const secrets = secretValues(env);

  const allow = projectAllowed(env, args.confirmProject);
  console.log(`▐ target project: ${env.projectRef ?? "?"}   tenant: ${env.tenantId}`);
  if (!allow.ok) {
    console.error(`Refusing to run: ${allow.reason}`);
    return 2;
  }
  console.log(`▐ ${allow.reason}`);

  const { makeClient } = await import("./client.ts");
  const client = await makeClient(env);

  let anyFailed = false;
  const reports: SuiteReport[] = [];
  for (const name of suiteNames) {
    const suite = SUITES[name];
    if (!suite) {
      console.error(`unknown suite: ${name}`);
      anyFailed = true;
      continue;
    }
    const run = new VerificationRun({
      runId: newRunId(() => crypto.randomUUID().replace(/-/g, ""), new Date().toISOString()),
      suite: suite.name,
      projectRef: env.projectRef,
      tenantId: env.tenantId,
      dryRun: false,
      startedAt: new Date().toISOString(),
    });

    // Mutating suites take a tenant+suite lease so two concurrent runs can't collide.
    // An RPC error is an INFRASTRUCTURE failure — abort before mutation, never infer
    // contention.
    let lockHeld = false;
    if (shouldAcquireLock(!!suite.mutating, false)) {
      let attempt: LockAttempt;
      try {
        const lock = await client.acquireLock(suite.name, run.report.runId, LOCK_TTL_SECONDS);
        attempt = { ok: true, acquired: lock.acquired, holder: lock.holder };
      } catch (e) {
        attempt = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      const cls = classifyLockAttempt(attempt, suite.name);
      if (!cls.proceed) {
        run.error(cls.message);
        const report = run.finish(new Date().toISOString());
        reports.push(report);
        console.log(renderTerminal(report, secrets));
        console.log("");
        anyFailed = true;
        continue;
      }
      lockHeld = true;
    }

    try {
      await suite.run(run, client, env);
    } catch (e) {
      run.error(e instanceof Error ? e.message : String(e));
    } finally {
      if (lockHeld) await client.releaseLock(suite.name, run.report.runId);
    }
    const report = run.finish(new Date().toISOString());
    reports.push(report);
    console.log(renderTerminal(report, secrets));
    console.log("");
    if (!report.passed) anyFailed = true;
  }

  // Optional JSON artifact (secrets redacted; git-ignored directory).
  if (args.json) {
    try {
      mkdirSync(RESULTS_DIR, { recursive: true });
      for (const r of reports) {
        const file = join(RESULTS_DIR, `${r.runId}-${r.suite}.json`);
        writeFileSync(file, JSON.stringify(redactDeep(r, secrets), null, 2));
        console.log(`▐ report: ${file}`);
      }
    } catch (e) {
      console.error(`could not write report: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return anyFailed ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
