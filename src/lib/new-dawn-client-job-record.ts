import type { OpenJobRow } from "./new-dawn-open-job-page";

export type ClientJobRecord = {
  sourceObservedAt: string;
  readAt: string;
  auditId: string;
  status: string | null;
  priority: string | null;
  description: string | null;
  exactDetail: null | {
    checkedAt: string;
    stage: string | null;
    pipeline: string | null;
    sourceUsers: { id: string; name: string }[];
    holdReason: string | null;
    providerUpdatedAt: string | null;
  };
};

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const instant = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const bounded = (value: unknown, limit: number): value is string | null =>
  value === null || (typeof value === "string" && value.length <= limit);
const unavailable = () => Error("Saved job detail could not be verified. Refresh the job list.");

export function readClientJobRecord(
  value: unknown, tenant: string, actor: string, row: OpenJobRow,
  now = Date.now(),
): ClientJobRecord {
  if (!object(value) || value.version !== "new-dawn-client-job-record/1" ||
    value.tenant_id !== tenant || value.actor_id !== actor ||
    value.connection_id !== row.connection_id ||
    value.external_id !== row.external_id ||
    value.source_version_id !== row.source_version_id ||
    !uuid(value.audit_id) || !instant(value.read_at) ||
    Date.parse(value.read_at) < now - 300_000 ||
    Date.parse(value.read_at) > now + 60_000 ||
    !instant(value.source_observed_at) ||
    value.source_observed_at !== row.source_observed_at ||
    !bounded(value.status, 120) || !bounded(value.priority, 120) ||
    !bounded(value.description, 4000))
    throw unavailable();
  let exactDetail: ClientJobRecord["exactDetail"] = null;
  if (value.exact_detail !== null) {
    const exact = value.exact_detail;
    if (!object(exact) || !instant(exact.checked_at) ||
      Date.parse(exact.checked_at) > now + 60_000 ||
      !bounded(exact.stage, 200) || !bounded(exact.pipeline, 200) ||
      !bounded(exact.hold_reason, 200) ||
      !bounded(exact.provider_updated_at, 80) ||
      !Array.isArray(exact.source_users) || exact.source_users.length > 20 ||
      row.identity_state !== "reviewed_link")
      throw unavailable();
    const users = exact.source_users.map((person) => {
      if (!object(person) || typeof person.source_user_id !== "string" ||
        !/^(0|[1-9][0-9]{0,15})$/.test(person.source_user_id) ||
        typeof person.name !== "string" || person.name.length > 200)
        throw unavailable();
      return { id: person.source_user_id, name: person.name };
    });
    exactDetail = {
      checkedAt: exact.checked_at, stage: exact.stage,
      pipeline: exact.pipeline, sourceUsers: users,
      holdReason: exact.hold_reason,
      providerUpdatedAt: exact.provider_updated_at,
    };
  }
  return {
    sourceObservedAt: value.source_observed_at,
    readAt: value.read_at,
    auditId: value.audit_id,
    status: value.status,
    priority: value.priority,
    description: value.description,
    exactDetail,
  };
}
