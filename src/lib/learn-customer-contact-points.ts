import type { InformationClient } from "./openfolk-client-information.ts";
export const contactChannels = {
  email: "Email",
  phone: "Phone",
  sms: "SMS",
  whatsapp: "WhatsApp",
  social: "Social",
  other: "Other",
} as const;
export type CustomerContactPoint = {
  id: string;
  channel: keyof typeof contactChannels;
  value: string;
  label: string | null;
  is_primary: boolean;
  verification_state: "unverified" | "verified" | "invalid";
  source: string;
  last_observed_at: string | null;
  updated_at: string;
  truncated_fields: ("value" | "label" | "source")[];
};
export type CustomerContactPointsPage = {
  rows: CustomerContactPoint[];
  total: number;
  next_after: string | null;
  observed_at: string;
};
export type CustomerContactPointsScope = {
  tenant: string;
  actor: string;
  card: string;
  person: string;
  operatorReason?: string;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(v);
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && [...v].length <= max;
const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const unavailable = () =>
  Error("Saved contact details could not be verified. Refresh or ask OpenFolk to check access.");
export async function readCustomerContactPoints(
  client: InformationClient,
  args: CustomerContactPointsScope & { after?: string | null },
  signal: AbortSignal,
): Promise<CustomerContactPointsPage> {
  const after = args.after ?? null,
    operator = args.operatorReason !== undefined;
  if (
    ![args.tenant, args.actor, args.card, args.person].every(uuid) ||
    (after !== null && !uuid(after)) ||
    (operator &&
      (typeof args.operatorReason !== "string" ||
        args.operatorReason.trim().length < 3 ||
        args.operatorReason.trim().length > 500))
  )
    throw unavailable();
  const { data: p, error } = await client
    .rpc("learn_customer_contact_points", {
      p_tenant: args.tenant,
      p_card: args.card,
      p_person: args.person,
      p_after: after,
      p_operator_reason: operator ? args.operatorReason!.trim() : null,
    })
    .abortSignal(signal);
  if (
    error ||
    !object(p) ||
    p.version !== "learn-customer-contact-points/1" ||
    p.tenant_id !== args.tenant ||
    p.actor_id !== args.actor ||
    p.card_id !== args.card ||
    p.person_id !== args.person ||
    p.after !== after ||
    p.operator_mode !== operator ||
    (operator ? !uuid(p.audit_id) : p.audit_id !== null) ||
    !Array.isArray(p.rows) ||
    p.rows.length > 25 ||
    !Number.isSafeInteger(p.total) ||
    p.total < p.rows.length ||
    !date(p.observed_at) ||
    Date.parse(p.observed_at) > Date.now() + 60000 ||
    Date.parse(p.observed_at) < Date.now() - 300000 ||
    (p.next_after !== null && !uuid(p.next_after))
  )
    throw unavailable();
  if (after === null && p.total > p.rows.length && p.next_after === null) throw unavailable();
  let prior = after;
  const keys = [
    "id",
    "channel",
    "value",
    "label",
    "is_primary",
    "verification_state",
    "source",
    "last_observed_at",
    "updated_at",
    "truncated_fields",
  ]
    .sort()
    .join();
  for (const row of p.rows) {
    if (
      !object(row) ||
      Object.keys(row).sort().join() !== keys ||
      !uuid(row.id) ||
      (prior !== null && row.id <= prior) ||
      !Object.hasOwn(contactChannels, row.channel) ||
      !text(row.value, 4000) ||
      (row.label !== null && !text(row.label, 200)) ||
      typeof row.is_primary !== "boolean" ||
      !["unverified", "verified", "invalid"].includes(row.verification_state) ||
      !text(row.source, 100) ||
      (row.last_observed_at !== null && !date(row.last_observed_at)) ||
      !date(row.updated_at) ||
      !Array.isArray(row.truncated_fields) ||
      new Set(row.truncated_fields).size !== row.truncated_fields.length ||
      row.truncated_fields.some(
        (f: unknown) => typeof f !== "string" || !["value", "label", "source"].includes(f),
      )
    )
      throw unavailable();
    prior = row.id;
  }
  if (
    p.next_after !== null &&
    (p.rows.length !== 25 || p.next_after !== prior || p.total <= p.rows.length)
  )
    throw unavailable();
  return { rows: p.rows, total: p.total, next_after: p.next_after, observed_at: p.observed_at };
}
