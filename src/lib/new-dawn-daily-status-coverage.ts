export type DailyStatusCoverage = {
  tenantId: string;
  actorId: string;
  auditId: string;
  readAt: string;
  snapshotAt: string;
  day: string | null;
  rosterCount: number | null;
  observedCount: number | null;
  missingCount: number | null;
  lastProviderCheckAt: string | null;
  qualifyingStreakDays: number;
  streakStartDay: string | null;
  earliestMovingReviewDay: string | null;
};

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const instant = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const day = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

/** Reject a cross-tenant, stale, or inconsistent coverage receipt before it
 * can appear beside the client's job workload. */
export function readDailyStatusCoverage(
  value: unknown, tenant: string, actor: string,
): DailyStatusCoverage {
  if (!object(value) || value.version !== "new-dawn-daily-status-coverage/1" ||
    value.tenant_id !== tenant || value.actor_id !== actor || !uuid(value.audit_id) ||
    !instant(value.observed_at) || !instant(value.snapshot_at) ||
    Date.parse(value.observed_at) < Date.now() - 300_000 ||
    Date.parse(value.observed_at) > Date.now() + 60_000 ||
    Date.parse(value.snapshot_at) > Date.parse(value.observed_at) ||
    !count(value.qualifying_streak_days) || value.qualifying_streak_days > 28)
    throw Error("Daily job status coverage unavailable");

  const hasDay = value.day !== null;
  if (hasDay ? !day(value.day) || !count(value.roster_count) ||
    !count(value.observed_count) || !count(value.missing_count) ||
    value.observed_count + value.missing_count !== value.roster_count ||
    Date.parse(`${value.day}T00:00:00Z`) > Date.parse(value.observed_at) + 86_400_000 ||
    !(value.last_provider_check_at === null || instant(value.last_provider_check_at)) ||
    (value.observed_count > 0 && value.last_provider_check_at === null)
    : value.roster_count !== null || value.observed_count !== null ||
      value.missing_count !== null || value.last_provider_check_at !== null ||
      value.qualifying_streak_days !== 0) {
    throw Error("Daily job status coverage unavailable");
  }
  const hasStreak = value.qualifying_streak_days > 0;
  if (hasStreak ? !day(value.streak_start_day) ||
    !day(value.earliest_moving_review_day) || !hasDay ||
    Date.parse(`${value.earliest_moving_review_day}T00:00:00Z`) -
      Date.parse(`${value.streak_start_day}T00:00:00Z`) !== 14 * 86_400_000 ||
    (value.observed_count as number) * 100 < (value.roster_count as number) * 99
    : value.streak_start_day !== null || value.earliest_moving_review_day !== null) {
    throw Error("Daily job status coverage unavailable");
  }

  return {
    tenantId: tenant, actorId: actor, auditId: value.audit_id as string,
    readAt: value.observed_at as string, snapshotAt: value.snapshot_at as string,
    day: value.day as string | null,
    rosterCount: value.roster_count as number | null,
    observedCount: value.observed_count as number | null,
    missingCount: value.missing_count as number | null,
    lastProviderCheckAt: value.last_provider_check_at as string | null,
    qualifyingStreakDays: value.qualifying_streak_days as number,
    streakStartDay: value.streak_start_day as string | null,
    earliestMovingReviewDay: value.earliest_moving_review_day as string | null,
  };
}
