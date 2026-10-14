/** A server-checked retained source may be observed without customer attribution.
 * This binding is supplied by the worker, never accepted from job payload/metadata.
 * It does not approve an identity, job link, staff score or executable action.
 */
export interface RetainedSourceContext {
  version: "learn-retained-source-context/1";
  tenant_id: string;
  interaction_id: string;
  source_id: string;
  source_version: string;
  interaction_updated_at: string;
  scope: "company_source";
  attribution: "unresolved";
}
export interface SourceContextInput {
  id?: string;
  tenant_id?: string;
  source_id?: string | null;
  updated_at?: string;
  metadata?: unknown;
  related_person_id?: string | null;
  related_company_id?: string | null;
  related_job_id?: string | null;
  retainedSourceContext?: RetainedSourceContext | null;
}
// Supabase emits UTC ISO timestamps with PostgreSQL microsecond precision.
// Date.parse alone truncates that precision and can admit a stale source revision.
function utcTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
  if (!m || !Number.isFinite(Date.parse(value))) return null;
  return `${m[1]}.${(m[2] ?? "").padEnd(6, "0")}`;
}
export function retainedSourceContext(i: SourceContextInput): RetainedSourceContext | null {
  const p = i.retainedSourceContext,
    m = i.metadata as Record<string, unknown> | null;
  if (
    !p ||
    p.version !== "learn-retained-source-context/1" ||
    p.scope !== "company_source" ||
    p.attribution !== "unresolved" ||
    p.tenant_id !== i.tenant_id ||
    p.interaction_id !== i.id ||
    p.source_id !== i.source_id ||
    p.source_version !== m?.source_version ||
    !/^[a-f0-9]{64}$/.test(p.source_version) ||
    !i.updated_at ||
    utcTimestamp(p.interaction_updated_at) === null ||
    utcTimestamp(p.interaction_updated_at) !== utcTimestamp(i.updated_at) ||
    i.related_person_id != null ||
    i.related_company_id != null ||
    i.related_job_id != null
  )
    return null;
  return p;
}
