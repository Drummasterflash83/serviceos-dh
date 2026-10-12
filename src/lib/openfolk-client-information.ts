/** Operator-only content reads; every request is authorised and audited by SQL. */
export const clientInformationCollections = {
  customers: "Customer cards",
  contacts: "Contacts",
  companies: "Companies",
  sites: "Sites",
  jobs: "Jobs",
  emails: "Emails",
  calls: "Calls",
  recordings: "Recording records",
  transcripts: "Transcripts",
  communications: "Processed communications",
  business_sources: "Retained business inputs",
} as const;
export type InformationCollection = keyof typeof clientInformationCollections;
export type InformationRow = {
  id: string;
  fields: Record<string, unknown>;
  truncated_fields: string[];
};
export type InformationPage = {
  version: "openfolk-client-information/1";
  tenant_id: string;
  actor_id: string;
  collection: InformationCollection;
  after: string | null;
  record: string | null;
  rows: InformationRow[];
  next_after: string | null;
  observed_at: string;
  audit_id: string;
};
export interface InformationClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): { abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> };
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const failure = () =>
  Error("Client information could not be verified. Check your operator access and try again.");
export async function readClientInformation(
  client: InformationClient,
  args: {
    tenant: string;
    actor: string;
    collection: InformationCollection;
    reason: string;
    after?: string | null;
    record?: string | null;
  },
  signal: AbortSignal,
): Promise<InformationPage> {
  const after = args.after ?? null,
    record = args.record ?? null;
  if (
    !uuid(args.tenant) ||
    !uuid(args.actor) ||
    !Object.hasOwn(clientInformationCollections, args.collection) ||
    typeof args.reason !== "string" ||
    args.reason.trim().length < 3 ||
    args.reason.trim().length > 500 ||
    (after !== null && !uuid(after)) ||
    (record !== null && !uuid(record)) ||
    (after && record)
  )
    throw failure();
  const { data: p, error } = await client
    .rpc("openfolk_client_information", {
      p_tenant: args.tenant,
      p_collection: args.collection,
      p_reason: args.reason.trim(),
      p_after: after,
      p_record: record,
    })
    .abortSignal(signal);
  if (
    error ||
    !object(p) ||
    p.version !== "openfolk-client-information/1" ||
    p.tenant_id !== args.tenant ||
    p.actor_id !== args.actor ||
    p.collection !== args.collection ||
    p.after !== after ||
    p.record !== record ||
    !uuid(p.audit_id) ||
    !Array.isArray(p.rows) ||
    p.rows.length > 25 ||
    !Number.isFinite(Date.parse(p.observed_at)) ||
    Date.parse(p.observed_at) > Date.now() + 60000 ||
    Date.parse(p.observed_at) < Date.now() - 300000 ||
    (p.next_after !== null && !uuid(p.next_after))
  )
    throw failure();
  let prior = after;
  const rows: InformationRow[] = p.rows.map((r: unknown) => {
    if (
      !object(r) ||
      !uuid(r.id) ||
      (prior && r.id <= prior) ||
      (record && record !== r.id) ||
      !object(r.fields) ||
      Object.keys(r.fields).length > 30 ||
      !Array.isArray(r.truncated_fields) ||
      !r.truncated_fields.every((f: unknown) => typeof f === "string" && Object.hasOwn(r.fields, f))
    )
      throw failure();
    prior = r.id;
    return { id: r.id, fields: r.fields, truncated_fields: r.truncated_fields };
  });
  if (
    (record && rows.length !== 1) ||
    (p.next_after !== null && (rows.length !== 25 || p.next_after !== prior))
  )
    throw failure();
  return {
    version: p.version,
    tenant_id: p.tenant_id,
    actor_id: p.actor_id,
    collection: p.collection,
    after,
    record,
    rows,
    next_after: p.next_after,
    observed_at: p.observed_at,
    audit_id: p.audit_id,
  };
}
