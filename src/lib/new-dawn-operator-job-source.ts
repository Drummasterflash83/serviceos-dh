import type { ReviewClient } from "./learn-commusoft-review.ts";
import { parseCommusoftJobDetails, type JobDetails } from "./learn-commusoft-job-details.ts";

export type OperatorJobSource = {
  version: "new-dawn-operator-job-source/1";
  tenant_id: string;
  actor_id: string;
  job_id: string;
  audit_id: string;
  observed_at: string;
  state: "linked" | "unlinked" | "review_required";
  source: JobDetails | null;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const unavailable = () => Error("Audited job source is unavailable. Reopen the job to check access and saved evidence.");

export function parseOperatorJobSource(value: unknown, tenant: string, actor: string, job: string,
  now = Date.now()): OperatorJobSource {
  if (!object(value) || Object.keys(value).sort().join() !==
      ["actor_id", "audit_id", "job_id", "observed_at", "source", "state", "tenant_id", "version"].join() ||
      value.version !== "new-dawn-operator-job-source/1" ||
      value.tenant_id !== tenant || value.actor_id !== actor || value.job_id !== job ||
      !uuid(value.audit_id) || typeof value.observed_at !== "string" ||
      !Number.isFinite(Date.parse(value.observed_at)) ||
      Date.parse(value.observed_at) < now - 300000 ||
      Date.parse(value.observed_at) > now + 60000 ||
      !["linked", "unlinked", "review_required"].includes(String(value.state)) ||
      (value.state !== "linked" && value.source !== null)) throw unavailable();
  if (value.state === "linked") {
    if (!object(value.source) || !uuid(value.source.connection_id) ||
        !uuid(value.source.version_id) || typeof value.source.external_id !== "string") throw unavailable();
    parseCommusoftJobDetails(value.source, tenant, value.source.connection_id,
      value.source.version_id, value.source.external_id);
  }
  return value as OperatorJobSource;
}

export async function readOperatorJobSource(db: ReviewClient, tenant: string, actor: string,
  job: string, reason: string): Promise<OperatorJobSource> {
  if (![tenant, actor, job].every(uuid) || reason.trim().length < 3 || reason.trim().length > 500)
    throw unavailable();
  try {
    const { data, error } = await db.rpc("new_dawn_operator_job_source", {
      p_tenant: tenant, p_job: job, p_reason: reason.trim(),
    });
    if (error) throw unavailable();
    return parseOperatorJobSource(data, tenant, actor, job);
  } catch {
    throw unavailable();
  }
}
