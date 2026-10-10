import type { ReviewClient } from "./learn-commusoft-review.ts";
import {
  recoveryOutboxKey,
  type RecoveryLock,
  type RecoveryScope,
} from "./learn-slack-recovery-outbox.ts";
export type WorkKind = "site" | "job" | "contact";
type Outcome =
  | { state: "held"; reason: string; attempt_id?: string }
  | {
      state: "linked";
      entity_id: string;
      entity_kind: WorkKind;
      link_id: string;
      already: boolean;
      attempt_id?: string;
    };
export type WorkSource = {
  external_id: string;
  version_id: string | null;
  title: string;
  property_reference: string | null;
  customer_name: string | null;
  relationship_reason: string | null;
  source_status: string | null;
  linked_version_id: string | null;
  last_result: Outcome | null;
  selectable: boolean;
  contact?: { email: string | null; position: string | null; phones: string[] };
};
export type WorkDraft = {
  version: 1;
  scope: RecoveryScope;
  id: string;
  connection: string;
  kind: WorkKind;
  items: { version_id: string; target_id: string | null }[];
  reason: string;
};
export type WorkReceipt = {
  batch_id: string;
  tenant_id: string;
  actor_id: string;
  connection_id: string;
  kind: WorkKind;
  state: "recorded" | "cancelled";
  linked: number;
  held: number;
  items: { version_id: string; outcome: Outcome }[];
};
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const obj = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string | null =>
  v === null || (typeof v === "string" && v.length <= 1000);
const failure = () =>
  Error("Work review could not be verified. Reload its saved result before continuing.");
function outcome(v: unknown): Outcome {
  if (!obj(v) || (v.attempt_id !== undefined && !uuid(v.attempt_id))) throw failure();
  if (v.state === "held" && typeof v.reason === "string" && /^[a-z_]{1,100}$/.test(v.reason))
    return {
      state: "held",
      reason: v.reason,
      ...(v.attempt_id ? { attempt_id: v.attempt_id } : {}),
    };
  if (
    v.state === "linked" &&
    uuid(v.entity_id) &&
    uuid(v.link_id) &&
    ["site", "job", "contact"].includes(v.entity_kind) &&
    typeof v.already === "boolean"
  )
    return {
      state: "linked",
      entity_id: v.entity_id,
      entity_kind: v.entity_kind,
      link_id: v.link_id,
      already: v.already,
      ...(v.attempt_id ? { attempt_id: v.attempt_id } : {}),
    };
  throw failure();
}
export function workOutboxKey(scope: RecoveryScope) {
  recoveryOutboxKey(scope);
  return `serviceos:commusoft-work:1:${encodeURIComponent(scope.backend)}:${scope.actorId}:${scope.tenantId}`;
}
export function checkedWorkDraft(scope: RecoveryScope, d: unknown): WorkDraft {
  workOutboxKey(scope);
  if (
    !obj(d) ||
    d.version !== 1 ||
    !obj(d.scope) ||
    d.scope.backend !== scope.backend ||
    d.scope.actorId !== scope.actorId ||
    d.scope.tenantId !== scope.tenantId ||
    !uuid(d.id) ||
    !uuid(d.connection) ||
    !["site", "job", "contact"].includes(d.kind) ||
    !Array.isArray(d.items) ||
    d.items.length < 1 ||
    d.items.length > 50 ||
    typeof d.reason !== "string" ||
    d.reason.trim().length < 3 ||
    d.reason.trim().length > 1000
  )
    throw failure();
  const seen = new Set<string>();
  const items = d.items.map((i: any) => {
    if (
      !obj(i) ||
      !uuid(i.version_id) ||
      seen.has(i.version_id) ||
      !(i.target_id === null || uuid(i.target_id))
    )
      throw failure();
    seen.add(i.version_id);
    return { version_id: i.version_id, target_id: i.target_id };
  });
  return {
    version: 1,
    scope: { ...scope },
    id: d.id,
    connection: d.connection,
    kind: d.kind,
    items,
    reason: d.reason.trim(),
  };
}
export function readWorkDraft(storage: Store, scope: RecoveryScope): WorkDraft | null {
  try {
    const raw = storage.getItem(workOutboxKey(scope));
    if (raw === null) return null;
    if (raw.length > 20000) throw failure();
    return checkedWorkDraft(scope, JSON.parse(raw));
  } catch {
    throw Error(
      "Saved work review is unavailable. Keep this browser data and contact support before approving again.",
    );
  }
}
function receipt(value: unknown, d: WorkDraft): WorkReceipt {
  if (
    !obj(value) ||
    value.batch_id !== d.id ||
    value.tenant_id !== d.scope.tenantId ||
    value.actor_id !== d.scope.actorId ||
    value.connection_id !== d.connection ||
    value.kind !== d.kind ||
    !["recorded", "cancelled"].includes(value.state) ||
    !Number.isInteger(value.linked) ||
    !Number.isInteger(value.held) ||
    !Array.isArray(value.items)
  )
    throw failure();
  if (value.state === "cancelled") {
    if (value.linked !== 0 || value.held !== 0 || value.items.length) throw failure();
  } else if (value.items.length !== d.items.length) throw failure();
  const items = value.items.map((i: any, n: number) => {
    if (!obj(i) || i.version_id !== d.items[n].version_id) throw failure();
    const o = outcome(i.outcome);
    if (
      o.state === "linked" &&
      (o.entity_kind !== d.kind ||
        (d.items[n].target_id !== null && o.entity_id !== d.items[n].target_id))
    )
      throw failure();
    return { version_id: i.version_id, outcome: o };
  });
  if (
    items.filter((i: any) => i.outcome.state === "linked").length !== value.linked ||
    items.filter((i: any) => i.outcome.state === "held").length !== value.held
  )
    throw failure();
  return {
    batch_id: value.batch_id,
    tenant_id: value.tenant_id,
    actor_id: value.actor_id,
    connection_id: value.connection_id,
    kind: value.kind,
    state: value.state,
    linked: value.linked,
    held: value.held,
    items,
  };
}
export async function loadWorkPage(
  db: ReviewClient,
  tenant: string,
  connection: string,
  kind: WorkKind,
  after: string | null = null,
): Promise<{ rows: WorkSource[]; next: string | null }> {
  if (
    !uuid(tenant) ||
    !uuid(connection) ||
    !["site", "job", "contact"].includes(kind) ||
    (after !== null && !/^\d{1,16}$/.test(after))
  )
    throw failure();
  let result;
  try {
    result = await db.rpc("learn_commusoft_work_review_page", {
      p_tenant: tenant,
      p_connection: connection,
      p_kind: kind,
      p_after: after,
      p_limit: 20,
    });
  } catch {
    throw failure();
  }
  const d = result.data;
  if (
    result.error ||
    !obj(d) ||
    d.tenant_id !== tenant ||
    d.connection_id !== connection ||
    d.kind !== kind ||
    !Array.isArray(d.rows) ||
    d.rows.length > 20 ||
    !(d.next_cursor === null || typeof d.next_cursor === "string")
  )
    throw failure();
  let last = after;
  const rows = d.rows.map((r: any): WorkSource => {
    if (
      !obj(r) ||
      typeof r.external_id !== "string" ||
      !/^\d{1,16}$/.test(r.external_id) ||
      (last !== null && r.external_id <= last) ||
      !(r.version_id === null || uuid(r.version_id)) ||
      !(r.linked_version_id === null || uuid(r.linked_version_id)) ||
      typeof r.title !== "string" ||
      r.title.length > 1000 ||
      typeof r.selectable !== "boolean" ||
      (r.selectable && !uuid(r.version_id)) ||
      ![r.property_reference, r.customer_name, r.relationship_reason, r.source_status].every(text)
    )
      throw failure();
    if (
      kind === "contact" &&
      (!obj(r.contact) ||
        !text(r.contact.email) ||
        !text(r.contact.position) ||
        !Array.isArray(r.contact.phones) ||
        r.contact.phones.length > 50 ||
        r.contact.phones.some((p: unknown) => typeof p !== "string" || p.length > 1000))
    )
      throw failure();
    last = r.external_id;
    return {
      external_id: r.external_id,
      version_id: r.version_id,
      title: r.title,
      property_reference: r.property_reference,
      customer_name: r.customer_name,
      relationship_reason: r.relationship_reason,
      source_status: r.source_status,
      linked_version_id: r.linked_version_id,
      last_result: r.last_result === null ? null : outcome(r.last_result),
      selectable: r.selectable,
      ...(kind === "contact"
        ? {
            contact: {
              email: r.contact.email,
              position: r.contact.position,
              phones: [...r.contact.phones],
            },
          }
        : {}),
    };
  });
  if (d.next_cursor !== null && (!rows.length || d.next_cursor !== last)) throw failure();
  return { rows, next: d.next_cursor };
}
/** One retained draft per actor/company/backend, coordinated across browser tabs.
 * Save before send. A missing receipt permits only an explicit same-request retry
 * or server-side cancellation; read failure never means that nothing committed.
 */
export async function resolveWorkDraft(
  db: ReviewClient,
  storage: Store,
  lock: RecoveryLock,
  scope: RecoveryScope,
  input: WorkDraft,
  mode: "apply" | "check" | "cancel",
  allowed: () => boolean,
): Promise<WorkReceipt | null> {
  const d = checkedWorkDraft(scope, input),
    key = workOutboxKey(scope),
    encoded = JSON.stringify(d);
  return lock(key, async () => {
    if (!allowed()) throw failure();
    const saved = readWorkDraft(storage, scope);
    if (saved && JSON.stringify(saved) !== encoded)
      throw Error("Another work review is saved. Reload it before continuing.");
    if (!saved && mode !== "apply")
      throw Error("The saved request changed. Reload before continuing.");
    storage.setItem(key, encoded);
    if (storage.getItem(key) !== encoded)
      throw Error("The review could not be saved locally. No request was sent.");
    if (!allowed()) throw failure();
    let r;
    try {
      r = await db.rpc("learn_commusoft_work_batch_result", {
        p_tenant: scope.tenantId,
        p_request: d.id,
      });
    } catch {
      throw failure();
    }
    if (r.error) throw failure();
    let value = r.data;
    if (value === null && mode !== "check") {
      if (!allowed()) throw failure();
      try {
        r = await db.rpc("learn_commusoft_work_batch", {
          p_tenant: scope.tenantId,
          p_request: d.id,
          p_connection: d.connection,
          p_kind: d.kind,
          p_items: d.items,
          p_reason: d.reason,
          p_cancel: mode === "cancel",
          p_expected_actor: scope.actorId,
        });
      } catch {
        throw failure();
      }
      if (r.error) throw failure();
      value = r.data;
    }
    if (value === null) return null;
    const verified = receipt(value, d);
    if (!allowed()) throw failure();
    if (storage.getItem(key) !== encoded)
      throw Error(
        "The result is recorded but the saved request changed. Reload before continuing.",
      );
    storage.removeItem(key);
    if (storage.getItem(key) !== null) throw failure();
    return verified;
  });
}
export function workHoldMessage(reason: string | null | undefined): string {
  const messages: Record<string, string> = {
    contact_identity_needs_review:
      "A matching contact may already exist. Find and select the correct person before linking.",
    contact_target_missing: "The selected person is unavailable in this company.",
    contact_relationship_needs_review: "An existing inactive contact relationship needs review.",
    contact_field_invalid: "The contact details need correction at source.",
    contact_name_required: "A contact name is required before linking.",
    contact_email_invalid: "The contact email address needs correction at source.",
    contact_phone_invalid: "The contact phone details need correction at source.",
    property_missing_or_ambiguous: "The referenced property needs to be captured or reconciled.",
    property_identity_unreviewed: "Review the referenced customer or site first.",
    customer_target_missing: "The linked customer needs review.",
    customer_card_changed: "The customer card identity has changed.",
    site_source_owner_changed: "The source site's customer has changed; review its ownership.",
    site_canonical_owner_changed: "The saved site's customer has changed; review its ownership.",
    property_kind_changed: "The property type no longer matches its reviewed identity.",
    source_changed_or_ambiguous: "New or conflicting source information needs review.",
    existing_identity_needs_review: "The existing source link needs an update review.",
    existing_external_identity_needs_review:
      "An existing imported record needs explicit reconciliation.",
    target_site_owner_mismatch: "The chosen site belongs to a different customer.",
    target_job_owner_mismatch: "The chosen job has different customer or site ownership.",
    property_reference_invalid: "The source property reference needs correction.",
    job_status_unrecognised: "The source job status needs review.",
    job_timestamp_invalid: "The source job dates need review.",
    job_timestamp_timezone_required:
      "The source job time needs its timezone confirmed before this job can be linked.",
    site_field_invalid: "The source address needs review.",
    job_field_invalid: "The source job details need review.",
  };
  return reason
    ? (messages[reason] ?? "This record needs review before linking.")
    : "Relationship will be checked again when processed.";
}
