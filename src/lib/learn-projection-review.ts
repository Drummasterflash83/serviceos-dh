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
export type ProjectionHold = {
  hold_id: string;
  source_kind: "phone" | "email";
  source_id: string;
  reason: string;
  recorded_at: string;
};
export type ProjectionPage = {
  version: "learn-projection-reviews/1";
  tenant_id: string;
  rows: ProjectionHold[];
  next_cursor: string | null;
  checked_at: string;
};
export const projectionFieldLabels: Record<string, string> = {
  source_connector_id: "Input connector",
  source_type: "Source type",
  source_table: "Source table",
  source_id: "Retained record",
  source_external_id: "Provider reference",
  interaction_type: "Communication type",
  direction: "Direction",
  occurred_at: "Occurred at",
  subject: "Subject",
  summary: "Summary",
  body_preview: "Preview",
  from_address: "From address",
  from_name: "From name",
  to_addresses: "To addresses",
  cc_addresses: "CC addresses",
  phone_from: "From number",
  phone_to: "To number",
  related_thread_id: "Thread reference",
};
export type ProjectionFields = Record<string, string | string[] | null>;
export type ProjectionDetail = {
  version: "learn-projection-review-detail/1";
  tenant_id: string;
  hold_id: string;
  source_kind: "phone" | "email";
  source_id: string;
  interaction_id: string | null;
  revision: string;
  source_revision: string;
  reason: string;
  capture_allowed: boolean;
  can_apply: boolean;
  evidence_too_large: boolean;
  source_fields: ProjectionFields | null;
  canonical_fields: ProjectionFields | null;
  checked_at: string;
};
function fields(v: unknown): v is ProjectionFields {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    JSON.stringify(v).length <= 30000 &&
    Object.entries(v).every(
      ([k, value]) =>
        Object.hasOwn(projectionFieldLabels, k) &&
        (value === null ||
          typeof value === "string" ||
          (Array.isArray(value) && value.every((x) => typeof x === "string"))),
    )
  );
}
export async function readProjectionReviews(
  db: OperatorInputClient,
  tenant: string,
  after: string | null = null,
): Promise<ProjectionPage> {
  if (!uuid(tenant) || (after !== null && !uuid(after))) throw Error("Invalid review scope");
  const { data, error } = await db.rpc("learn_operator_projection_reviews", {
    p_tenant: tenant,
    p_after: after,
  });
  const p = data as ProjectionPage;
  if (
    error ||
    !p ||
    p.version !== "learn-projection-reviews/1" ||
    p.tenant_id !== tenant ||
    !date(p.checked_at) ||
    !Array.isArray(p.rows) ||
    p.rows.length > 20 ||
    new Set(p.rows.map((r) => r?.hold_id)).size !== p.rows.length ||
    p.rows.some(
      (r) =>
        !r ||
        !uuid(r.hold_id) ||
        !uuid(r.source_id) ||
        !["phone", "email"].includes(r.source_kind) ||
        !reasonCode(r.reason) ||
        !date(r.recorded_at),
    ) ||
    (p.next_cursor !== null && (!uuid(p.next_cursor) || p.next_cursor !== p.rows.at(-1)?.hold_id))
  )
    throw Error("Review list could not be verified");
  return p;
}
export async function readProjectionReviewDetail(
  db: OperatorInputClient,
  tenant: string,
  hold: ProjectionHold,
): Promise<ProjectionDetail> {
  if (!uuid(tenant) || !uuid(hold.hold_id)) throw Error("Invalid review scope");
  const { data, error } = await db.rpc("learn_operator_projection_review_detail", {
    p_tenant: tenant,
    p_hold: hold.hold_id,
  });
  const d = data as ProjectionDetail;
  if (
    error ||
    !d ||
    d.version !== "learn-projection-review-detail/1" ||
    d.tenant_id !== tenant ||
    d.hold_id !== hold.hold_id ||
    d.source_id !== hold.source_id ||
    d.source_kind !== hold.source_kind ||
    (d.interaction_id !== null && !uuid(d.interaction_id)) ||
    !revision(d.revision) ||
    !revision(d.source_revision) ||
    !reasonCode(d.reason) ||
    !date(d.checked_at) ||
    [d.capture_allowed, d.can_apply, d.evidence_too_large].some((v) => typeof v !== "boolean") ||
    (d.evidence_too_large
      ? d.source_fields !== null || d.canonical_fields !== null
      : !fields(d.source_fields) ||
        !fields(d.canonical_fields) ||
        Object.keys(d.source_fields).sort().join() !==
          Object.keys(d.canonical_fields).sort().join()) ||
    (d.can_apply &&
      (!d.capture_allowed ||
        d.evidence_too_large ||
        !d.interaction_id ||
        !["legacy_projection_review", "canonical_fields_changed"].includes(d.reason)))
  )
    throw Error("Review detail could not be verified");
  return d;
}
export function projectionReviewAdvice(reason: string) {
  switch (reason) {
    case "email_draft":
      return "This unsent draft is retained in the source history. It is excluded from customer communications and cannot be attributed as a sent reply.";
    case "legacy_projection_review":
      return "This canonical record predates verified projection ownership. Compare it with the retained source before applying source values.";
    case "canonical_fields_changed":
      return "The current canonical values differ from the last recorded projection. Applying source values replaces the displayed fields and retains the previous record in the audit history.";
    case "email_addresses_unverified":
      return "The retained email addresses need correction at the source. No canonical replacement is available.";
    case "authoritative_phone_owner":
      return "The phone analysis publisher owns this record. Use Phone processing recovery instead.";
    case "campaign_review_required":
      return "This email has campaign provenance. Review its Marketing relationship before changing the canonical record.";
    case "canonical_shape_unverified":
      return "The canonical record has an unexpected communication type. Investigate its source mapping before applying values.";
    case "source_changed":
    case "newer_processing_exists":
      return "Newer source or processing evidence exists. Refresh processing and review the current hold.";
    default:
      return "This input needs further source investigation before it can be reconciled.";
  }
}
export type ProjectionReviewRequest = {
  version: 1;
  backend: string;
  tenantId: string;
  actorId: string;
  requestId: string;
  holdId: string;
  revision: string;
  reason: string;
};
export type ProjectionReviewReceipt = {
  version: "learn-projection-review-receipt/1";
  tenant_id: string;
  request_id: string;
  hold_id: string;
  state: "pending" | "cancelled" | "recorded";
  interaction_id?: string;
  event_id?: string;
  card_processing?: "pending";
};
export const projectionReviewOutboxKey = (s: InputScope) =>
  inputOutboxKey(s) + ":projection-review";
function validateRequest(s: InputScope, r: ProjectionReviewRequest) {
  projectionReviewOutboxKey(s);
  if (
    !r ||
    r.version !== 1 ||
    r.backend !== s.backend ||
    r.tenantId !== s.tenantId ||
    r.actorId !== s.actorId ||
    !uuid(r.requestId) ||
    !uuid(r.holdId) ||
    !revision(r.revision) ||
    typeof r.reason !== "string" ||
    r.reason.trim().length < 1 ||
    r.reason.trim().length > 1000 ||
    Object.keys(r).sort().join() !==
      ["version", "backend", "tenantId", "actorId", "requestId", "holdId", "revision", "reason"]
        .sort()
        .join()
  )
    throw Error("Saved projection review request is invalid or belongs to another context");
  return r;
}
export function readSavedProjectionReview(
  store: RequestStore,
  s: InputScope,
): ProjectionReviewRequest | null {
  const raw = store.getItem(projectionReviewOutboxKey(s));
  if (raw === null) return null;
  if (raw.length > 6000) throw Error("Saved projection review request needs inspection");
  return validateRequest(s, JSON.parse(raw));
}
async function resolve(
  db: OperatorInputClient,
  s: InputScope,
  r: ProjectionReviewRequest,
  mode: "apply" | "check" | "cancel",
) {
  let response: { data: unknown; error: unknown };
  try {
    response = await db.rpc("learn_operator_projection_review", {
      p_tenant: s.tenantId,
      p_actor: s.actorId,
      p_request: r.requestId,
      p_hold: r.holdId,
      p_definition: { action: "apply_source", revision: r.revision, reason: r.reason },
      p_mode: mode,
    });
  } catch {
    throw Error(
      "Projection review is unconfirmed. The saved request is retained; check its receipt before retrying.",
    );
  }
  const { data, error } = response;
  const v = data as ProjectionReviewReceipt;
  if (
    error ||
    !v ||
    v.version !== "learn-projection-review-receipt/1" ||
    v.tenant_id !== s.tenantId ||
    v.request_id !== r.requestId ||
    v.hold_id !== r.holdId ||
    !["pending", "cancelled", "recorded"].includes(v.state) ||
    (v.state === "recorded" &&
      (!uuid(v.interaction_id) || !uuid(v.event_id) || v.card_processing !== "pending"))
  )
    throw Error(
      "Projection review is unconfirmed. The saved request is retained; check its receipt before retrying.",
    );
  return v;
}
export async function resolveSavedProjectionReview(
  db: OperatorInputClient,
  store: RequestStore,
  lock: InputLock,
  s: InputScope,
  r: ProjectionReviewRequest,
  mode: "apply" | "check" | "cancel",
  allowed: () => boolean,
) {
  validateRequest(s, r);
  const key = projectionReviewOutboxKey(s),
    encoded = JSON.stringify(r);
  return lock(key, async () => {
    if (!allowed()) throw Error("Operator context changed");
    const saved = readSavedProjectionReview(store, s);
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
