import {
  validateWorkCollectionRequest,
  beginWorkCollection,
  advanceWorkCollection,
  readWorkCollectionProgress,
  abandonWorkCollection,
  type WorkCollectionRequest,
  type WorkCollectionProgress,
  type WorkCollectionClient,
} from "./learn-resumable-work.ts";
import { WORK_COLLECTORS, type WorkCollectionKind } from "./learn-work-collection.ts";
import type { RecoveryLock, RecoveryScope } from "./learn-slack-recovery-outbox.ts";
export type WorkCollectionScope = RecoveryScope & { subjectId: string; kind: WorkCollectionKind };
export type WorkCollectionDraft = { version: 1; backend: string; request: WorkCollectionRequest };
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const uuid = (v: unknown) =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export function workCollectionOutboxKey(s: WorkCollectionScope) {
  if (
    ![s.tenantId, s.actorId, s.subjectId].every(uuid) ||
    !Object.hasOwn(WORK_COLLECTORS, s.kind) ||
    !/^https:\/\/[^/?#]+$/.test(s.backend)
  )
    throw Error("A signed-in company and card are required for collection recovery");
  return `serviceos:work-collection:1:${encodeURIComponent(s.backend)}:${s.actorId}:${s.tenantId}:${s.subjectId}:${s.kind}`;
}
function keys(v: unknown, allowed: string[]) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !allowed.includes(k))
  )
    throw Error("Unsupported saved collection details");
}
export function prepareWorkCollectionDraft(
  s: WorkCollectionScope,
  request: WorkCollectionRequest,
): WorkCollectionDraft {
  workCollectionOutboxKey(s);
  validateWorkCollectionRequest(request);
  keys(request, [
    "tenantId",
    "actorId",
    "requestId",
    "kind",
    "subjectId",
    "policyId",
    "policyVersion",
    "period",
    "reason",
  ]);
  keys(request.period, ["start", "end"]);
  if (
    request.tenantId !== s.tenantId ||
    request.actorId !== s.actorId ||
    request.subjectId !== s.subjectId ||
    request.kind !== s.kind
  )
    throw Error("Saved collection belongs to another session or card");
  return {
    version: 1,
    backend: s.backend,
    request: {
      tenantId: request.tenantId,
      actorId: request.actorId,
      requestId: request.requestId,
      kind: request.kind,
      subjectId: request.subjectId,
      policyId: request.policyId,
      policyVersion: request.policyVersion,
      period: { start: request.period.start, end: request.period.end },
      reason: request.reason.trim(),
    },
  };
}
export function readWorkCollectionDraft(
  storage: StoragePort,
  s: WorkCollectionScope,
): WorkCollectionDraft | null {
  const raw = storage.getItem(workCollectionOutboxKey(s));
  if (raw === null) return null;
  try {
    if (raw.length > 12000) throw Error("Too large");
    const d = JSON.parse(raw);
    keys(d, ["version", "backend", "request"]);
    if (d.version !== 1 || d.backend !== s.backend) throw Error("Wrong backend");
    return prepareWorkCollectionDraft(s, d.request);
  } catch {
    throw Error(
      "The saved collection request needs attention. Keep this browser data and contact support before starting another.",
    );
  }
}
/** One browser lock protects the retained request across tabs. The server serializes
 * steps separately. Each boundary rechecks current UI access, scope and storage.
 * Closing/pausing stops further dispatch; an in-flight batch may still finish. */
export async function operateWorkCollection(
  db: WorkCollectionClient,
  storage: StoragePort,
  lock: RecoveryLock,
  s: WorkCollectionScope,
  draft: WorkCollectionDraft,
  action: "run" | "check" | "end" | "clear",
  allowed: () => boolean,
  onProgress: (p: WorkCollectionProgress) => void = () => {},
  endReason?: string,
) {
  const key = workCollectionOutboxKey(s),
    canonical = prepareWorkCollectionDraft(s, draft.request);
  if (draft.version !== 1 || draft.backend !== s.backend)
    throw Error("Saved collection backend differs");
  return lock(key, async () => {
    const access = () => {
      if (!allowed())
        throw Error(
          "Collection paused. Its request is retained; check progress before continuing.",
        );
    };
    access();
    const old = readWorkCollectionDraft(storage, s);
    if (old && JSON.stringify(old) !== JSON.stringify(canonical))
      throw Error("Another collection request is retained. Reload this card first.");
    if (!old && action !== "run") throw Error("No saved collection request is available");
    const encoded = JSON.stringify(canonical);
    storage.setItem(key, encoded);
    const current = () => {
      access();
      if (storage.getItem(key) !== encoded)
        throw Error("Saved collection details changed. Reload before continuing.");
    };
    current();
    let progress =
      action === "run"
        ? await beginWorkCollection(db, canonical.request)
        : action === "end"
          ? await abandonWorkCollection(db, canonical.request, endReason ?? "")
          : await readWorkCollectionProgress(db, canonical.request);
    current();
    onProgress(progress);
    if (action === "run")
      while (progress.state === "collecting") {
        current();
        const next = await advanceWorkCollection(db, canonical.request, progress);
        current();
        if (next.state === "collecting" && next.processed <= progress.processed)
          throw Error(
            "The next checkpoint was not confirmed. Check this request before continuing.",
          );
        progress = next;
        onProgress(progress);
      }
    if (action === "clear") {
      if (progress.state === "collecting")
        throw Error(
          "This collection is unfinished. Resume or end it before clearing its reminder.",
        );
      current();
      storage.removeItem(key);
      if (storage.getItem(key) !== null)
        throw Error(
          "The outcome is confirmed but its browser reminder remains. Check the same request again.",
        );
    }
    return progress;
  });
}
