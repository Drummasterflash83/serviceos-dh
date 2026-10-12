import type { InformationClient } from "./openfolk-client-information.ts";
export const businessCollections = { jobs: "Jobs", sites: "Sites", contacts: "Contacts" } as const;
export type BusinessCollection = keyof typeof businessCollections;
export type BusinessContextRow = {
  id: string;
  fields: Record<string, any>;
  truncated_fields: string[];
  sources: {
    provider: string;
    collection: string;
    external_id: string;
    version_id: string;
    first_seen_at: string;
  }[];
};
export type BusinessContextPage = {
  collection: BusinessCollection;
  rows: BusinessContextRow[];
  total: number;
  next_after: string | null;
  observed_at: string;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const object = (v: any): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const fields = {
  sites: [
    "label",
    "address_text",
    "postcode",
    "verified",
    "source_system",
    "external_id",
    "updated_at",
  ],
  jobs: [
    "title",
    "job_number",
    "description",
    "status",
    "priority",
    "site_id",
    "verified",
    "source_system",
    "external_id",
    "created_date",
    "completed_date",
    "updated_at",
    "time_evidence",
  ],
  contacts: ["display_name", "primary_email", "primary_phone", "verified", "updated_at"],
};
const unavailable = () =>
  Error("Linked business records could not be verified. Refresh or ask OpenFolk to check access.");
const timeShape = (v: any) =>
  object(v) &&
  Object.keys(v).length === 2 &&
  ["created", "completed"].every(
    (k) =>
      object(v[k]) &&
      Object.keys(v[k]).length === 3 &&
      ["state", "source", "instant"].every(
        (f) =>
          Object.hasOwn(v[k], f) &&
          (v[k][f] === null || (typeof v[k][f] === "string" && v[k][f].length <= 100)),
      ),
  );
export async function readCustomerBusinessContext(
  client: InformationClient,
  args: {
    tenant: string;
    actor: string;
    card: string;
    collection: BusinessCollection;
    after?: string | null;
    operatorReason?: string;
  },
  signal: AbortSignal,
): Promise<BusinessContextPage> {
  const after = args.after ?? null;
  const operator = args.operatorReason !== undefined;
  if (
    ![args.tenant, args.actor, args.card].every(uuid) ||
    !Object.hasOwn(businessCollections, args.collection) ||
    (after !== null && !uuid(after)) ||
    (operator &&
      (typeof args.operatorReason !== "string" ||
        args.operatorReason.trim().length < 3 ||
        args.operatorReason.trim().length > 500))
  )
    throw unavailable();
  const { data: p, error } = await client
    .rpc("learn_customer_business_context", {
      p_tenant: args.tenant,
      p_card: args.card,
      p_collection: args.collection,
      p_after: after,
      p_operator_reason: operator ? args.operatorReason!.trim() : null,
    })
    .abortSignal(signal);
  if (
    error ||
    !object(p) ||
    p.version !== "learn-customer-business-context/1" ||
    p.tenant_id !== args.tenant ||
    p.actor_id !== args.actor ||
    p.card_id !== args.card ||
    p.collection !== args.collection ||
    p.after !== after ||
    p.operator_mode !== operator ||
    (operator ? !uuid(p.audit_id) : p.audit_id !== null) ||
    !Array.isArray(p.rows) ||
    p.rows.length > 25 ||
    !Number.isSafeInteger(p.total) ||
    p.total < p.rows.length ||
    !Number.isFinite(Date.parse(p.observed_at)) ||
    Date.parse(p.observed_at) > Date.now() + 60000 ||
    Date.parse(p.observed_at) < Date.now() - 300000 ||
    (p.next_after !== null && !uuid(p.next_after))
  )
    throw unavailable();
  let prior = after;
  for (const row of p.rows) {
    if (
      !object(row) ||
      !uuid(row.id) ||
      (prior && row.id <= prior) ||
      !object(row.fields) ||
      Object.keys(row.fields).length !== fields[args.collection].length ||
      !fields[args.collection].every((k) => Object.hasOwn(row.fields, k)) ||
      Object.entries(row.fields).some(([k, v]) =>
        k === "time_evidence"
          ? !timeShape(v)
          : k === "verified"
            ? typeof v !== "boolean"
            : v !== null && !(typeof v === "string" && [...v].length <= 4000),
      ) ||
      !Array.isArray(row.truncated_fields) ||
      !row.truncated_fields.every(
        (k: unknown) => typeof k === "string" && fields[args.collection].includes(k),
      ) ||
      !Array.isArray(row.sources) ||
      row.sources.length > 5 ||
      row.sources.some(
        (s: any) =>
          !object(s) ||
          Object.keys(s).length !== 5 ||
          !uuid(s.version_id) ||
          !Number.isFinite(Date.parse(s.first_seen_at)) ||
          ![s.provider, s.collection, s.external_id].every(
            (v) => typeof v === "string" && v.length > 0 && v.length <= 2000,
          ),
      )
    )
      throw unavailable();
    prior = row.id;
  }
  if (p.next_after !== null && (p.rows.length !== 25 || p.next_after !== prior))
    throw unavailable();
  return {
    collection: args.collection,
    rows: p.rows,
    total: p.total,
    next_after: p.next_after,
    observed_at: p.observed_at,
  };
}
