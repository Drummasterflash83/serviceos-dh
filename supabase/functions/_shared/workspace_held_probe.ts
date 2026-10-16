/** Bound automatic rechecks of a previously approved Workspace mailbox. */
export function shouldRecheckHeldMailbox(
  checkpoint: { state: string; block_code: string | null } | null,
  recentRequestTimes: string[],
  nowMs: number,
): boolean {
  if (checkpoint?.state !== "blocked" ||
    checkpoint.block_code !== "admin_delegation_missing" ||
    !Number.isFinite(nowMs) || recentRequestTimes.length >= 2) return false;
  const times = recentRequestTimes.map((time) => Date.parse(time));
  if (times.some((time) => !Number.isFinite(time) || time > nowMs + 5000)) return false;
  return times.every((time) => nowMs - time >= 15 * 60 * 1000);
}
