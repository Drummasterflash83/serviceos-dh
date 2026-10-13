/** A read-only proposal builder. This never writes a link or claims human review.
 * Callers must obtain the canonical proofs through tenant-scoped database reads,
 * then use the existing revision-checked operator work-context review to publish.
 */
export const SLACK_JOB_CONTEXT_CANDIDATE_VERSION = "slack-job-context-candidate/1";
export type ExplicitJobReference = { number: string; start: number; end: number; form: "job" | "commusoft" | "hash" | "jn" };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

/** One recognised number is a review hint, never evidence that the whole message
 * concerns only that job: summaries can contain other jobs/customers in free text.
 * No bare numbers, names, URLs, partial numeric runs or implicit thread inheritance.
 * URL references require a separately reviewed provider URL grammar; this parser
 * deliberately excludes URL tokens rather than guessing their account/job meaning.
 */
export function explicitSlackJobReferences(text: string): ExplicitJobReference[] {
  if (typeof text !== "string" || text.length > 100_000) return [];
  const result: ExplicitJobReference[] = [];
  const re = /(^|[^\p{L}\p{N}_])((job(?:[ \t]+number)?|commusoft|jn)[ \t]*[:#-]?[ \t]*|#)([0-9]{4,8})(?![\p{L}\p{N}_]|[.,][0-9])/giu;
  for (const match of text.matchAll(re)) {
    const start = match.index! + match[1].length;
    const end = match.index! + match[0].length;
    // Reject matches inside any URL token, including Slack's <URL|label> form.
    const before = text.slice(0, start).match(/\S*$/)?.[0] ?? "";
    const token = before + (text.slice(start).match(/^\S*/)?.[0] ?? "");
    if (/https?:\/\/|www\.|mailto:/i.test(token)) continue;
    const rest = text.slice(end);
    // Spaced phone-like continuations are not a complete explicit job token.
    if (/^[ -]+\d/.test(rest)) continue;
    result.push({ number: match[4], start, end, form: match[2] === "#" ? "hash" : match[3].toLowerCase().startsWith("job") ? "job" : match[3].toLowerCase() === "jn" ? "jn" : "commusoft" });
    if (result.length > 20) return []; // bounded evidence; caller separately detects oversize inputs
  }
  return result;
}

export interface CanonicalJobProof {
  tenantId: string;
  connectionId: string;
  provider: string;
  sourceSystem: string;
  jobId: string;
  jobNumber: string;
  externalId: string;
  linkedExternalId: string;
  collection: "jobs";
  entityKind: "job";
  linkedEntityId: string;
  sourceVersionId: string;
  canonicalSourceVersionId: string;
  latestSourceVersionId: string;
}
export interface SlackJobContextInput {
  tenantId: string;
  connection: { id: string; provider: string; sourceSystem: string; active: boolean };
  source: { id: string; tenantId: string; teamId: string; channelId: string; sourceVersion: string; text: string; kind: "conversation" | "channel_activity"; visibility: "public" | "private" | "direct_message"; status: "active" | "deleted" };
  interaction: { id: string; tenantId: string; sourceId: string; sourceVersion: string; direction: string | null; relatedJobId: string | null; workContext?: unknown };
  /** Exact lookup results for candidate job numbers; never all tenant records. */
  jobs: CanonicalJobProof[];
}
export type SlackJobContextResult = {
  version: typeof SLACK_JOB_CONTEXT_CANDIDATE_VERSION;
  state: "held";
  reason: "invalid_source" | "source_changed" | "connection_unavailable" | "existing_context" | "no_explicit_reference" | "multiple_references" | "lookup_scope_mismatch" | "job_not_published" | "ambiguous_job" | "job_provenance_changed";
} | {
  version: typeof SLACK_JOB_CONTEXT_CANDIDATE_VERSION;
  state: "candidate_review_required";
  tenantId: string;
  interactionId: string;
  jobId: string;
  direction: string | null;
  attribution: "unchanged";
  evidence: { sourceId: string; sourceVersion: string; teamId: string; channelId: string; connectionId: string; jobSourceVersionId: string; reference: ExplicitJobReference };
};
export function proposeSlackJobContext(input: SlackJobContextInput): SlackJobContextResult {
  const held = (reason: Extract<SlackJobContextResult, { state: "held" }>["reason"]): SlackJobContextResult => ({ version: SLACK_JOB_CONTEXT_CANDIDATE_VERSION, state: "held", reason });
  const { source, interaction, connection, jobs } = input;
  if (!uuid(input.tenantId) || !source || !interaction || !uuid(source.id) || !uuid(interaction.id) ||
    source.tenantId !== input.tenantId || interaction.tenantId !== input.tenantId || interaction.sourceId !== source.id ||
    !/^T[A-Z0-9]+$/.test(source.teamId) || !/^C[A-Z0-9]+$/.test(source.channelId) || !hash(source.sourceVersion) ||
    source.kind !== "conversation" || source.visibility !== "public" || source.status !== "active" || typeof source.text !== "string" || source.text.length > 100_000)
    return held("invalid_source");
  if (interaction.sourceVersion !== source.sourceVersion) return held("source_changed");
  if (!connection || !uuid(connection.id) || !connection.active || !connection.provider ||
    connection.sourceSystem !== `${connection.provider}:connection:${connection.id}`) return held("connection_unavailable");
  if (interaction.relatedJobId !== null || interaction.workContext != null) return held("existing_context");
  const refs = explicitSlackJobReferences(source.text);
  const numbers = [...new Set(refs.map(r => r.number))];
  if (!numbers.length) return held("no_explicit_reference");
  if (numbers.length !== 1) return held("multiple_references");
  if (!Array.isArray(jobs) || jobs.length > 50 || jobs.some(j => j.tenantId !== input.tenantId || j.connectionId !== connection.id ||
    j.provider !== connection.provider || j.sourceSystem !== connection.sourceSystem || j.jobNumber !== numbers[0]))
    return held("lookup_scope_mismatch");
  if (!jobs.length) return held("job_not_published");
  if (jobs.length !== 1) return held("ambiguous_job");
  const job = jobs[0];
  if (!uuid(job.jobId) || job.entityKind !== "job" || job.collection !== "jobs" || job.linkedEntityId !== job.jobId ||
    !job.externalId || job.linkedExternalId !== job.externalId || !uuid(job.sourceVersionId) ||
    job.canonicalSourceVersionId !== job.sourceVersionId || job.latestSourceVersionId !== job.sourceVersionId)
    return held("job_provenance_changed");
  return {
    version: SLACK_JOB_CONTEXT_CANDIDATE_VERSION, state: "candidate_review_required", tenantId: input.tenantId,
    interactionId: interaction.id, jobId: job.jobId, direction: interaction.direction, attribution: "unchanged",
    evidence: { sourceId: source.id, sourceVersion: source.sourceVersion, teamId: source.teamId, channelId: source.channelId,
      connectionId: connection.id, jobSourceVersionId: job.sourceVersionId, reference: refs[0] },
  };
}
