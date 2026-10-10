/** Original-source excerpts through the restricted, company-scoped reader. */
import type { LearnCommunicationClient } from "./learn-card-communications.ts";
import type { Row } from "./learn-cards.ts";
export const CARD_SOURCE_FIELDS = {
  email_messages: ["subject", "snippet", "sent_at", "received_at", "direction"],
  phone_calls: ["provider", "direction", "started_at", "duration_seconds", "outcome"],
  phone_recordings: ["provider", "started_at", "duration_seconds"],
} as const;
export type CardSourceTable = keyof typeof CARD_SOURCE_FIELDS;
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const times = new Set(["sent_at", "received_at", "started_at"]);
export async function readCardSource(
  db: LearnCommunicationClient,
  tenant: string,
  table: string,
  id: string,
): Promise<Row> {
  if (!uuid(tenant) || !uuid(id) || !Object.hasOwn(CARD_SOURCE_FIELDS, table))
    throw Error("Unsupported source reference");
  const { data, error } = await db.rpc("learn_card_source_read", {
    p_tenant: tenant,
    p_table: table,
    p_id: id,
  });
  const envelope = data as any;
  if (
    error ||
    !envelope ||
    envelope.version !== "learn-card-source/1" ||
    envelope.tenant_id !== tenant ||
    envelope.table !== table ||
    envelope.id !== id ||
    Object.keys(envelope).some(
      (k) => !["version", "tenant_id", "table", "id", "record"].includes(k),
    )
  )
    throw Error("Source response failed scope validation");
  const r = envelope.record;
  if (!r) throw Error("Source is unavailable with your current access");
  const fields = CARD_SOURCE_FIELDS[table as CardSourceTable];
  const allowed = new Set<string>(["id", "tenant_id", ...fields]);
  if (
    r.id !== id ||
    r.tenant_id !== tenant ||
    Object.keys(r).some((k) => !allowed.has(k)) ||
    fields.some((k) => !Object.hasOwn(r, k))
  )
    throw Error("Source response failed field validation");
  for (const k of fields) {
    const v = r[k];
    if (v === null) continue;
    if (k === "duration_seconds") {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
        throw Error("Source duration could not be verified");
    } else if (
      typeof v !== "string" ||
      Array.from(v).length > 4100 ||
      (times.has(k) && !Number.isFinite(Date.parse(v)))
    )
      throw Error("Source metadata could not be verified");
  }
  return r;
}
