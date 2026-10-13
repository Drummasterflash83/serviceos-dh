export type CustomerKind = "person" | "company";
export type CustomerAccountIdentity = {
  displayName: string;
  contactIsCustomer: boolean;
  evidence: string;
};
/** A reviewed account name is not inferred from a primary contact or shared endpoint. */
export function customerAccountIdentity(value: CustomerAccountIdentity) {
  if (
    !value ||
    typeof value.displayName !== "string" ||
    value.displayName.trim().length < 1 ||
    value.displayName.trim().length > 1000 ||
    typeof value.contactIsCustomer !== "boolean" ||
    typeof value.evidence !== "string" ||
    value.evidence.trim().length < 3 ||
    value.evidence.trim().length > 1000
  )
    throw Error("Confirm the customer account name and where you checked it.");
  return {
    display_name: value.displayName.trim(),
    contact_is_customer: value.contactIsCustomer,
    evidence: value.evidence.trim(),
  };
}
export type ReviewClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};
export type ReviewConnection = { id: string; name: string };
export type CustomerSummary = {
  person_name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  postcode: string | null;
  source_type: string | null;
  customer_type: string | null;
};
export type CustomerLink = {
  entity_table: "people" | "companies";
  entity_id: string;
  card_id: string;
  source_version_id: string;
};
export type ReviewCustomer = {
  version_id: string;
  external_id: string;
  observed_at: string;
  summary: CustomerSummary;
  link: CustomerLink | null;
};
export type CustomerCandidate = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  postcode: string | null;
  reason: "shared_email" | "shared_phone" | "same_name" | "search";
  match_detail?: { channel: "email" | "phone"; value: string } | null;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const nullableText = (v: unknown) => v === null || (typeof v === "string" && v.length <= 6000);
const unavailable = () =>
  Error("Customer review could not be read. Reload to check access and current evidence.");
function scope(tenant: string) {
  if (!uuid(tenant)) throw unavailable();
}
async function read(db: ReviewClient, name: string, args: Record<string, unknown>) {
  try {
    const r = await db.rpc(name, args);
    if (r.error || !object(r.data)) throw unavailable();
    return r.data;
  } catch {
    throw unavailable();
  }
}
export async function loadCommusoftReviewConnections(
  db: ReviewClient,
  tenant: string,
): Promise<ReviewConnection[]> {
  scope(tenant);
  const d = await read(db, "learn_commusoft_review_connections", { p_tenant: tenant });
  if (
    d.tenant_id !== tenant ||
    !Array.isArray(d.connections) ||
    d.connections.some(
      (c: any) => !object(c) || !uuid(c.id) || typeof c.name !== "string" || c.name.length > 150,
    )
  )
    throw unavailable();
  return d.connections.map((c: any) => ({ id: c.id, name: c.name }));
}
function link(v: unknown): v is CustomerLink {
  return (
    object(v) &&
    ["people", "companies"].includes(v.entity_table) &&
    uuid(v.entity_id) &&
    uuid(v.card_id) &&
    uuid(v.source_version_id)
  );
}
export async function loadCommusoftReviewPage(
  db: ReviewClient,
  tenant: string,
  connection: string,
  after: string | null = null,
  search?: string,
): Promise<{ rows: ReviewCustomer[]; next: string | null }> {
  if (search !== undefined && (typeof search !== "string" || search.trim().length > 150))
    throw unavailable();
  const query = search?.trim();
  scope(tenant);
  if (!uuid(connection) || (after !== null && !/^\d{1,16}$/.test(after))) throw unavailable();
  const d = await read(
    db,
    query === undefined ? "learn_commusoft_review_page" : "learn_commusoft_review_search",
    {
      p_tenant: tenant,
      p_connection: connection,
      p_after: after,
      p_limit: 20,
      ...(query === undefined ? {} : { p_search: query }),
    },
  );
  if (
    d.tenant_id !== tenant ||
    d.connection_id !== connection ||
    (query !== undefined && d.search !== query) ||
    !Array.isArray(d.rows) ||
    d.rows.length > 20 ||
    !(
      d.next_cursor === null ||
      (typeof d.next_cursor === "string" && /^\d{1,16}$/.test(d.next_cursor))
    )
  )
    throw unavailable();
  let last = after;
  const seen = new Set<string>();
  const rows: ReviewCustomer[] = d.rows.map((r: any) => {
    if (
      !object(r) ||
      !uuid(r.version_id) ||
      seen.has(r.version_id) ||
      typeof r.external_id !== "string" ||
      !/^\d{1,16}$/.test(r.external_id) ||
      (last !== null && r.external_id <= last) ||
      typeof r.observed_at !== "string" ||
      !Number.isFinite(Date.parse(r.observed_at)) ||
      !object(r.summary) ||
      (r.link !== null && !link(r.link))
    )
      throw unavailable();
    seen.add(r.version_id);
    last = r.external_id;
    const summary = {} as CustomerSummary;
    for (const key of [
      "person_name",
      "company_name",
      "email",
      "phone",
      "address",
      "postcode",
      "source_type",
      "customer_type",
    ] as const) {
      if (!nullableText(r.summary[key])) throw unavailable();
      summary[key] = r.summary[key];
    }
    return {
      version_id: r.version_id,
      external_id: r.external_id,
      observed_at: r.observed_at,
      summary,
      link:
        r.link === null
          ? null
          : {
              entity_table: r.link.entity_table,
              entity_id: r.link.entity_id,
              card_id: r.link.card_id,
              source_version_id: r.link.source_version_id,
            },
    };
  });
  if (d.next_cursor !== null && (!rows.length || d.next_cursor !== last)) throw unavailable();
  return { rows, next: d.next_cursor };
}
export function findCommusoftCustomers(
  db: ReviewClient,
  tenant: string,
  version: string,
  kind: CustomerKind,
  search: string,
  after: string | null = null,
) {
  return findCandidates(
    db,
    tenant,
    version,
    kind,
    search,
    after,
    "learn_commusoft_customer_candidates",
  );
}
export function findCommusoftContacts(
  db: ReviewClient,
  tenant: string,
  version: string,
  search: string,
  after: string | null = null,
) {
  return findCandidates(
    db,
    tenant,
    version,
    "person",
    search,
    after,
    "learn_commusoft_contact_candidates",
  );
}
async function findCandidates(
  db: ReviewClient,
  tenant: string,
  version: string,
  kind: CustomerKind,
  search: string,
  after: string | null,
  rpcName: "learn_commusoft_customer_candidates" | "learn_commusoft_contact_candidates",
): Promise<{ rows: CustomerCandidate[]; next: string | null }> {
  scope(tenant);
  if (
    !uuid(version) ||
    !["person", "company"].includes(kind) ||
    search.trim().length === 1 ||
    search.trim().length > 150 ||
    (after !== null && !uuid(after))
  )
    throw unavailable();
  const d = await read(db, rpcName, {
    p_tenant: tenant,
    p_version: version,
    p_kind: kind,
    p_search: search.trim(),
    p_after: after,
    p_limit: 20,
  });
  if (
    d.tenant_id !== tenant ||
    d.version_id !== version ||
    d.kind !== kind ||
    !Array.isArray(d.rows) ||
    d.rows.length > 20 ||
    !(d.next_cursor === null || uuid(d.next_cursor))
  )
    throw unavailable();
  let last = after;
  const rows = d.rows.map((r: any): CustomerCandidate => {
    if (
      !object(r) ||
      !uuid(r.id) ||
      (last !== null && r.id <= last) ||
      !["shared_email", "shared_phone", "same_name", "search"].includes(r.reason) ||
      ![r.name, r.email, r.phone, r.postcode].every(nullableText) ||
      (r.match_detail !== undefined &&
        r.match_detail !== null &&
        (!object(r.match_detail) ||
          !["email", "phone"].includes(r.match_detail.channel) ||
          typeof r.match_detail.value !== "string" ||
          !r.match_detail.value.trim() ||
          r.match_detail.value.length > 1000))
    )
      throw unavailable();
    last = r.id;
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      postcode: r.postcode,
      reason: r.reason,
      ...(r.match_detail === undefined
        ? {}
        : {
            match_detail:
              r.match_detail === null
                ? null
                : {
                    channel: r.match_detail.channel,
                    value: r.match_detail.value,
                  },
          }),
    };
  });
  if (d.next_cursor !== null && (!rows.length || last !== d.next_cursor)) throw unavailable();
  return { rows, next: d.next_cursor };
}
export async function confirmCommusoftCustomer(
  db: ReviewClient,
  input: {
    tenant: string;
    version: string;
    kind: CustomerKind;
    target: string | null;
    reason: string;
    identity?: CustomerAccountIdentity;
  },
) {
  scope(input.tenant);
  if (
    !uuid(input.version) ||
    !["person", "company"].includes(input.kind) ||
    (input.target !== null && !uuid(input.target)) ||
    input.reason.trim().length < 3 ||
    input.reason.trim().length > 1000
  )
    throw Error("Choose a customer type, target and review reason.");
  const creatingPerson = input.kind === "person" && input.target === null;
  if (creatingPerson !== (input.identity !== undefined))
    throw Error("Confirm the account holder when creating a new person customer.");
  const identity = input.identity === undefined ? null : customerAccountIdentity(input.identity);
  // No automatic retries: a lost acknowledgement may still represent a saved link.
  try {
    const { data: d, error } = await db.rpc(
      identity ? "learn_commusoft_confirm_customer_identity" : "learn_commusoft_confirm_customer",
      {
        p_tenant: input.tenant,
        p_version: input.version,
        p_kind: input.kind,
        p_target: input.target,
        p_reason: input.reason.trim(),
        ...(identity ? { p_identity: identity } : {}),
      },
    );
    if (
      error ||
      !object(d) ||
      !uuid(d.link_id) ||
      !uuid(d.entity_id) ||
      !uuid(d.card_id) ||
      typeof d.already !== "boolean" ||
      d.entity_table !== (input.kind === "person" ? "people" : "companies") ||
      (input.target !== null && d.entity_id !== input.target)
    )
      throw Error();
    return {
      linkId: d.link_id as string,
      cardId: d.card_id as string,
      entityId: d.entity_id as string,
      already: d.already as boolean,
    };
  } catch {
    throw Error("Save not confirmed. Reload the retained record before making another decision.");
  }
}
