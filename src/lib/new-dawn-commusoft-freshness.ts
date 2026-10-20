export type CommusoftFreshness = {
  state: "not_checked" | "collecting" | "complete" | "partial" | "saved_advanced" | "stale";
  savedJobId: string | null;
  providerNewestJobId: string | null;
  providerCheckedAt: string | null;
  jobsBehind: number | null;
  atLeastBehind: number | null;
  observedAt: string;
};

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value);
const nullableId = (value: unknown) => value === null || identifier(value);
const instant = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Provider freshness is a separate audited fact; do not infer it from saved totals. */
export function readCommusoftFreshness(
  raw: unknown, tenant: string, actor: string,
): CommusoftFreshness {
  if (!object(raw) || raw.version !== "new-dawn-commusoft-freshness/1" ||
    raw.tenant_id !== tenant || raw.actor_id !== actor ||
    !instant(raw.observed_at) ||
    !["not_checked", "collecting", "complete", "partial", "saved_advanced", "stale"]
      .includes(String(raw.state)) || !nullableId(raw.saved_job_id) ||
    !nullableId(raw.provider_newest_job_id) ||
    !(raw.provider_checked_at === null || instant(raw.provider_checked_at)) ||
    !(raw.jobs_behind === null || count(raw.jobs_behind)) ||
    !(raw.at_least_behind === null || count(raw.at_least_behind)) ||
    raw.scope !== "provider_jobs_created_descending")
    throw Error("Commusoft freshness could not be verified.");
  if ((raw.state !== "complete" && raw.jobs_behind !== null) ||
    (raw.state !== "partial" && raw.at_least_behind !== null) ||
    (raw.state === "complete" && (raw.jobs_behind === null || !instant(raw.provider_checked_at))))
    throw Error("Commusoft freshness could not be verified.");
  return { state: raw.state as CommusoftFreshness["state"],
    savedJobId: raw.saved_job_id as string | null,
    providerNewestJobId: raw.provider_newest_job_id as string | null,
    providerCheckedAt: raw.provider_checked_at as string | null,
    jobsBehind: raw.jobs_behind as number | null,
    atLeastBehind: raw.at_least_behind as number | null,
    observedAt: raw.observed_at as string };
}
