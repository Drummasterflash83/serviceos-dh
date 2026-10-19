import { SOURCE_JOB_IDENTITIES, SOURCE_JOB_RELATIONSHIPS } from "./learn-commusoft-source-jobs.ts";

export type RecentUnlinkedJob = {
  external_id: string;
  version_id: string | null;
  source_observed_at: string;
  source_status: string | null;
  relationship_state: keyof typeof SOURCE_JOB_RELATIONSHIPS;
  customer_identity_state: keyof typeof SOURCE_JOB_IDENTITIES;
};
export type RecentUnlinkedPage = {
  unlinkedCount: number;
  windowStart: string;
  latestSourceObservedAt: string | null;
  latestCheckpointAt: string | null;
  rows: RecentUnlinkedJob[];
};
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const instant = (value: unknown): value is string =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value)) &&
  /(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const unavailable = () =>
  Error("Recent source jobs could not be verified. Refresh the OpenFolk review.");

export function readRecentUnlinkedJobs(
  value: unknown,
  scope: {
    tenant: string;
    connection: string;
    actor: string;
  },
  now = Date.now(),
): RecentUnlinkedPage {
  if (
    !object(value) ||
    value.version !== "new-dawn-recent-unlinked-jobs/1" ||
    value.tenant_id !== scope.tenant ||
    value.connection_id !== scope.connection ||
    value.actor_id !== scope.actor ||
    !uuid(value.audit_id) ||
    !instant(value.observed_at) ||
    Math.abs(now - Date.parse(value.observed_at)) > 120_000 ||
    !instant(value.window_start) ||
    Date.parse(value.window_start) > Date.parse(value.observed_at) ||
    Date.parse(value.window_start) < Date.parse(value.observed_at) - 25 * 60 * 60_000 ||
    !Number.isSafeInteger(value.unlinked_count) ||
    (value.unlinked_count as number) < 0 ||
    !(value.latest_source_observed_at === null || instant(value.latest_source_observed_at)) ||
    !(value.latest_checkpoint_at === null || instant(value.latest_checkpoint_at)) ||
    !Array.isArray(value.rows) ||
    value.rows.length > 25 ||
    value.rows.length > (value.unlinked_count as number)
  )
    throw unavailable();
  if (
    value.rows.length > 0 &&
    (value.latest_source_observed_at === null ||
      Date.parse(value.latest_source_observed_at as string) <
        Date.parse(value.rows[0]?.source_observed_at))
  )
    throw unavailable();
  let previousTime = Infinity;
  const seen = new Set<string>();
  for (const row of value.rows) {
    if (
      !object(row) ||
      typeof row.external_id !== "string" ||
      !/^[1-9]\d{0,15}$/.test(row.external_id) ||
      seen.has(row.external_id) ||
      !(row.version_id === null || uuid(row.version_id)) ||
      !instant(row.source_observed_at) ||
      Date.parse(row.source_observed_at) < Date.parse(value.window_start as string) ||
      Date.parse(row.source_observed_at) > Date.parse(value.observed_at as string) + 60_000 ||
      Date.parse(row.source_observed_at) > previousTime ||
      !(
        row.source_status === null ||
        (typeof row.source_status === "string" && row.source_status.length <= 1000)
      ) ||
      !Object.hasOwn(SOURCE_JOB_RELATIONSHIPS, String(row.relationship_state)) ||
      !Object.hasOwn(SOURCE_JOB_IDENTITIES, String(row.customer_identity_state))
    )
      throw unavailable();
    previousTime = Date.parse(row.source_observed_at);
    seen.add(row.external_id);
  }
  return {
    unlinkedCount: value.unlinked_count as number,
    windowStart: value.window_start as string,
    latestSourceObservedAt: value.latest_source_observed_at as string | null,
    latestCheckpointAt: value.latest_checkpoint_at as string | null,
    rows: value.rows as RecentUnlinkedJob[],
  };
}

export async function loadRecentUnlinkedJobs(
  db: {
    rpc(
      name: string,
      args: Record<string, unknown>,
    ): PromiseLike<{ data: unknown; error: unknown }>;
  },
  scope: { tenant: string; connection: string; actor: string; reason: string },
) {
  if (
    ![scope.tenant, scope.connection, scope.actor].every(uuid) ||
    scope.reason.trim().length < 3 ||
    scope.reason.trim().length > 500
  )
    throw unavailable();
  const { data, error } = await db.rpc("new_dawn_recent_unlinked_commusoft_jobs", {
    p_tenant: scope.tenant,
    p_connection: scope.connection,
    p_reason: scope.reason.trim(),
  });
  if (error) throw unavailable();
  return readRecentUnlinkedJobs(data, scope);
}
