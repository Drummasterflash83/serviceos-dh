export type CommusoftFreshness = {
  state: "not_checked" | "collecting" | "complete" | "partial" | "saved_advanced" | "stale";
  savedJobId: string | null;
  providerNewestJobId: string | null;
  providerCheckedAt: string | null;
  jobsBehind: number | null;
  atLeastBehind: number | null;
  observedAt: string;
};

/** Compare only the newest created job in a bounded provider read. */
export function commusoftFreshnessSummary(value: CommusoftFreshness | undefined): string {
  if (!value) return "Provider check unavailable";
  if (value.state === "not_checked") return "Provider not checked yet";
  if (value.state === "collecting") return "Checking provider jobs…";
  if (value.state === "saved_advanced") return "Saved jobs changed since the last provider check; comparison pending";
  if (value.state === "stale") return "No current-day provider comparison";
  if (value.state === "partial") return `Comparison incomplete${value.atLeastBehind
    ? ` · at least ${value.atLeastBehind.toLocaleString("en-GB")} new jobs found` : ""}`;
  if (value.jobsBehind === 0 && value.savedJobId === value.providerNewestJobId &&
    value.providerNewestJobId) return `Up to date to job ${value.providerNewestJobId} at last check`;
  if (value.jobsBehind !== null) return `${value.jobsBehind.toLocaleString("en-GB")} ${value.jobsBehind === 1 ? "job" : "jobs"} behind at last check${value.providerNewestJobId
    ? ` · newest Commusoft job ${value.providerNewestJobId}` : ""}`;
  return "Provider comparison unavailable";
}

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
