import type { LearnReadClient } from "./learn-cards.ts";
import type { EvidenceRef } from "./learn-scorecards.ts";
const fields: Record<string, string[]> = {
  interactions: ["subject", "body_preview", "occurred_at", "source_connector_id"],
  email_messages: ["subject", "snippet", "sent_at", "received_at", "direction"],
  phone_calls: ["provider", "direction", "started_at", "duration_seconds", "outcome"],
  phone_recordings: ["provider", "started_at", "duration_seconds"],
  jobs: ["title", "job_number", "status", "source_system", "completed_date", "verified"],
  team_members: ["display_name", "formal_role", "confirmed_at", "effective_from", "effective_to"],
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export async function loadPerformanceEvidence(
  db: LearnReadClient,
  tenantId: string,
  ref: EvidenceRef,
): Promise<{ label: string; value: string }[]> {
  if (!uuid(tenantId) || !ref || !uuid(ref.id) || !Object.hasOwn(fields, ref.table))
    throw Error("Unsupported evidence reference");
  const names = fields[ref.table];
  const { data, error } = await db
    .from(ref.table)
    .select(["id", "tenant_id", ...names].join(","))
    .eq("tenant_id", tenantId)
    .eq("id", ref.id)
    .limit(2);
  if (
    error ||
    !Array.isArray(data) ||
    data.length !== 1 ||
    data[0].tenant_id !== tenantId ||
    data[0].id !== ref.id
  )
    throw Error("Evidence is unavailable with your current access");
  return names
    .filter((k) => data[0][k] !== null && data[0][k] !== undefined)
    .map((k) => {
      const value = data[0][k];
      if (!["string", "number", "boolean"].includes(typeof value))
        throw Error("Evidence format could not be verified");
      const text = String(value);
      return {
        label: k.replaceAll("_", " "),
        value: text.length > 4000 ? text.slice(0, 4000) + "… [excerpt shortened]" : text,
      };
    });
}
