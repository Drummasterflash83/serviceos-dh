/** A bounded office-task source receipt, never an engineer appointment or staff assignment. */
export type ScheduledActivitySourcePage = {
  requestId: string;
  tenantId: string;
  connectionId: string;
  observedAt: string;
  recordCount: number;
  hasMore: boolean | null;
  parentTypeCounts: { label: string; count: number }[];
  statusCounts: { label: string; count: number }[];
  jobParentCount: number;
  dueDatePresentCount: number;
  assignedTooPresentCount: number;
};

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const iso = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
const unavailable = () => Error("ScheduledActivity source page could not be verified.");

function counts(value: unknown, key: "parentType" | "status", total: number) {
  if (!Array.isArray(value) || value.length > 10) throw unavailable();
  const seen = new Set<string>();
  const rows = value.map((entry: unknown) => {
    if (
      !object(entry) ||
      typeof entry[key] !== "string" ||
      entry[key].length < 1 ||
      entry[key].length > 100 ||
      seen.has(entry[key]) ||
      !Number.isSafeInteger(entry.count) ||
      (entry.count as number) < 1 ||
      (entry.count as number) > total
    )
      throw unavailable();
    seen.add(entry[key]);
    return { label: entry[key] as string, count: entry.count as number };
  });
  if (rows.reduce((sum, row) => sum + row.count, 0) !== total) throw unavailable();
  return rows;
}

export function readScheduledActivitySourcePage(
  value: unknown,
  scope: {
    tenant: string;
    connection: string;
    request: string;
  },
): ScheduledActivitySourcePage {
  if (
    !uuid(scope.tenant) ||
    !uuid(scope.connection) ||
    !uuid(scope.request) ||
    !object(value) ||
    value.version !== "commusoft-scheduled_activity-probe/1" ||
    value.meaning !== "office_task_source_only" ||
    value.tenantId !== scope.tenant ||
    value.connectionId !== scope.connection ||
    value.requestId !== scope.request ||
    !iso(value.observedAt) ||
    !Number.isSafeInteger(value.recordCount) ||
    (value.recordCount as number) < 0 ||
    (value.recordCount as number) > 10 ||
    (value.hasMore !== null && typeof value.hasMore !== "boolean") ||
    !Number.isSafeInteger(value.jobParentCount) ||
    !Number.isSafeInteger(value.dueDatePresentCount) ||
    !Number.isSafeInteger(value.assignedTooPresentCount) ||
    (value.jobParentCount as number) < 0 ||
    (value.dueDatePresentCount as number) < 0 ||
    (value.assignedTooPresentCount as number) < 0 ||
    (value.jobParentCount as number) > (value.recordCount as number) ||
    (value.dueDatePresentCount as number) > (value.recordCount as number) ||
    (value.assignedTooPresentCount as number) > (value.recordCount as number)
  )
    throw unavailable();
  const recordCount = value.recordCount as number;
  return {
    requestId: scope.request,
    tenantId: scope.tenant,
    connectionId: scope.connection,
    observedAt: value.observedAt,
    recordCount,
    hasMore: value.hasMore as boolean | null,
    parentTypeCounts: counts(value.parentTypeCounts, "parentType", recordCount),
    statusCounts: counts(value.statusCounts, "status", recordCount),
    jobParentCount: value.jobParentCount as number,
    dueDatePresentCount: value.dueDatePresentCount as number,
    assignedTooPresentCount: value.assignedTooPresentCount as number,
  };
}

export function readScheduledActivityWait(value: unknown, request: string, now = Date.now()) {
  if (
    !object(value) ||
    value.state !== "waiting" ||
    value.requestId !== request ||
    !Number.isSafeInteger(value.retryAt) ||
    (value.retryAt as number) <= now ||
    (value.retryAt as number) > now + 86_400_000
  )
    throw unavailable();
  return value.retryAt as number;
}

export function readScheduledActivityRetainedState(value: unknown, request: string) {
  if (
    !object(value) ||
    value.requestId !== request ||
    !["prepared", "claimed", "complete", "failed"].includes(String(value.state)) ||
    (value.failureCode !== null &&
      (typeof value.failureCode !== "string" || !/^[a-z_]{1,60}$/.test(value.failureCode)))
  )
    throw unavailable();
  return {
    state: value.state as "prepared" | "claimed" | "complete" | "failed",
    failureCode: value.failureCode as string | null,
    result: value.result,
  };
}
