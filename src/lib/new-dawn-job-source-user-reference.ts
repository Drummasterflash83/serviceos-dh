const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const date = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const sourceId = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9][0-9]{0,15})$/.test(value) &&
  Number(value) <= Number.MAX_SAFE_INTEGER;

export interface JobSourceUserReference {
  auditId: string;
  detailRequestId: string;
  detailCheckedAt: string;
  users: Array<{
    sourceId: string;
    nameOnJobReceipt: string;
    state: "source_record_retained" | "source_record_not_captured";
    sourceVersionId: string | null;
    capturedAt: string | null;
  }>;
}

/** A same-source ID reference, not an engineer, visit, team member or login. */
export function parseJobSourceUserReference(value: unknown, scope: {
  tenant: string; job: string; actor: string; sourceVersion: string;
}): JobSourceUserReference {
  if (!object(value) || value.version !== "new-dawn-job-source-user-reference/1" ||
    value.tenant_id !== scope.tenant || value.job_id !== scope.job ||
    value.actor_id !== scope.actor || value.job_source_version_id !== scope.sourceVersion ||
    value.scope !== "source_identity_only" || !uuid(value.connection_id) ||
    !uuid(value.job_detail_request_id) || !uuid(value.audit_id) ||
    !date(value.job_detail_checked_at) || !Array.isArray(value.users) || value.users.length > 20)
    throw Error("Source user reference could not be verified.");
  const seen = new Set<string>();
  const users = value.users.map((row) => {
    if (!object(row) || !sourceId(row.source_user_id) || seen.has(row.source_user_id) ||
      typeof row.name_on_job_receipt !== "string" || row.name_on_job_receipt.length > 200 ||
      row.identity !== "unverified" || row.appointment !== "unverified" ||
      !["source_record_retained", "source_record_not_captured"].includes(String(row.state)) ||
      (row.state === "source_record_retained"
        ? !uuid(row.source_user_version_id) || !date(row.source_user_captured_at)
        : row.source_user_version_id !== null || row.source_user_captured_at !== null))
      throw Error("Source user reference could not be verified.");
    seen.add(row.source_user_id);
    return {
      sourceId: row.source_user_id as string,
      nameOnJobReceipt: row.name_on_job_receipt as string,
      state: row.state as "source_record_retained" | "source_record_not_captured",
      sourceVersionId: row.source_user_version_id as string | null,
      capturedAt: row.source_user_captured_at as string | null,
    };
  });
  return {
    auditId: value.audit_id, detailRequestId: value.job_detail_request_id,
    detailCheckedAt: value.job_detail_checked_at, users,
  };
}

export async function readJobSourceUserReference(
  client: { rpc: (name: string, args: Record<string, string>) => PromiseLike<{ data: unknown; error: unknown }> },
  scope: { tenant: string; job: string; actor: string; sourceVersion: string },
  reason: string,
): Promise<JobSourceUserReference> {
  if (![scope.tenant, scope.job, scope.actor, scope.sourceVersion].every(uuid) ||
    reason.trim().length < 3 || reason.trim().length > 500)
    throw Error("Source user reference could not be requested.");
  const { data, error } = await client.rpc("new_dawn_job_source_user_reference", {
    p_tenant: scope.tenant, p_job: scope.job, p_reason: reason.trim(),
  });
  if (error) throw Error("Source user reference is unavailable.");
  return parseJobSourceUserReference(data, scope);
}
