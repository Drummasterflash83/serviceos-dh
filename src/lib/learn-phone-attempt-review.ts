import type { OperatorInputClient } from "./learn-operator-inputs.ts";
import {
  inputOutboxKey,
  type InputScope,
  type InputLock,
  type RequestStore,
} from "./learn-operator-request-scope.ts";
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
export type PhoneAttempt = {
  run_id: string;
  recording_id: string;
  stage: "download" | "transcription" | "analysis";
  state: "running" | "dispatched" | "prepared" | "needs_review" | "succeeded" | "failed";
  started_at: string;
  completed_at: string | null;
  review_after: string;
  has_prepared_result: boolean;
  has_receipt: boolean;
  error_code: string | null;
  retained_previous_result: boolean;
  retained_previous_attribution: boolean;
  can_reconcile: boolean;
};
export type PhoneAttemptPage = {
  version: "learn-operator-phone-attempts/1";
  tenant_id: string;
  recording_id: string | null;
  held_only: boolean;
  checked_at: string;
  capture_allowed: boolean;
  rows: PhoneAttempt[];
  next_cursor: string | null;
};
export async function readPhoneAttempts(
  db: OperatorInputClient,
  tenant: string,
  heldOnly: boolean,
  after: string | null = null,
): Promise<PhoneAttemptPage> {
  if (!uuid(tenant) || (after !== null && !uuid(after))) throw Error("Invalid Phone review scope");
  const { data, error } = await db.rpc("learn_operator_phone_attempts", {
    p_tenant: tenant,
    p_recording: null,
    p_after: after,
    p_held_only: heldOnly,
  });
  const p = data as PhoneAttemptPage;
  if (
    error ||
    !p ||
    p.version !== "learn-operator-phone-attempts/1" ||
    p.tenant_id !== tenant ||
    p.recording_id !== null ||
    p.held_only !== heldOnly ||
    !date(p.checked_at) ||
    typeof p.capture_allowed !== "boolean" ||
    !Array.isArray(p.rows) ||
    p.rows.length > 30 ||
    (p.next_cursor !== null && !uuid(p.next_cursor))
  )
    throw Error("Phone review response unavailable");
  if (
    new Set(p.rows.map((r) => r.run_id)).size !== p.rows.length ||
    p.rows.some(
      (r) =>
        !r ||
        !uuid(r.run_id) ||
        !uuid(r.recording_id) ||
        !["download", "transcription", "analysis"].includes(r.stage) ||
        !["running", "dispatched", "prepared", "needs_review", "succeeded", "failed"].includes(
          r.state,
        ) ||
        !date(r.started_at) ||
        !date(r.review_after) ||
        (r.completed_at !== null && !date(r.completed_at)) ||
        [
          r.has_prepared_result,
          r.has_receipt,
          r.retained_previous_result,
          r.retained_previous_attribution,
          r.can_reconcile,
        ].some((v) => typeof v !== "boolean") ||
        (r.error_code !== null &&
          (typeof r.error_code !== "string" || !/^[a-z_]{1,64}$/.test(r.error_code))) ||
        (heldOnly && ["succeeded", "failed"].includes(r.state)) ||
        (r.can_reconcile &&
          (!p.capture_allowed ||
            r.stage === "download" ||
            !r.has_prepared_result ||
            !["prepared", "needs_review"].includes(r.state))),
    )
  )
    throw Error("Phone review evidence invalid");
  if (p.next_cursor !== null && p.next_cursor !== p.rows.at(-1)?.run_id)
    throw Error("Phone review cursor invalid");
  return p;
}
export function phoneAttemptAction(a: PhoneAttempt, captureAllowed: boolean) {
  if (a.state === "succeeded")
    return "Completed receipt retained. Earlier results remain in the version history where a replacement was published.";
  if (a.state === "failed")
    return "This attempt ended without publication. Review the cause before starting new processing.";
  if (a.stage === "download" && a.has_prepared_result)
    return "Verify the saved audio object and its checksum through recording recovery before publishing its pointer.";
  if (a.has_prepared_result)
    return captureAllowed
      ? "A result is saved. Reconciliation checks its source and publishes it without another provider request."
      : "A result is saved. Resume Phone capture permission before publishing it; the saved output remains retained.";
  if (a.state === "dispatched" || a.state === "needs_review")
    return "The provider outcome is uncertain and no result is saved. Investigate the original request; this hold must not be cleared by an automatic retry.";
  return "An attempt owns this recording. Check the original worker before taking action; elapsed time does not release ownership.";
}
export type PhoneReconciliation = {
  version: 1;
  backend: string;
  tenantId: string;
  actorId: string;
  requestId: string;
  runId: string;
  reason: string;
};
export type PhoneReconciliationReceipt = {
  version: "learn-operator-phone-reconciliation/1";
  tenant_id: string;
  request_id: string;
  run_id: string;
  state: "pending" | "cancelled" | "recorded";
  stage?: "transcription" | "analysis";
  recording_id?: string;
  already_completed?: boolean;
};
export const phoneReviewOutboxKey = (s: InputScope) => inputOutboxKey(s) + ":phone-reconciliation";
function validateRequest(s: InputScope, r: PhoneReconciliation) {
  phoneReviewOutboxKey(s);
  if (
    !r ||
    r.version !== 1 ||
    r.backend !== s.backend ||
    r.tenantId !== s.tenantId ||
    r.actorId !== s.actorId ||
    !uuid(r.requestId) ||
    !uuid(r.runId) ||
    typeof r.reason !== "string" ||
    r.reason.trim().length < 1 ||
    r.reason.trim().length > 1000 ||
    Object.keys(r).sort().join() !==
      ["version", "backend", "tenantId", "actorId", "requestId", "runId", "reason"].sort().join()
  )
    throw Error("Saved Phone review request is invalid or belongs to another context");
  return r;
}
export function readSavedPhoneReconciliation(
  store: RequestStore,
  s: InputScope,
): PhoneReconciliation | null {
  const raw = store.getItem(phoneReviewOutboxKey(s));
  if (raw === null) return null;
  if (raw.length > 6000) throw Error("Saved Phone review request needs inspection");
  return validateRequest(s, JSON.parse(raw));
}
async function resolve(
  db: OperatorInputClient,
  s: InputScope,
  r: PhoneReconciliation,
  mode: "apply" | "check" | "cancel",
) {
  let response: { data: unknown; error: unknown };
  try {
    response = await db.rpc("learn_operator_phone_reconcile", {
      p_tenant: s.tenantId,
      p_actor: s.actorId,
      p_request: r.requestId,
      p_run: r.runId,
      p_reason: r.reason,
      p_mode: mode,
    });
  } catch {
    throw Error(
      "Phone reconciliation is unconfirmed. The saved request is retained; check its receipt before retrying.",
    );
  }
  const { data, error } = response;
  const v = data as PhoneReconciliationReceipt;
  if (
    error ||
    !v ||
    v.version !== "learn-operator-phone-reconciliation/1" ||
    v.tenant_id !== s.tenantId ||
    v.request_id !== r.requestId ||
    v.run_id !== r.runId ||
    !["pending", "cancelled", "recorded"].includes(v.state) ||
    (v.state === "recorded" &&
      (!["transcription", "analysis"].includes(v.stage ?? "") ||
        !uuid(v.recording_id) ||
        typeof v.already_completed !== "boolean"))
  )
    throw Error(
      "Phone reconciliation is unconfirmed. The saved request is retained; check its receipt before retrying.",
    );
  return v;
}
export async function resolveSavedPhoneReconciliation(
  db: OperatorInputClient,
  store: RequestStore,
  lock: InputLock,
  s: InputScope,
  r: PhoneReconciliation,
  mode: "apply" | "check" | "cancel",
  allowed: () => boolean,
) {
  validateRequest(s, r);
  const key = phoneReviewOutboxKey(s),
    encoded = JSON.stringify(r);
  return lock(key, async () => {
    if (!allowed()) throw Error("Operator context changed");
    const saved = readSavedPhoneReconciliation(store, s);
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
