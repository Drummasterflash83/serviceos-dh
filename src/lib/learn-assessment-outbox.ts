import {
  assessmentArguments,
  saveAssessment,
  validateAssessmentRequest,
  type AssessmentClient,
  type SaveAssessmentRequest,
} from "./learn-assessments.ts";
import type { RecoveryLock, RecoveryScope } from "./learn-slack-recovery-outbox.ts";

export type AssessmentScope = RecoveryScope & {
  subject: Pick<SaveAssessmentRequest["subject"], "kind" | "id">;
};
export type AssessmentDraft = {
  version: 1;
  backend: string;
  actorId: string;
  request: SaveAssessmentRequest;
};
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type AssessmentResolution = {
  state: "pending" | "recorded" | "cancelled";
  assessmentId: string;
  recordedAt?: string;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export function assessmentOutboxKey(s: AssessmentScope) {
  if (
    !uuid(s.actorId) ||
    !uuid(s.tenantId) ||
    !uuid(s.subject?.id) ||
    !["member", "team", "job", "customer"].includes(s.subject.kind) ||
    !/^https:\/\/[^/?#]+$/.test(s.backend)
  )
    throw Error("Sign in to this company before recovering an assessment.");
  return `serviceos:assessment:1:${encodeURIComponent(s.backend)}:${s.actorId}:${s.tenantId}:${s.subject.kind}:${s.subject.id}`;
}
function onlyKeys(value: object, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    throw Error("Saved assessment request contains unsupported details.");
}
function checked(scope: AssessmentScope, d: AssessmentDraft): AssessmentDraft {
  assessmentOutboxKey(scope);
  onlyKeys(d, ["version", "backend", "actorId", "request"]);
  if (d.version !== 1 || d.backend !== scope.backend || d.actorId !== scope.actorId)
    throw Error("Saved assessment belongs to another session.");
  const r = d.request;
  validateAssessmentRequest(r);
  onlyKeys(r, [
    "tenantId",
    "requestId",
    "publicationId",
    "subject",
    "groupId",
    "period",
    "expected",
    "reason",
  ]);
  onlyKeys(r.subject, ["kind", "id", "groupIds"]);
  onlyKeys(r.period, ["start", "end"]);
  r.expected.forEach((e) => onlyKeys(e, ["id", "reviewRevision"]));
  if (
    r.tenantId !== scope.tenantId ||
    r.subject.id !== scope.subject.id ||
    r.subject.kind !== scope.subject.kind
  )
    throw Error("Saved assessment belongs to another card or company.");
  return {
    version: 1,
    backend: scope.backend,
    actorId: scope.actorId,
    request: {
      tenantId: r.tenantId,
      requestId: r.requestId,
      publicationId: r.publicationId,
      subject: { kind: r.subject.kind, id: r.subject.id },
      groupId: r.groupId,
      period: {
        start: new Date(r.period.start).toISOString(),
        end: new Date(r.period.end).toISOString(),
      },
      expected: r.expected.map((e) => ({ id: e.id, reviewRevision: e.reviewRevision })),
      reason: r.reason.trim(),
    },
  };
}
export function prepareAssessmentDraft(scope: AssessmentScope, request: SaveAssessmentRequest) {
  return checked(scope, { version: 1, backend: scope.backend, actorId: scope.actorId, request });
}
export function readAssessmentDraft(storage: StoragePort, scope: AssessmentScope) {
  const raw = storage.getItem(assessmentOutboxKey(scope));
  if (raw === null) return null;
  try {
    if (raw.length > 100000) throw Error("Too large");
    return checked(scope, JSON.parse(raw));
  } catch {
    throw Error(
      "The saved assessment request needs attention. Keep this browser data and ask support before saving again.",
    );
  }
}
async function resolve(
  db: AssessmentClient,
  scope: AssessmentScope,
  draft: AssessmentDraft,
  cancel: boolean,
) {
  const { data, error } = await db.rpc("learn_assessment_resolve", {
    ...assessmentArguments(draft.request),
    p_cancel: cancel,
  });
  if (error)
    throw Error(
      error.code === "42501"
        ? "Only a company owner or admin outside preview can recover an assessment."
        : "Assessment status could not be confirmed. Keep the saved request and check again.",
    );
  if (
    !data ||
    data.tenantId !== scope.tenantId ||
    data.actorId !== scope.actorId ||
    data.assessmentId !== draft.request.requestId ||
    !["pending", "recorded", "cancelled"].includes(data.state) ||
    (data.state === "recorded" &&
      (typeof data.recordedAt !== "string" || !Number.isFinite(Date.parse(data.recordedAt)))) ||
    (cancel && data.state === "pending")
  )
    throw Error("Assessment status could not be verified. The saved request has been kept.");
  return data as AssessmentResolution;
}
/** Persist the exact request before the first call. A server-confirmed terminal
 * outcome is required before clearing; cancellation shares the save's DB lock. */
export async function recoverAssessmentDraft(
  db: AssessmentClient,
  storage: StoragePort,
  lock: RecoveryLock,
  scope: AssessmentScope,
  draft: AssessmentDraft,
  action: "save" | "check" | "cancel",
  allowed: () => boolean,
) {
  const key = assessmentOutboxKey(scope),
    value = checked(scope, draft);
  return lock(key, async () => {
    const requireAccess = () => {
      if (!allowed())
        throw Error(
          "This card closed or your access changed. Reopen it to recover the saved request.",
        );
    };
    requireAccess();
    const old = readAssessmentDraft(storage, scope);
    if (old && JSON.stringify(old) !== JSON.stringify(value))
      throw Error("Another assessment is awaiting confirmation. Reload this card first.");
    const encoded = JSON.stringify(value);
    storage.setItem(key, encoded);
    if (storage.getItem(key) !== encoded)
      throw Error("This browser could not retain the request. No assessment request was sent.");
    requireAccess();
    let result = await resolve(db, scope, value, action === "cancel");
    requireAccess();
    if (storage.getItem(key) !== encoded)
      throw Error("Saved browser details changed. Reload this card before continuing.");
    if (result.state === "pending" && action === "save") {
      await saveAssessment(db, value.request);
      requireAccess();
      result = await resolve(db, scope, value, false);
      if (result.state !== "recorded")
        throw Error("The save has not been confirmed. Check the saved request again.");
    }
    requireAccess();
    if (storage.getItem(key) !== encoded)
      throw Error("Saved browser details changed. Reload this card before continuing.");
    if (result.state !== "pending") {
      storage.removeItem(key);
      if (storage.getItem(key) !== null)
        throw Error(
          "The outcome is confirmed, but browser recovery details remain. Check the same request again.",
        );
    }
    return result;
  });
}
