export const dailyStatKeys = [
  "calls", "recordings", "emails", "slack", "jobs", "customers", "sites",
] as const;

export type DailyStatKey = (typeof dailyStatKeys)[number];
export type DailyStatCount = { today: number; total: number };
export type DailyStats = {
  tenantId: string;
  actorId: string;
  observedAt: string;
  dayStart: string;
  counts: Record<DailyStatKey, DailyStatCount>;
  latestSavedJob: { number: string; savedAt: string } | null;
  auditId: string;
};

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const date = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Reject stale/cross-tenant responses and malformed aggregates before display. */
export function readDailyStats(raw: unknown, tenant: string, actor: string): DailyStats {
  if (!object(raw) || raw.version !== "new-dawn-learn-daily-stats/1"
    || raw.tenant_id !== tenant || raw.actor_id !== actor
    || !date(raw.observed_at) || !date(raw.day_start)
    || raw.timezone !== "Europe/London" || raw.scope !== "retained_saved_rows"
    || !uuid(raw.audit_id) || !object(raw.counts)
    || raw.provider_newest_job !== null || raw.provider_newest_state !== "not_checked") {
    throw Error("Saved-input summary could not be verified.");
  }
  const parsed = {} as Record<DailyStatKey, DailyStatCount>;
  for (const key of dailyStatKeys) {
    const item = raw.counts[key];
    if (!object(item) || !count(item.today) || !count(item.total)
      || item.today > item.total) {
      throw Error("Saved-input summary could not be verified.");
    }
    parsed[key] = { today: item.today, total: item.total };
  }
  const latest = raw.latest_saved_job;
  if (latest !== null && (!object(latest) || typeof latest.number !== "string"
    || !latest.number.trim() || latest.number.length > 100 || !date(latest.saved_at))) {
    throw Error("Saved-input summary could not be verified.");
  }
  return {
    tenantId: tenant, actorId: actor, observedAt: raw.observed_at,
    dayStart: raw.day_start, counts: parsed,
    latestSavedJob: latest === null ? null : {
      number: latest.number as string, savedAt: latest.saved_at as string,
    },
    auditId: raw.audit_id,
  };
}
