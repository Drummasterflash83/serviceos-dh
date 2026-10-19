/** A bounded Commusoft source-page receipt, never a Further Works metric. */
export type OpportunitySourcePage = {
  requestId: string;
  tenantId: string;
  connectionId: string;
  observedAt: string;
  recordCount: number;
  hasMore: boolean | null;
  pipelineCounts: { label: string; count: number }[];
  statusCounts: { label: string; count: number }[];
};

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const iso = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
const unavailable = () => Error("Opportunity source page could not be verified.");

function counts(value: unknown, key: "pipeline" | "status", total: number) {
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

export function readOpportunitySourcePage(
  value: unknown,
  scope: {
    tenant: string;
    connection: string;
    request: string;
  },
): OpportunitySourcePage {
  if (
    !uuid(scope.tenant) ||
    !uuid(scope.connection) ||
    !uuid(scope.request) ||
    !object(value) ||
    value.version !== "commusoft-opportunity-probe/1" ||
    value.tenantId !== scope.tenant ||
    value.connectionId !== scope.connection ||
    value.requestId !== scope.request ||
    !iso(value.observedAt) ||
    !Number.isSafeInteger(value.recordCount) ||
    (value.recordCount as number) < 0 ||
    (value.recordCount as number) > 10 ||
    (value.hasMore !== null && typeof value.hasMore !== "boolean")
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
    pipelineCounts: counts(value.pipelineCounts, "pipeline", recordCount),
    statusCounts: counts(value.statusCounts, "status", recordCount),
  };
}

export function readOpportunityWait(value: unknown, request: string, now = Date.now()) {
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

export function readOpportunityRetainedState(value: unknown, request: string) {
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
