/** A second scheduled slot covers a dropped first GitHub cron event. It must
 * not export another full database when an earlier scheduled run succeeded.
 * An API failure runs the backup: duplicate encrypted copies are preferable
 * to silently missing the day's only copy.
 */
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REPO = "Drummasterflash83/serviceos-dh";
const WORKFLOW = "serviceos-database-backup.yml";
const NAME = "ServiceOS independent database backup";

export function assessDailyRedundancy(runs, {
  now = Date.now(), currentRunId, event = "schedule",
} = {}) {
  if (event !== "schedule") return { skip: false, state: "manual_copy_requested" };
  if (!Array.isArray(runs) || !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(currentRunId) || currentRunId <= 0)
    return { skip: false, state: "redundancy_guard_unconfirmed" };
  const day = new Date(now).toISOString().slice(0, 10);
  const alreadySucceeded = runs.some((run) => {
    if (run?.event !== "schedule" || run?.name !== NAME ||
        run?.head_branch !== "main" || run?.status !== "completed" ||
        run?.conclusion !== "success" || run?.id === currentRunId ||
        !Number.isSafeInteger(run?.id)) return false;
    const created = Date.parse(run.created_at);
    const updated = Date.parse(run.updated_at);
    return Number.isFinite(created) && Number.isFinite(updated) &&
      created <= updated && updated <= now + 60_000 &&
      new Date(created).toISOString().slice(0, 10) === day;
  });
  return alreadySucceeded
    ? { skip: true, state: "earlier_scheduled_copy_succeeded_today" }
    : { skip: false, state: "scheduled_copy_required" };
}

export async function checkDailyBackupRedundancy({
  token = process.env.GITHUB_TOKEN,
  event = process.env.GITHUB_EVENT_NAME,
  currentRunId = Number(process.env.GITHUB_RUN_ID),
  now = Date.now(),
  request = fetch,
} = {}) {
  if (process.env.GITHUB_REPOSITORY !== REPO ||
      process.env.GITHUB_REF !== "refs/heads/main" ||
      process.env.GITHUB_ACTIONS !== "true" ||
      !["schedule", "workflow_dispatch"].includes(event) ||
      !Number.isSafeInteger(currentRunId) || currentRunId <= 0)
    throw Error("backup_redundancy_environment_invalid");
  if (event === "workflow_dispatch")
    return assessDailyRedundancy([], { now, currentRunId, event });
  if (typeof token !== "string" || !token)
    return { skip: false, state: "redundancy_guard_unconfirmed" };
  try {
    const url = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?branch=main&event=schedule&per_page=30`;
    const response = await request(url, { headers: {
      Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28" },
      redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw Error("backup_redundancy_api_unconfirmed");
    const body = await response.json();
    if (!Array.isArray(body?.workflow_runs)) throw Error("backup_redundancy_shape_invalid");
    return assessDailyRedundancy(body.workflow_runs, { now, currentRunId, event });
  } catch {
    return { skip: false, state: "redundancy_guard_unconfirmed" };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await checkDailyBackupRedundancy();
    const output = process.env.GITHUB_OUTPUT;
    if (typeof output !== "string" || !output)
      throw Error("backup_redundancy_output_unavailable");
    await appendFile(output, `skip=${result.skip}\n`);
    console.log(JSON.stringify(result));
  } catch {
    console.error(JSON.stringify({ state: "backup_redundancy_unconfirmed" }));
    process.exitCode = 1;
  }
}
