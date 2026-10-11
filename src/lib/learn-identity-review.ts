import type { OperatorInputClient } from "./learn-operator-inputs.ts";
import {
  inputOutboxKey,
  type InputScope,
  type InputLock,
  type RequestStore,
} from "./learn-operator-request-scope.ts";
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const revision = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
const reasonCode = (v: unknown) => typeof v === "string" && /^[a-z_]{1,64}$/.test(v);
export type IdentityHold = {
  interaction_id: string;
  source_type: string;
  subject: string | null;
  occurred_at: string;
  reason: string;
};
export type IdentityPage = {
  version: "learn-identity-reviews/1";
  tenant_id: string;
  rows: IdentityHold[];
  next_cursor: string | null;
  checked_at: string;
};
export type IdentityPerson = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
};
export type IdentityPeople = {
  version: "learn-identity-people/1";
  tenant_id: string;
  search: string;
  rows: IdentityPerson[];
  next_cursor: string | null;
};
export type IdentityDetail = {
  version: "learn-identity-review-detail/1";
  tenant_id: string;
  interaction_id: string;
  person_id: string;
  revision: string;
  can_apply: boolean;
  blocked_reason: string | null;
  hold_reason: string;
  checked_at: string;
  source: Record<string, string | null>;
  person: { name: string | null; email: string | null; phone: string | null; verified: boolean };
  company: { id: string; name: string | null; domain: string | null } | null;
  rejected_matches: {
    target_type: "person" | "company";
    target_id: string;
    status: "rejected";
    explanation: string | null;
  }[];
};
const text = (v: unknown, max = 500) => v === null || (typeof v === "string" && v.length <= max);
function pageRows(rows: unknown, cursor: unknown, key: string, after: string | null) {
  if (!Array.isArray(rows) || rows.length > 20) return false;
  const ids = rows.map((r) => r?.[key]);
  return (
    ids.every(
      (id, index) => uuid(id) && (index === 0 ? !after || id > after : id > ids[index - 1]),
    ) &&
    (cursor === null || (uuid(cursor) && rows.length === 20 && cursor === ids.at(-1)))
  );
}
export async function readIdentityReviews(
  db: OperatorInputClient,
  tenant: string,
  after: string | null = null,
): Promise<IdentityPage> {
  if (!uuid(tenant) || (after !== null && !uuid(after))) throw Error("Invalid review scope");
  const { data, error } = await db.rpc("learn_operator_identity_reviews", {
    p_tenant: tenant,
    p_after: after,
  });
  const p = data as IdentityPage;
  if (
    error ||
    !p ||
    p.version !== "learn-identity-reviews/1" ||
    p.tenant_id !== tenant ||
    !date(p.checked_at) ||
    !pageRows(p.rows, p.next_cursor, "interaction_id", after) ||
    p.rows.some(
      (r) =>
        !text(r.subject, 200) ||
        typeof r.source_type !== "string" ||
        r.source_type.length > 100 ||
        !date(r.occurred_at) ||
        !reasonCode(r.reason),
    )
  )
    throw Error("Identity review list could not be verified");
  return p;
}
export async function searchIdentityPeople(
  db: OperatorInputClient,
  tenant: string,
  search: string,
  after: string | null = null,
): Promise<IdentityPeople> {
  if (
    !uuid(tenant) ||
    search.trim().length < 2 ||
    search.trim().length > 100 ||
    (after !== null && !uuid(after))
  )
    throw Error("Enter between 2 and 100 characters");
  const { data, error } = await db.rpc("learn_operator_identity_people", {
    p_tenant: tenant,
    p_search: search,
    p_after: after,
  });
  const p = data as IdentityPeople;
  if (
    error ||
    !p ||
    p.version !== "learn-identity-people/1" ||
    p.tenant_id !== tenant ||
    p.search !== search ||
    !pageRows(p.rows, p.next_cursor, "id", after) ||
    p.rows.some((r) => !text(r.name) || !text(r.email) || !text(r.phone, 100))
  )
    throw Error("Contact search could not be verified");
  return p;
}
export async function readIdentityReviewDetail(
  db: OperatorInputClient,
  tenant: string,
  interaction: string,
  person: string,
): Promise<IdentityDetail> {
  if (![tenant, interaction, person].every(uuid)) throw Error("Invalid review scope");
  const { data, error } = await db.rpc("learn_operator_identity_review_detail", {
    p_tenant: tenant,
    p_interaction: interaction,
    p_person: person,
  });
  const d = data as IdentityDetail;
  const keys = [
    "source_type",
    "direction",
    "occurred_at",
    "subject",
    "preview",
    "from_address",
    "to_address",
    "phone_from",
    "phone_to",
    "related_person_id",
    "related_company_id",
  ];
  if (
    error ||
    !d ||
    d.version !== "learn-identity-review-detail/1" ||
    d.tenant_id !== tenant ||
    d.interaction_id !== interaction ||
    d.person_id !== person ||
    !revision(d.revision) ||
    !date(d.checked_at) ||
    typeof d.can_apply !== "boolean" ||
    !reasonCode(d.hold_reason) ||
    (d.blocked_reason !== null && !reasonCode(d.blocked_reason)) ||
    d.can_apply !== (d.blocked_reason === null) ||
    !d.source ||
    Array.isArray(d.source) ||
    Object.keys(d.source).sort().join() !== keys.sort().join() ||
    Object.values(d.source).some((v) => !text(v, 2000)) ||
    !d.person ||
    !text(d.person.name) ||
    !text(d.person.email) ||
    !text(d.person.phone, 100) ||
    typeof d.person.verified !== "boolean" ||
    (d.company !== null &&
      (!d.company || !uuid(d.company.id) || !text(d.company.name) || !text(d.company.domain))) ||
    !Array.isArray(d.rejected_matches) ||
    d.rejected_matches.length > 2 ||
    d.rejected_matches.some(
      (r) =>
        !r ||
        !["person", "company"].includes(r.target_type) ||
        !uuid(r.target_id) ||
        r.status !== "rejected" ||
        !text(r.explanation, 1000),
    )
  )
    throw Error("Identity comparison could not be verified");
  return d;
}
export function identityReviewAdvice(reason: string | null) {
  switch (reason) {
    case null:
      return "Review the communication against this existing contact and their company before confirming attribution.";
    case "person_ambiguous":
      return "More than one contact has the same source identifier. Select the correct contact using the communication evidence.";
    case "person_conflict":
    case "person_link_conflict":
    case "company_link_conflict":
      return "The existing identity evidence conflicts. Review the source and intended contact.";
    case "reviewed_match_rejected":
      return "A match was previously rejected. A new decision must explain why this communication belongs to the selected contact.";
    case "previous_delivery_needs_reconciliation":
    case "previous_card_needs_reconciliation":
      return "This communication has an earlier customer-card attribution. Reconcile that card and its history before changing the attribution; this action is unavailable here.";
    case "hold_changed":
      return "Processing has changed. Refresh the review list.";
    case "direction_needs_source_review":
    case "source_needs_review":
      return "The source direction or contact evidence needs investigation before customer attribution.";
    case "company_link_invalid":
      return "The selected contact has an unavailable company link. Correct the contact record first.";
    default:
      return "Review the held communication and its contact evidence.";
  }
}
export type IdentityReviewRequest = {
  version: 1;
  backend: string;
  tenantId: string;
  actorId: string;
  requestId: string;
  interactionId: string;
  personId: string;
  revision: string;
  reason: string;
};
export type IdentityReviewReceipt = {
  version: "learn-identity-review-receipt/1";
  tenant_id: string;
  request_id: string;
  interaction_id: string;
  person_id: string;
  state: "pending" | "cancelled" | "recorded";
  card_id?: string;
  card_processing?: "committed";
};
export const identityReviewOutboxKey = (s: InputScope) => inputOutboxKey(s) + ":identity-review";
function validateRequest(s: InputScope, r: IdentityReviewRequest) {
  identityReviewOutboxKey(s);
  if (
    !r ||
    r.version !== 1 ||
    r.backend !== s.backend ||
    r.tenantId !== s.tenantId ||
    r.actorId !== s.actorId ||
    !uuid(r.requestId) ||
    !uuid(r.interactionId) ||
    !uuid(r.personId) ||
    !revision(r.revision) ||
    typeof r.reason !== "string" ||
    r.reason.trim().length < 1 ||
    r.reason.trim().length > 1000 ||
    Object.keys(r).sort().join() !==
      [
        "version",
        "backend",
        "tenantId",
        "actorId",
        "requestId",
        "interactionId",
        "personId",
        "revision",
        "reason",
      ]
        .sort()
        .join()
  )
    throw Error("Saved identity review request is invalid or belongs to another context");
  return r;
}
export function readSavedIdentityReview(
  store: RequestStore,
  s: InputScope,
): IdentityReviewRequest | null {
  const raw = store.getItem(identityReviewOutboxKey(s));
  if (raw === null) return null;
  if (raw.length > 6000) throw Error("Saved identity review request needs inspection");
  return validateRequest(s, JSON.parse(raw));
}
async function resolve(
  db: OperatorInputClient,
  s: InputScope,
  r: IdentityReviewRequest,
  mode: "apply" | "check" | "cancel",
) {
  let response: { data: unknown; error: unknown };
  try {
    response = await db.rpc("learn_operator_identity_review", {
      p_tenant: s.tenantId,
      p_actor: s.actorId,
      p_request: r.requestId,
      p_interaction: r.interactionId,
      p_definition: {
        action: "attribute_contact",
        revision: r.revision,
        reason: r.reason,
        person_id: r.personId,
      },
      p_mode: mode,
    });
  } catch {
    throw Error(
      "Identity review is unconfirmed. The saved request is retained; check its receipt before retrying.",
    );
  }
  const { data, error } = response;
  const v = data as IdentityReviewReceipt;
  if (
    error ||
    !v ||
    v.version !== "learn-identity-review-receipt/1" ||
    v.tenant_id !== s.tenantId ||
    v.request_id !== r.requestId ||
    v.interaction_id !== r.interactionId ||
    v.person_id !== r.personId ||
    !["pending", "cancelled", "recorded"].includes(v.state) ||
    (v.state === "recorded" && (!uuid(v.card_id) || v.card_processing !== "committed"))
  )
    throw Error(
      "Identity review is unconfirmed. The saved request is retained; check its receipt before retrying.",
    );
  return v;
}
export async function resolveSavedIdentityReview(
  db: OperatorInputClient,
  store: RequestStore,
  lock: InputLock,
  s: InputScope,
  r: IdentityReviewRequest,
  mode: "apply" | "check" | "cancel",
  allowed: () => boolean,
) {
  validateRequest(s, r);
  const key = identityReviewOutboxKey(s),
    encoded = JSON.stringify(r);
  return lock(key, async () => {
    if (!allowed()) throw Error("Operator context changed");
    const saved = readSavedIdentityReview(store, s);
    if ((saved && JSON.stringify(saved) !== encoded) || (!saved && mode !== "apply"))
      throw Error("Saved request changed; refresh before continuing");
    store.setItem(key, encoded);
    if (store.getItem(key) !== encoded) throw Error("Request was not saved; nothing was sent");
    if (!allowed()) throw Error("Operator context changed; request retained");
    let receipt = await resolve(db, s, r, "check");
    if (receipt.state === "pending" && mode !== "check") {
      if (!allowed()) throw Error("Operator context changed; request retained");
      receipt = await resolve(db, s, r, mode);
    }
    if (receipt.state !== "pending") {
      if (!allowed() || store.getItem(key) !== encoded)
        throw Error("Recorded result needs checking in its original context");
      store.removeItem(key);
      if (store.getItem(key) !== null)
        throw Error("Receipt confirmed; saved request still needs clearing");
    }
    return receipt;
  });
}
