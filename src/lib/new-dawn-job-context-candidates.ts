import type { InformationClient } from "./openfolk-client-information.ts";

export type JobContextCandidate = {
  interaction_id: string;
  source_table: "phone_calls" | "email_messages" | "slack_messages";
  source_id: string;
  occurred_at: string;
  customer_evidence: "person" | "company" | "person_and_company";
  job_identity: "unverified";
};

export type JobContextPage = {
  job_id: string;
  commusoft_job_source_id: string;
  commusoft_job_source_version_id: string;
  read_at: string;
  audit_id: string;
  has_more: boolean;
  candidates: JobContextCandidate[];
};

const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const recent = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) &&
  Date.parse(v) >= Date.now() - 300000 && Date.parse(v) <= Date.now() + 60000;
const fail = () => Error("Job context could not be verified. Check access and retry.");

export function parseJobContextCandidates(
  value: unknown,
  tenant: string,
  actor: string,
  job: string,
): JobContextPage {
  if (!object(value)) throw fail();
  const p = value;
  if (
    p.version !== "new-dawn-job-context-candidates/1" || p.tenant_id !== tenant ||
    p.actor_id !== actor || p.job_id !== job || !uuid(p.audit_id) ||
    !uuid(p.commusoft_job_source_version_id) ||
    typeof p.commusoft_job_source_id !== "string" ||
    !recent(p.read_at) || p.window_days !== 90 ||
    !["customer_context_only", "no_reviewed_customer_context"].includes(String(p.state)) ||
    p.job_source_freshness !== "unverified" ||
    p.communication_freshness !== "retained_occurrence_only" ||
    p.job_link_state !== "unverified" ||
    p.finance_state !== "held_no_reviewed_cross_provider_job_mapping" ||
    typeof p.has_more !== "boolean" || !Array.isArray(p.candidates) ||
    p.candidates.length > 20
  ) throw fail();
  const candidates: JobContextCandidate[] = [];
  for (const raw of p.candidates) {
    if (!object(raw) || !uuid(raw.interaction_id) || !uuid(raw.source_id) ||
      !["phone_calls", "email_messages", "slack_messages"].includes(String(raw.source_table)) ||
      !["person", "company", "person_and_company"].includes(String(raw.customer_evidence)) ||
      raw.job_identity !== "unverified" || typeof raw.occurred_at !== "string" ||
      !Number.isFinite(Date.parse(raw.occurred_at)) ||
      Date.parse(raw.occurred_at) > Date.now() + 60000 ||
      Date.parse(raw.occurred_at) < Date.now() - 91 * 86400000
    ) throw fail();
    candidates.push(raw as JobContextCandidate);
  }
  if (p.state === "no_reviewed_customer_context" && candidates.length) throw fail();
  return {
    job_id: job,
    commusoft_job_source_id: p.commusoft_job_source_id,
    commusoft_job_source_version_id: p.commusoft_job_source_version_id,
    read_at: p.read_at,
    audit_id: p.audit_id,
    has_more: p.has_more,
    candidates,
  };
}

export async function readJobContextCandidates(
  client: InformationClient,
  args: { tenant: string; actor: string; job: string; reason: string },
  signal: AbortSignal,
): Promise<JobContextPage> {
  if (!uuid(args.tenant) || !uuid(args.actor) || !uuid(args.job) ||
    typeof args.reason !== "string" || args.reason.trim().length < 3 ||
    args.reason.trim().length > 500) throw fail();
  const { data, error } = await client.rpc("new_dawn_job_context_candidates", {
    p_tenant: args.tenant,
    p_job: args.job,
    p_reason: args.reason.trim(),
    p_limit: 20,
  }).abortSignal(signal);
  if (error) throw fail();
  return parseJobContextCandidates(data, args.tenant, args.actor, args.job);
}
