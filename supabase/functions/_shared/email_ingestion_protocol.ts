import { DELEGATION_CAPTURE_CODES } from "./gmail_capture_page.ts";
/** Client for the existing email ingestion v2 protocol. Provider access and
 * source persistence stay in the worker; this module never advances progress
 * through direct table writes. Requests must be retained before first dispatch.
 */
export type EmailScope = {
  tenantId: string;
  accountId: string;
  attemptId: string;
  stream: "recent" | "historical";
};
export type EmailCheckpoint = {
  tenant_id: string;
  email_account_id: string;
  stream: EmailScope["stream"];
  contract_version: 2;
  generation: string;
  revision: string;
  state: "ready" | "claimed" | "blocked" | "completed";
  owner_attempt_id: string | null;
  continuation: Record<string, unknown> | null;
  block_code: string | null;
};
export type EmailOperation =
  | "claim"
  | "initialize_traversal"
  | "checkpoint"
  | "release"
  | "block"
  | "finish_attempt"
  | "takeover"
  | "restart";
export type EmailTransition = EmailScope & {
  transitionId: string;
  operation: EmailOperation;
  expectedGeneration: string | null;
  expectedRevision: string | null;
  expectedOwner: string | null;
  payload: Record<string, unknown>;
};
export interface EmailProtocolClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export type EmailAcceptedResult = {
  operation: EmailOperation;
  attempt_id: string;
  tenant_id: string;
  email_account_id: string;
  stream: EmailScope["stream"];
  checkpoint_present: boolean;
  generation: string | null;
  revision: string | null;
  checkpoint_state: EmailCheckpoint["state"] | null;
  owner_attempt_id: string | null;
  attempt_status: "running" | "success" | "failed";
  records_processed: number;
  coverage_complete: boolean;
};
export type EmailTransitionResult = {
  disposition: "applied" | "replayed" | "conflict" | "denied";
  code: string;
  accepted: EmailAcceptedResult | null;
  checkpoint: EmailCheckpoint | null;
  /** A historical receipt proves an earlier write, not ownership of today's checkpoint. */
  currentMatchesReceipt: boolean;
};
const operations = [
  "claim",
  "initialize_traversal",
  "checkpoint",
  "release",
  "block",
  "finish_attempt",
  "takeover",
  "restart",
];
const states = ["ready", "claimed", "blocked", "completed"];
const blockCodes = [
  ...DELEGATION_CAPTURE_CODES,
  "history_expired",
  "continuation_expired",
  "pagination_no_progress",
  "fetch_failed",
  "parse_failed",
  "persistence_failed",
  "checkpoint_conflict",
  "source_ineligible",
  "unexpected_failure",
];
const codes = [
  "transition_applied",
  "receipt_replayed",
  "not_found",
  "invalid_request",
  "account_not_found",
  "attempt_mismatch",
  "transition_id_reused",
  "attempt_terminal",
  "source_ineligible",
  "owner_must_release",
  "checkpoint_missing",
  "legacy_state_invalid",
  "checkpoint_conflict",
  "invalid_recovery_state",
  "explicit_recovery_required",
  "already_claimed",
  "not_owner",
  "already_initialized",
  "invalid_legacy_cursor",
  "boundary_regression",
  "not_initialized",
  "page_conflict",
  "cursor_conflict",
  "pagination_no_progress",
  "total_overflow",
  "revision_exhausted",
  "force_generation_busy",
  "invalid_legacy_policy",
];
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const revision = (v: unknown): v is string =>
  typeof v === "string" && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
const nullableUuid = (v: unknown) => v === null || uuid(v);
function scope(s: EmailScope) {
  if (
    !s ||
    !uuid(s.tenantId) ||
    !uuid(s.accountId) ||
    !uuid(s.attemptId) ||
    !["recent", "historical"].includes(s.stream)
  )
    throw Error("Invalid email ingestion scope.");
}
function matches(v: Record<string, any>, s: EmailScope) {
  return v.tenant_id === s.tenantId && v.email_account_id === s.accountId && v.stream === s.stream;
}
function checkpoint(v: unknown, s: EmailScope): EmailCheckpoint | null {
  if (v === null) return null;
  if (
    !object(v) ||
    !matches(v, s) ||
    v.contract_version !== 2 ||
    !uuid(v.generation) ||
    !revision(v.revision) ||
    !states.includes(v.state) ||
    !nullableUuid(v.owner_attempt_id) ||
    (v.state === "claimed") !== (v.owner_attempt_id !== null) ||
    (v.state === "blocked") !== (v.block_code !== null) ||
    (v.block_code !== null && !blockCodes.includes(v.block_code)) ||
    (s.stream === "historical" ? v.continuation !== null : !object(v.continuation))
  )
    throw new EmailTransitionUnconfirmed();
  // The worker must separately validate the provider-specific continuation before
  // making provider requests; this client checks only the protocol envelope.
  return {
    tenant_id: v.tenant_id,
    email_account_id: v.email_account_id,
    stream: v.stream,
    contract_version: 2,
    generation: v.generation,
    revision: v.revision,
    state: v.state,
    owner_attempt_id: v.owner_attempt_id,
    continuation: v.continuation === null ? null : structuredClone(v.continuation),
    block_code: v.block_code,
  };
}
export class EmailTransitionUnconfirmed extends Error {
  constructor() {
    super(
      "Email progress could not be confirmed. Retain this request and recover its receipt before continuing.",
    );
    this.name = "EmailTransitionUnconfirmed";
  }
}
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
function canonical(v: unknown): string {
  if (
    v === null ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    (typeof v === "number" && Number.isFinite(v))
  )
    return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (object(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)))
    return `{${Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
      .join(",")}}`;
  throw Error("Email transition must contain only JSON values.");
}
export function validateEmailTransition(r: EmailTransition) {
  scope(r);
  if (
    !uuid(r.transitionId) ||
    !operations.includes(r.operation) ||
    !nullableUuid(r.expectedGeneration) ||
    !(r.expectedRevision === null || revision(r.expectedRevision)) ||
    !nullableUuid(r.expectedOwner) ||
    (r.expectedGeneration === null) !== (r.expectedRevision === null) ||
    (r.expectedGeneration === null && r.expectedOwner !== null) ||
    !object(r.payload)
  )
    throw Error("Invalid retained email transition.");
  const serialized = canonical(r);
  if (serialized.length > 65536) throw Error("Email transition exceeds the request limit.");
}
export function prepareEmailTransition(
  s: EmailScope,
  prior: EmailCheckpoint | null,
  transitionId: string,
  operation: EmailOperation,
  payload: Record<string, unknown>,
): EmailTransition {
  scope(s);
  const c = checkpoint(prior, s);
  const r = {
    tenantId: s.tenantId,
    accountId: s.accountId,
    attemptId: s.attemptId,
    stream: s.stream,
    transitionId,
    operation,
    expectedGeneration: c?.generation ?? null,
    expectedRevision: c?.revision ?? null,
    expectedOwner: c?.owner_attempt_id ?? null,
    payload: structuredClone(payload),
  };
  validateEmailTransition(r);
  return freeze(r);
}
function parse(
  data: unknown,
  s: EmailScope,
  id: string,
  operation?: EmailOperation,
): EmailTransitionResult {
  if (
    !object(data) ||
    data.contract_version !== 2 ||
    data.transition_id !== id ||
    !["applied", "replayed", "conflict", "denied"].includes(data.disposition) ||
    !codes.includes(data.code) ||
    data.historical_receipt !== (data.disposition === "replayed")
  )
    throw new EmailTransitionUnconfirmed();
  const c = checkpoint(data.current_checkpoint, s),
    a = data.accepted_result;
  const accepted = ["applied", "replayed"].includes(data.disposition);
  if (accepted) {
    if (
      !object(a) ||
      !matches(a, s) ||
      a.attempt_id !== s.attemptId ||
      !operations.includes(a.operation) ||
      (operation !== undefined && a.operation !== operation) ||
      typeof a.checkpoint_present !== "boolean" ||
      !nullableUuid(a.owner_attempt_id) ||
      !["running", "success", "failed"].includes(a.attempt_status) ||
      !Number.isSafeInteger(a.records_processed) ||
      a.records_processed < 0 ||
      a.records_processed > 2147483647 ||
      typeof a.coverage_complete !== "boolean" ||
      (a.checkpoint_present
        ? !uuid(a.generation) || !revision(a.revision) || !states.includes(a.checkpoint_state)
        : a.generation !== null ||
          a.revision !== null ||
          a.checkpoint_state !== null ||
          a.owner_attempt_id !== null) ||
      (a.checkpoint_present &&
        (a.checkpoint_state === "claimed") !== (a.owner_attempt_id !== null)) ||
      (a.coverage_complete &&
        (a.attempt_status !== "success" || a.checkpoint_state !== "completed")) ||
      (a.attempt_status === "running" &&
        (a.checkpoint_state !== "claimed" || a.owner_attempt_id !== s.attemptId)) ||
      (a.operation !== "finish_attempt" &&
        a.attempt_status !== "running" &&
        a.owner_attempt_id !== null) ||
      data.code !== (data.disposition === "applied" ? "transition_applied" : "receipt_replayed")
    )
      throw new EmailTransitionUnconfirmed();
  } else if (a !== null || ["transition_applied", "receipt_replayed"].includes(data.code))
    throw new EmailTransitionUnconfirmed();
  return {
    disposition: data.disposition,
    code: data.code,
    accepted: accepted ? structuredClone(a) : null,
    checkpoint: c,
    currentMatchesReceipt:
      accepted &&
      !!c &&
      a.checkpoint_present &&
      c.generation === a.generation &&
      c.revision === a.revision &&
      c.owner_attempt_id === a.owner_attempt_id &&
      c.state === a.checkpoint_state,
  };
}
function args(r: EmailTransition) {
  return {
    p_tenant_id: r.tenantId,
    p_email_account_id: r.accountId,
    p_stream: r.stream,
    p_attempt_id: r.attemptId,
    p_transition_id: r.transitionId,
    p_operation: r.operation,
    p_expected_generation: r.expectedGeneration,
    p_expected_revision: r.expectedRevision,
    p_expected_owner_attempt_id: r.expectedOwner,
    p_payload: r.payload,
  };
}
/** retain must durably write and read back the same document under the exact
 * company/account/attempt scope. A local in-memory copy is insufficient in Edge.
 * No RPC is dispatched if retention fails. Unknown outcomes never auto-retry.
 */
export async function applyEmailTransition(
  db: EmailProtocolClient,
  request: EmailTransition,
  retain: (r: EmailTransition) => Promise<EmailTransition>,
): Promise<EmailTransitionResult> {
  validateEmailTransition(request);
  const frozen = freeze(structuredClone(request));
  const retained = await retain(frozen);
  if (canonical(retained) !== canonical(frozen))
    throw Error("The email transition was not retained exactly; no request was sent.");
  try {
    const { data, error } = await db.rpc("email_ingestion_transition_v2", args(frozen));
    if (error) throw new EmailTransitionUnconfirmed();
    return parse(data, frozen, frozen.transitionId, frozen.operation);
  } catch {
    throw new EmailTransitionUnconfirmed();
  }
}
/** Read-only receipt recovery. A missing receipt does not cancel an in-flight
 * request and must not cause replacement with a different transition ID.
 */
export async function readEmailTransition(
  db: EmailProtocolClient,
  s: EmailScope,
  transitionId: string,
  operation?: EmailOperation,
): Promise<EmailTransitionResult> {
  scope(s);
  if (!uuid(transitionId)) throw Error("Invalid email transition identity.");
  try {
    const { data, error } = await db.rpc("email_ingestion_transition_result_v2", {
      p_tenant_id: s.tenantId,
      p_email_account_id: s.accountId,
      p_stream: s.stream,
      p_attempt_id: s.attemptId,
      p_transition_id: transitionId,
    });
    if (error) throw new EmailTransitionUnconfirmed();
    const result = parse(data, s, transitionId, operation);
    if (
      result.disposition !== "replayed" &&
      !(result.disposition === "conflict" && result.code === "not_found")
    )
      throw new EmailTransitionUnconfirmed();
    return result;
  } catch {
    throw new EmailTransitionUnconfirmed();
  }
}
