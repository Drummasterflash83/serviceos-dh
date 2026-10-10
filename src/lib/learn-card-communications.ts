/** Bounded communication excerpts through the signed-in, company-scoped reader. */
import type { Row } from "./learn-cards.ts";
export interface LearnCommunicationClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export type CommunicationScope = { person?: string; company?: string; job?: string; ids?: string[] };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const columns = new Set(["id", "tenant_id", "source_connector_id", "source_type", "source_table", "source_id", "occurred_at", "subject", "summary", "body_preview", "status", "related_person_id", "related_company_id", "related_job_id"]);
export async function readCardCommunications(db: LearnCommunicationClient, tenant: string, scope: CommunicationScope): Promise<Row[]> {
  if (!uuid(tenant) || !scope || Object.keys(scope).some(k => !["person", "company", "job", "ids"].includes(k)) ||
      [scope.person, scope.company, scope.job].some(v => v !== undefined && !uuid(v)) ||
      (!scope.person && !scope.company && !scope.job && !scope.ids) ||
      (scope.job && (scope.person || scope.company)) ||
      (scope.ids !== undefined && (!Array.isArray(scope.ids) || !scope.ids.length || scope.ids.length > 50 || !scope.ids.every(uuid) || scope.person || scope.company || scope.job)))
    throw Error("Invalid communication scope");
  const { data, error } = await db.rpc("learn_card_communications_read", {
    p_tenant: tenant, p_person: scope.person ?? null, p_company: scope.company ?? null,
    p_job: scope.job ?? null, p_ids: scope.ids ?? null,
  });
  const envelope = data as any;
  if (error || !envelope || envelope.version !== "learn-card-communications/1" || envelope.tenant_id !== tenant || !Array.isArray(envelope.rows) || envelope.rows.length > 51)
    throw Error("Communications are unavailable with your current access");
  const seen = new Set<string>();
  for (const r of envelope.rows) {
    if (!r || !uuid(r.id) || seen.has(r.id) || r.tenant_id !== tenant || Object.keys(r).some(k => !columns.has(k)) ||
        ["related_person_id", "related_company_id", "related_job_id"].some(k => r[k] != null && !uuid(r[k])) ||
        ["subject", "summary", "body_preview"].some(k => r[k] != null && (typeof r[k] !== "string" || Array.from(r[k]).length > 4100)) ||
        ["source_connector_id", "source_type", "source_table", "source_id", "status"].some(k => r[k] != null && typeof r[k] !== "string") ||
        (r.occurred_at != null && (typeof r.occurred_at !== "string" || !Number.isFinite(Date.parse(r.occurred_at)))) ||
        ["deleted", "removed"].includes(r.status) ||
        !(scope.ids?.includes(r.id) || (scope.person && r.related_person_id === scope.person) || (scope.company && r.related_company_id === scope.company) || (scope.job && r.related_job_id === scope.job)))
      throw Error("Communication response failed scope validation");
    seen.add(r.id);
  }
  return envelope.rows;
}
