import {
  readCardCommunications,
  type LearnCommunicationClient,
} from "./learn-card-communications.ts";
import { readCardSource, CARD_SOURCE_FIELDS } from "./learn-card-sources.ts";
import type { LearnReadClient } from "./learn-cards.ts";
import type { EvidenceRef } from "./learn-scorecards.ts";
const fields: Record<string, string[]> = {
  learn_work_measurement_runs: [
    "source_system",
    "metric_key",
    "observed_at",
    "explanation",
    "proof",
  ],
  interactions: ["subject", "summary", "body_preview", "occurred_at", "source_connector_id"],
  ...Object.fromEntries(
    Object.entries(CARD_SOURCE_FIELDS).map(([key, value]) => [key, [...value]]),
  ),
  jobs: ["title", "job_number", "status", "source_system", "completed_date", "verified"],
  team_members: ["display_name", "formal_role", "confirmed_at", "effective_from", "effective_to"],
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export async function loadPerformanceEvidence(
  db: LearnReadClient & Partial<LearnCommunicationClient>,
  tenantId: string,
  ref: EvidenceRef,
): Promise<{ label: string; value: string }[]> {
  if (!uuid(tenantId) || !ref || !uuid(ref.id) || !Object.hasOwn(fields, ref.table))
    throw Error("Unsupported evidence reference");
  const names = fields[ref.table];
  let record: Record<string, any>;
  if (ref.table === "interactions" || Object.hasOwn(CARD_SOURCE_FIELDS, ref.table)) {
    if (typeof db.rpc !== "function") throw Error("A signed-in source reader is required");
    const client: LearnCommunicationClient = { rpc: (name, args) => db.rpc!(name, args) };
    if (ref.table === "interactions") {
      const rows = await readCardCommunications(client, tenantId, { ids: [ref.id] });
      if (rows.length !== 1) throw Error("Evidence is unavailable with your current access");
      record = rows[0];
    } else record = await readCardSource(client, tenantId, ref.table, ref.id);
  } else {
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
    record = data[0];
  }
  return names
    .filter((k) => record[k] !== null && record[k] !== undefined)
    .map((k) => {
      let value = record[k];
      if (ref.table === "learn_work_measurement_runs" && k === "proof") {
        if (
          !value ||
          !["work-handoffs@1", "work-residence@1"].includes(value.contract) ||
          !Array.isArray(value.items) ||
          !Array.isArray(value.credited)
        )
          throw Error("Calculation proof could not be verified");
        value = JSON.stringify(value, null, 2);
      }
      if (!["string", "number", "boolean"].includes(typeof value))
        throw Error("Evidence format could not be verified");
      const text = String(value);
      return {
        label: k.replaceAll("_", " "),
        value:
          !["interactions", ...Object.keys(CARD_SOURCE_FIELDS)].includes(ref.table) &&
          !(ref.table === "learn_work_measurement_runs" && k === "proof") &&
          text.length > 4000
            ? text.slice(0, 4000) + "… [excerpt shortened]"
            : text,
      };
    });
}
