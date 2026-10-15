/** Independent hosted missed-success check. No database or AWS credential. */
import { pathToFileURL } from "node:url";
const REPO = "Drummasterflash83/serviceos-dh";
const WORKFLOW = "serviceos-database-backup.yml";
const MAX_AGE_MS = 26 * 60 * 60 * 1000;

export function assessLastSuccess(runs, now = Date.now()) {
  if (!Array.isArray(runs) || runs.length === 0)
    return { state: "database_daily_success_missing", lastSuccessAt: null };
  const valid = runs.filter((run) => run?.conclusion === "success" &&
    run?.name === "ServiceOS independent database backup" &&
    run?.head_branch === "main" &&
    Number.isFinite(Date.parse(run?.updated_at)) &&
    Date.parse(run.updated_at) <= now + 60_000);
  const last = valid.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
  if (!last) return { state: "database_daily_success_missing", lastSuccessAt: null };
  const lastSuccessAt = last.updated_at;
  const ageMs = now - Date.parse(lastSuccessAt);
  return { state: ageMs <= MAX_AGE_MS ? "database_daily_success_current"
    : "database_daily_success_overdue", lastSuccessAt,
    ageHours: Math.round(ageMs / 360_000) / 10 };
}

export async function checkDailyBackupSuccess({ token = process.env.GITHUB_TOKEN,
  now = Date.now(), request = fetch } = {}) {
  if (typeof token !== "string" || !token ||
    process.env.GITHUB_REPOSITORY !== REPO ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    process.env.GITHUB_ACTIONS !== "true")
    throw Error("database_daily_monitor_environment_invalid");
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?branch=main&status=success&per_page=5`;
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
    if (result.state !== "database_daily_success_current") process.exitCode = 1;
  } catch {
    console.error(JSON.stringify({ state: "database_daily_monitor_unconfirmed" }));
    process.exitCode = 1;
  }
}
