/** Independent hosted missed-success check. No database or AWS credential. */
import { pathToFileURL } from "node:url";
const REPO = "Drummasterflash83/serviceos-dh";
const WORKFLOW = "serviceos-database-backup.yml";
const MAX_AGE_MS = 26 * 60 * 60 * 1000;
const MAX_RUNNING_MS = 6 * 60 * 60 * 1000;
// This schedule was first enabled on 15 October after the 03:15 slot. Its
// first eligible scheduled run is 16 October; allow GitHub's initial trigger
// a bounded delay without counting the preceding manual rehearsal as success.
const FIRST_SCHEDULE_DUE = Date.parse("2026-10-16T03:15:00Z");
const FIRST_SCHEDULE_GRACE_MS = 2 * 60 * 60 * 1000;

const missing = (now) => now <= FIRST_SCHEDULE_DUE + FIRST_SCHEDULE_GRACE_MS
  ? { state: "database_first_scheduled_run_pending", lastSuccessAt: null }
  : { state: "database_daily_scheduled_success_missing", lastSuccessAt: null };

export function assessLastSuccess(runs, now = Date.now()) {
  if (!Array.isArray(runs)) return missing(now);
  // A manual rescue is useful recovery evidence, but cannot prove that the
  // unattended schedule worked. Inspect the latest scheduled attempt, not only
  // the latest success: a failed run must not be hidden by yesterday's copy.
  const valid = runs.filter((run) => run?.event === "schedule" &&
    run?.name === "ServiceOS independent database backup" &&
    run?.head_branch === "main" &&
    Number.isFinite(Date.parse(run?.created_at)) &&
    Number.isFinite(Date.parse(run?.updated_at)) &&
    Date.parse(run.created_at) <= now + 60_000 &&
    Date.parse(run.updated_at) <= now + 60_000);
  const last = valid.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!last) return missing(now);
  if (last.status !== "completed") {
    const ageHours = Math.round((now - Date.parse(last.created_at)) / 360_000) / 10;
    return { state: now - Date.parse(last.created_at) <= MAX_RUNNING_MS
      ? "database_daily_scheduled_run_in_progress"
      : "database_daily_scheduled_run_overdue",
      lastSuccessAt: null, lastAttemptAt: last.created_at, ageHours };
  }
  if (last.conclusion !== "success")
    return { state: "database_daily_scheduled_run_failed", lastSuccessAt: null,
      lastAttemptAt: last.updated_at };
  const lastSuccessAt = last.updated_at;
  const ageMs = now - Date.parse(lastSuccessAt);
  return { state: ageMs <= MAX_AGE_MS ? "database_daily_scheduled_success_current"
    : "database_daily_scheduled_success_overdue", lastSuccessAt,
    ageHours: Math.round(ageMs / 360_000) / 10 };
}

export async function checkDailyBackupSuccess({ token = process.env.GITHUB_TOKEN,
  now = Date.now(), request = fetch } = {}) {
  if (typeof token !== "string" || !token ||
    process.env.GITHUB_REPOSITORY !== REPO ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    process.env.GITHUB_ACTIONS !== "true")
    throw Error("database_daily_monitor_environment_invalid");
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?branch=main&per_page=20`;
  const response = await request(url, { headers: {
    Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28" },
    redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw Error("database_daily_monitor_api_unconfirmed");
  const body = await response.json();
  if (!Array.isArray(body?.workflow_runs)) throw Error("database_daily_monitor_shape_invalid");
  return assessLastSuccess(body.workflow_runs, now);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await checkDailyBackupSuccess();
    console.log(JSON.stringify(result));
    if (!["database_daily_scheduled_success_current",
      "database_daily_scheduled_run_in_progress",
      "database_first_scheduled_run_pending"].includes(result.state)) process.exitCode = 1;
  } catch {
    console.error(JSON.stringify({ state: "database_daily_monitor_unconfirmed" }));
    process.exitCode = 1;
  }
}
