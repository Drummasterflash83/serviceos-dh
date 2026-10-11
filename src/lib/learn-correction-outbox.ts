import {
  correctPerformanceMeasurement,
  validateCorrectionRequest,
  type CorrectionRequest,
} from "./learn-performance-corrections.ts";
import type { RecoveryLock } from "./learn-slack-recovery-outbox.ts";
import type { ScoreSubject } from "./learn-scorecards.ts";
export type CorrectionScope = {
  backend: string;
  tenantId: string;
  actorId: string;
  subject: Pick<ScoreSubject, "kind" | "id">;
};
export type CorrectionDraft = {
  version: 1;
  backend: string;
  actorId: string;
  subject: Pick<ScoreSubject, "kind" | "id">;
  request: CorrectionRequest;
};
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Client = Parameters<typeof correctPerformanceMeasurement>[0];
export type CorrectionResolution = {
  state: "pending" | "recorded" | "cancelled";
  measurementId: string;
  predecessorId: string;
  recordedAt?: string;
};
const uuid = (v: unknown) =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export function correctionOutboxKey(s: CorrectionScope) {
  if (
    !s ||
    ![s.tenantId, s.actorId, s.subject?.id].every(uuid) ||
    !["member", "team", "job", "customer"].includes(s.subject.kind) ||
    !/^https:\/\/[^/?#]+$/.test(s.backend)
  )
    throw Error("Signed-in company, actor, card and backend required.");
  return `serviceos:correction:1:${encodeURIComponent(s.backend)}:${s.actorId}:${s.tenantId}:${s.subject.kind}:${s.subject.id}`;
}
function keys(value: unknown, allowed: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    throw Error("Unsupported saved correction details.");
}
export function prepareCorrectionDraft(s: CorrectionScope, r: CorrectionRequest): CorrectionDraft {
  correctionOutboxKey(s);
  keys(r, ["tenantId", "measurementId", "requestId", "expectedReviewRevision", "value", "reason"]);
  validateCorrectionRequest(r);
  if (r.tenantId !== s.tenantId) throw Error("Saved correction belongs to another company.");
  return {
    version: 1,
    backend: s.backend,
    actorId: s.actorId,
    subject: { kind: s.subject.kind, id: s.subject.id },
    request: {
      tenantId: r.tenantId,
      measurementId: r.measurementId,
      requestId: r.requestId,
      expectedReviewRevision: r.expectedReviewRevision,
      value: r.value,
      reason: r.reason.trim(),
    },
  };
}
function checked(s: CorrectionScope, d: CorrectionDraft) {
  keys(d, ["version", "backend", "actorId", "subject", "request"]);
  keys(d.subject, ["kind", "id"]);
  if (
    d.version !== 1 ||
    d.backend !== s.backend ||
    d.actorId !== s.actorId ||
    d.subject.kind !== s.subject.kind ||
    d.subject.id !== s.subject.id
  )
    throw Error("Saved correction belongs to another session or card.");
  return prepareCorrectionDraft(s, d.request);
}
export function readCorrectionDraft(
  storage: StoragePort,
  s: CorrectionScope,
): CorrectionDraft | null {
  const raw = storage.getItem(correctionOutboxKey(s));
  if (raw === null) return null;
  try {
    if (raw.length > 16000) throw Error("Oversize request");
    return checked(s, JSON.parse(raw));
  } catch {
    throw Error(
      "The saved correction needs attention. Keep this browser data and ask support before making another correction on this card.",
    );
  }
}
async function resolve(
  db: Client,
  s: CorrectionScope,
  d: CorrectionDraft,
  cancel: boolean,
): Promise<CorrectionResolution> {
  const r = d.request;
  const { data, error } = await db.rpc("learn_performance_correction_resolve", {
    p_tenant: r.tenantId,
    p_measurement: r.measurementId,
    p_request: r.requestId,
    p_expected_review_revision: r.expectedReviewRevision,
    p_value: r.value,
    p_reason: r.reason,
    p_cancel: cancel,
  });
  if (error)
    throw Error(
      error.code === "42501"
        ? "Only a company owner or admin outside preview can recover a correction."
        : "Correction status could not be confirmed. Keep the saved request and check again.",
    );
  if (
    !data ||
    data.tenantId !== s.tenantId ||
    data.actorId !== s.actorId ||
    data.measurementId !== r.requestId ||
    data.predecessorId !== r.measurementId ||
    !["pending", "recorded", "cancelled"].includes(data.state) ||
    (cancel && data.state === "pending") ||
    (data.state === "recorded" &&
      (typeof data.recordedAt !== "string" || !Number.isFinite(Date.parse(data.recordedAt))))
  )
    throw Error("Correction status could not be verified. The saved request has been kept.");
  return data;
}
/** Freeze before network activity. Only a server terminal receipt clears browser intent. */
export async function recoverCorrectionDraft(
  db: Client,
  storage: StoragePort,
  lock: RecoveryLock,
  s: CorrectionScope,
  draft: CorrectionDraft,
  action: "submit" | "check" | "cancel",
  allowed: () => boolean,
) {
  const d = checked(s, draft),
    key = correctionOutboxKey(s),
    encoded = JSON.stringify(d);
  return lock(key, async () => {
    const access = () => {
      if (!allowed())
        throw Error("Card closed or access changed. Reopen it to recover this correction.");
    };
    const retained = () => {
      access();
      if (storage.getItem(key) !== encoded)
        throw Error("Saved correction details changed. Reload this card before continuing.");
    };
    access();
    const old = readCorrectionDraft(storage, s);
    if (old && JSON.stringify(old) !== encoded)
      throw Error("Another correction awaits confirmation on this card. Recover it first.");
    storage.setItem(key, encoded);
    retained();
    let result = await resolve(db, s, d, action === "cancel");
    retained();
    if (result.state === "pending" && action === "submit") {
      await correctPerformanceMeasurement(db, d.request);
      retained();
      result = await resolve(db, s, d, false);
      retained();
      if (result.state !== "recorded")
        throw Error("Correction remains unconfirmed. Check the saved request again.");
    }
    if (result.state !== "pending") {
      storage.removeItem(key);
      if (storage.getItem(key) !== null)
        throw Error(
          "Outcome confirmed, but browser recovery details remain. Check the same request again.",
        );
    }
    return result;
  });
}
