import type {
  BusinessSourceIdentity,
  BusinessSourceRecord,
} from "../business_inputs/source_record.ts";
import type { CommusoftPage, CommusoftResource } from "./read_page.ts";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const id = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
function personName(raw: Record<string, unknown>): string | null {
  return [text(raw.firstName), text(raw.lastName)].filter(Boolean).join(" ") || null;
}

/** Pure adapter after a validated read. No deduplication by name/email, deletion,
 * scoring, synthetic historical timestamp or guessed ownership is performed here.
 * A candidate still requires canonical relationship resolution before publication.
 */
export function commusoftSourceRecords(
  page: CommusoftPage,
  scope: {
    tenantId: string;
    connectionId: string;
    resource: CommusoftResource;
    observedAt: string;
  },
): BusinessSourceRecord[] {
  if (
    !uuid.test(scope.tenantId) ||
    !uuid.test(scope.connectionId) ||
    !["properties", "propertyContacts", "jobs"].includes(scope.resource) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(scope.observedAt) ||
    !Number.isFinite(Date.parse(scope.observedAt)) ||
    new Date(scope.observedAt).toISOString() !== scope.observedAt
  )
    throw Error("commusoft_source_scope_invalid");
  const seen = new Set<number>();
  return page.records.map((row) => {
    if (!id(row.id) || seen.has(row.id)) throw Error("commusoft_source_identity_invalid");
    seen.add(row.id);
    const raw = structuredClone(row);
    const identity = (collection: string, externalId: number): BusinessSourceIdentity => ({
      tenantId: scope.tenantId,
      connectionId: scope.connectionId,
      provider: "commusoft",
      collection,
      externalId: String(externalId),
    });
    let projection: BusinessSourceRecord["projection"];
    if (scope.resource === "properties" && row.type !== "customer" && row.type !== "workaddress") {
      projection = { state: "held", reason: "unknown_property_type" };
    } else if (scope.resource === "properties" && row.type === "customer") {
      const contact =
        row.contact !== null && typeof row.contact === "object" && !Array.isArray(row.contact)
          ? (row.contact as Record<string, unknown>)
          : {};
      projection = {
        state: "candidate",
        kind: "customer",
        displayName: text(row.companyName) ?? personName(contact),
        sourceStatus: text(row.status),
        references: [],
      };
    } else {
      const site = scope.resource === "properties";
      const property = site ? row.parentPropertyID : row.propertyID;
      if (!id(property)) projection = { state: "held", reason: "missing_property_reference" };
      else if (site && property === row.id)
        projection = { state: "held", reason: "self_parent_reference" };
      else
        projection = {
          state: "candidate",
          kind: site ? "site" : scope.resource === "jobs" ? "job" : "contact",
          displayName: site
            ? text(row.addressLine1)
            : scope.resource === "jobs"
              ? text(row.description)
              : personName(row),
          sourceStatus: text(row.status),
          // A job's property can be a customer OR work address. Resolve it first;
          // never substitute propertyID directly into customer_person_id/site_id.
          references: [
            {
              relation: site ? "customer_property" : "property",
              target: identity("properties", property),
            },
          ],
        };
    }
    return {
      identity: identity(scope.resource, row.id),
      observedAt: scope.observedAt,
      raw,
      projection,
    };
  });
}
