import { normalizeCall, record } from "./receptionist-data.ts";
import { practiceCallMatches } from "./receptionist-web-call.ts";
import {
  REVIEW_VERSION,
  evidenceHash,
  reviewConversation,
  type Assessment,
} from "./receptionist-care.ts";

export type ReviewSettings = { approved_rules: string; version: number; enabled: boolean };
export type CareJob = { tenant_id: string; call_id: string; lease_id: string };
export type ReviewDependencies = {
  settings: (tenant: string) => Promise<ReviewSettings>;
  workspace: (tenant: string) => Promise<{ assistant_id: string; key: string }>;
  practiceSession: (tenant: string, call: string) => Promise<string | null>;
  feedback: (tenant: string, call: string) => Promise<string[]>;
  cached: (
    tenant: string,
    call: string,
    hash: string,
    reviewer: string,
  ) => Promise<Assessment | null>;
  complete: (job: CareJob, hash: string, reviewer: string, assessment: Assessment) => Promise<void>;
  fetcher?: typeof fetch;
  reviewKey: string;
  model: string;
};
// Exactly the same evidence and scope checks serve manual and background reviews.
export async function runCareReview(job: CareJob, deps: ReviewDependencies) {
  const settings = await deps.settings(job.tenant_id);
  if (!settings.enabled || !settings.approved_rules.trim()) throw Error("approved_rules_required");
  const workspace = await deps.workspace(job.tenant_id);
  if (!workspace.key || !deps.reviewKey || !deps.model) throw Error("review_connection_required");
  const fetcher = deps.fetcher ?? fetch;
  const response = await fetcher(`https://api.vapi.ai/call/${job.call_id}`, {
    headers: { Authorization: `Bearer ${workspace.key}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error("call_evidence_unavailable");
  const raw = record(await response.json());
  if (raw.id !== job.call_id) throw Error("call_scope_invalid");
  if (raw.assistantId !== workspace.assistant_id) {
    const session = await deps.practiceSession(job.tenant_id, job.call_id);
    if (!session || !practiceCallMatches(raw, session, job.tenant_id))
      throw Error("call_scope_invalid");
  }
  const call = normalizeCall(raw);
  if (call.status !== "ended") throw Error("awaiting_completed_call");
  if (!call.transcript) throw Error("awaiting_transcript");
  const feedback = await deps.feedback(job.tenant_id, job.call_id);
  // Fail before cache/model when evidence is incomplete or beyond the agreed bound.
  if (feedback.join("\n").length > 20000 || call.transcript.length > 60000)
    throw Error("evidence_too_large");
  const hash = await evidenceHash({
    transcript: call.transcript,
    feedback,
    rules: settings.approved_rules,
    rulesVersion: settings.version,
    callType: call.type,
    assistantVersion: typeof raw.assistantVersion === "string" ? raw.assistantVersion : null,
  });
  const reviewer = `${REVIEW_VERSION}:${deps.model}`;
  const cached = await deps.cached(job.tenant_id, job.call_id, hash, reviewer);
  const assessment =
    cached ??
    (await reviewConversation({
      transcript: call.transcript,
      approvedRules: settings.approved_rules,
      feedback,
      callType: call.type,
      key: deps.reviewKey,
      model: deps.model,
      fetcher,
    }));
  const current = await deps.settings(job.tenant_id);
  if (
    !current.enabled ||
    current.version !== settings.version ||
    current.approved_rules !== settings.approved_rules
  )
    throw Error("review_settings_changed");
  // The lease-aware SQL completion stores review + issues + acknowledgement atomically.
  await deps.complete(job, hash, reviewer, assessment);
  return { replayed: !!cached, findings: assessment.findings.length };
}
