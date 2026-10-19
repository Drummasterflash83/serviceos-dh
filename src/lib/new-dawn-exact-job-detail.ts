const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const bounded = (value: unknown, limit: number): value is string | null =>
  value === null || typeof value === "string" && value.length <= limit;

export interface ExactJobDetail {
  auditId: string;
  checkedAt: string;
  sourceVersionId: string;
  externalId: string;
  status: string | null;
  stage: string | null;
  pipeline: string | null;
  expectedOnsite: string | null;
  expectedCompletion: string | null;
  providerUpdatedAt: string | null;
  sourceUsers: { id: string; name: string }[];
}
export function parseExactJobDetail(value: unknown, scope: {
  tenant: string; job: string; request: string; sourceVersion: string; externalId: string;
}): ExactJobDetail {
  if (!object(value) || value.version !== "commusoft-exact-job-detail/1" ||
    value.tenant_id !== scope.tenant || value.job_id !== scope.job ||
    value.request_id !== scope.request || value.source_version_id !== scope.sourceVersion ||
    value.external_id !== scope.externalId || !uuid(value.audit_id) ||
    typeof value.checked_at !== "string" || !Number.isFinite(Date.parse(value.checked_at)) ||
    !bounded(value.status, 120) || !bounded(value.stage, 200) || !bounded(value.pipeline, 200) ||
    !bounded(value.expected_onsite, 80) || !bounded(value.expected_completion, 80) ||
    !bounded(value.provider_updated_at, 80) ||
    !Array.isArray(value.source_assigned_users) || value.source_assigned_users.length > 20)
    throw Error("Current job detail could not be verified.");
  const users = value.source_assigned_users.map((user) => {
    if (!object(user) || typeof user.source_user_id !== "string" ||
      !/^(0|[1-9][0-9]{0,15})$/.test(user.source_user_id) ||
      typeof user.name !== "string" || user.name.length > 200)
      throw Error("Current job detail could not be verified.");
    return { id: user.source_user_id as string, name: user.name as string };
  });
  return {
    auditId: value.audit_id, checkedAt: value.checked_at,
    sourceVersionId: value.source_version_id, externalId: value.external_id,
    status: value.status as string | null, stage: value.stage as string | null,
    pipeline: value.pipeline as string | null,
    expectedOnsite: value.expected_onsite as string | null,
    expectedCompletion: value.expected_completion as string | null,
    providerUpdatedAt: value.provider_updated_at as string | null,
    sourceUsers: users,
  };
}
export async function readExactJobDetail(
  client: { functions: { invoke: (name: string, options: { body: Record<string, string> }) => PromiseLike<{ data: unknown; error: unknown }> } },
  tenant: string, job: string, sourceVersion: string, externalId: string, reason: string,
): Promise<ExactJobDetail> {
  if (!uuid(tenant) || !uuid(job) || !uuid(sourceVersion) || !/^[1-9][0-9]{0,15}$/.test(externalId) ||
    reason.trim().length < 3 || reason.trim().length > 500)
    throw Error("Current job detail could not be requested.");
  const request = crypto.randomUUID();
  const { data, error } = await client.functions.invoke("learn-commusoft-job-detail", {
    body: { tenantId: tenant, jobId: job, requestId: request, reason: reason.trim() },
  });
  if (error) throw Error("Current job detail could not be confirmed.");
  return parseExactJobDetail(data, { tenant, job, request, sourceVersion, externalId });
}
