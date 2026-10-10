import type { LearnReadClient } from "./learn-cards.ts";
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export interface PerformanceReview {
  id: string;
  tenant_id: string;
  measurement_id: string;
  revision: number;
  decision: "confirmed" | "disputed";
  reviewed_by: string;
  reason: string;
  created_at: string;
}
export async function loadPerformanceReviews(
  db: LearnReadClient,
  tenantId: string,
  ids: string[],
): Promise<Map<string, PerformanceReview[]>> {
  if (
    !uuid(tenantId) ||
    ids.length > 500 ||
    ids.some((id) => !uuid(id)) ||
    new Set(ids).size !== ids.length
  )
    throw Error("Invalid review scope");
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  const results = await Promise.all(
    batches.map(async (batch) => {
      const { data, error, count } = await db
        .from("learn_performance_reviews")
        .select("id,tenant_id,measurement_id,revision,decision,reviewed_by,reason,created_at", {
          count: "exact",
        })
        .eq("tenant_id", tenantId)
        .in("measurement_id", batch)
        .order("revision", { ascending: true })
        .limit(1001);
      if (
        error ||
        !Array.isArray(data) ||
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count > 1000 ||
        data.length !== count ||
        data.some((r: any) => !r || !batch.includes(r.measurement_id))
      )
        throw Error("Complete review history could not be read");
      return data as PerformanceReview[];
    }),
  );
  return parsePerformanceReviews(tenantId, ids, results.flat());
}
export function parsePerformanceReviews(
  tenantId: string,
  ids: string[],
  rows: PerformanceReview[],
): Map<string, PerformanceReview[]> {
  if (
    !uuid(tenantId) ||
    !Array.isArray(rows) ||
    rows.some((r) => !r || !ids.includes(r.measurement_id))
  )
    throw Error("Review history differs from measurement scope");
  const found = new Set<string>(),
    histories = new Map<string, PerformanceReview[]>();
  if (rows.length > 1000) throw Error("Review history exceeds the current read window");
  for (const r of rows) {
    if (
      !uuid(r.id) ||
      found.has(r.id) ||
      r.tenant_id !== tenantId ||
      !uuid(r.reviewed_by) ||
      !Number.isSafeInteger(r.revision) ||
      r.revision < 1 ||
      !["confirmed", "disputed"].includes(r.decision) ||
      typeof r.reason !== "string" ||
      !r.reason.trim() ||
      r.reason.length > 1000 ||
      typeof r.created_at !== "string" ||
      !Number.isFinite(Date.parse(r.created_at))
    )
      throw Error("Review history failed validation");
    found.add(r.id);
    const history = histories.get(r.measurement_id) ?? [];
    history.push(r);
    histories.set(r.measurement_id, history);
  }
  for (const history of histories.values()) {
    history.sort((a, b) => a.revision - b.revision);
    if (history.some((r, i) => r.revision !== i + 1))
      throw Error("Review history is incomplete or conflicting");
  }
  return histories;
}
export interface ReviewRequest {
  tenantId: string;
  measurementId: string;
  requestId: string;
  expectedRevision: number;
  decision: "confirmed" | "disputed";
  reason: string;
}
export async function reviewPerformanceMeasurement(
  db: {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: any; error: { code?: string } | null }>;
  },
  request: ReviewRequest,
) {
  if (
    !uuid(request.tenantId) ||
    !uuid(request.measurementId) ||
    !uuid(request.requestId) ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 0 ||
    request.expectedRevision >= 2147483647 ||
    !["confirmed", "disputed"].includes(request.decision) ||
    !request.reason.trim() ||
    request.reason.trim().length > 1000
  )
    throw Error("A valid review and reason are required");
  const { data, error } = await db.rpc("learn_performance_review", {
    p_tenant_id: request.tenantId,
    p_measurement_id: request.measurementId,
    p_request_id: request.requestId,
    p_expected_revision: request.expectedRevision,
    p_decision: request.decision,
    p_reason: request.reason.trim(),
  });
  if (error)
    throw Error(
      ["PT409", "40001"].includes(error.code ?? "")
        ? "This observation or review changed. Reload the scorecard before reviewing."
        : error.code === "42501"
          ? "Only a company owner or admin outside preview can review evidence."
          : "Review was not confirmed. Retry the same request to avoid duplicates.",
    );
  if (
    !data ||
    data.reviewId !== request.requestId ||
    data.measurementId !== request.measurementId ||
    data.revision !== request.expectedRevision + 1 ||
    data.decision !== request.decision ||
    typeof data.reused !== "boolean"
  )
    throw Error("Review response could not be verified. Retry the same request.");
  return data as {
    reviewId: string;
    measurementId: string;
    revision: number;
    decision: "confirmed" | "disputed";
    reused: boolean;
  };
}
