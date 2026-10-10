/** Provider-neutral input boundary. Source identities are never canonical row IDs.
 * Persistence must retain raw records, then resolve references within this exact
 * tenant + connection before publishing customer/site/contact/job projections.
 */
export interface BusinessSourceIdentity {
  tenantId: string;
  connectionId: string;
  provider: string;
  collection: string;
  externalId: string;
}
export interface BusinessSourceRecord {
  identity: BusinessSourceIdentity;
  observedAt: string;
  raw: Record<string, unknown>;
  projection:
    | {
        state: "held";
        reason: "unknown_property_type" | "missing_property_reference" | "self_parent_reference";
      }
    | {
        state: "candidate";
        kind: "customer" | "site" | "contact" | "job";
        displayName: string | null;
        sourceStatus: string | null;
        references: {
          relation: "customer_property" | "property";
          target: BusinessSourceIdentity;
        }[];
      };
}
