import {
  delayUuid,
  normalizeDelayPayload,
  recordWorkDelay,
  resolveWorkDelay,
  type DelayClient,
  type DelayPayload,
} from "./learn-work-delays.ts";
export type DelayScope = { backend: string; tenantId: string; actorId: string; objectId: string };
export type DelayDraft = {
  version: 1;
  backend: string;
  tenantId: string;
  actorId: string;
  requestId: string;
  payload: DelayPayload;
};
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type DelayRecoveryLock = <T>(key: string, action: () => Promise<T>) => Promise<T>;
export function delayOutboxKey(scope: DelayScope) {
  if (
    typeof scope.backend !== "string" ||
    !scope.backend.trim() ||
    scope.backend.length > 1000 ||
    ![scope.tenantId, scope.actorId, scope.objectId].every(delayUuid)
  )
    throw Error("Signed-in company, actor, work item and backend required.");
  return `learn-delay-outbox:v1:${encodeURIComponent(scope.backend)}:${scope.actorId}:${scope.tenantId}:${scope.objectId}`;
}
function checked(scope: DelayScope, value: DelayDraft): DelayDraft {
  delayOutboxKey(scope);
  const keys = ["version", "backend", "tenantId", "actorId", "requestId", "payload"];
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    value.version !== 1 ||
    value.backend !== scope.backend ||
    value.tenantId !== scope.tenantId ||
    value.actorId !== scope.actorId ||
    !delayUuid(value.requestId)
  )
    throw Error("Saved delay request belongs to another company, actor or backend.");
  const payload = normalizeDelayPayload(value.payload);
  if (payload.objectId !== scope.objectId)
    throw Error("Saved delay request belongs to another work item.");
  return {
    version: 1,
    backend: scope.backend,
    tenantId: scope.tenantId,
    actorId: scope.actorId,
    requestId: value.requestId,
    payload,
  };
}
export function prepareDelayDraft(scope: DelayScope, requestId: string, payload: DelayPayload) {
  return checked(scope, {
    version: 1,
    backend: scope.backend,
    tenantId: scope.tenantId,
    actorId: scope.actorId,
    requestId,
    payload,
  });
}
export function readDelayDraft(storage: StoragePort, scope: DelayScope): DelayDraft | null {
  const raw = storage.getItem(delayOutboxKey(scope));
  if (raw === null) return null;
  try {
    if (raw.length > 35000) throw Error("Oversize request");
    return checked(scope, JSON.parse(raw));
  } catch {
    throw Error(
      "The saved delay review needs attention. Keep this browser data and ask support before making another delay change on this work.",
    );
  }
}
/** One exact approval or reversal intent per actor/work item, retained before
 * contacting the server and cleared only after a verified terminal receipt. */
export async function recoverDelayDraft(
  db: DelayClient,
  storage: StoragePort,
  lock: DelayRecoveryLock,
  scope: DelayScope,
  draft: DelayDraft,
  action: "submit" | "check" | "cancel",
  allowed: () => boolean,
) {
  const value = checked(scope, draft),
    key = delayOutboxKey(scope),
    encoded = JSON.stringify(value);
  return lock(key, async () => {
    const access = () => {
      if (!allowed())
        throw Error(
          "Work review closed or your access changed. Reopen it to recover the saved request.",
        );
    };
    const retained = () => {
      access();
      if (storage.getItem(key) !== encoded)
        throw Error("Saved browser details changed. Reload this work review before continuing.");
    };
    access();
    const old = readDelayDraft(storage, scope);
    if (old && JSON.stringify(old) !== encoded)
      throw Error("Another delay change awaits confirmation on this work. Recover it first.");
    storage.setItem(key, encoded);
    retained();
    let result = await resolveWorkDelay(
      db,
      scope.tenantId,
      scope.actorId,
      value.requestId,
      value.payload,
      action === "cancel",
    );
    retained();
    if (result.state === "pending" && action === "submit") {
      await recordWorkDelay(db, scope.tenantId, scope.actorId, value.requestId, value.payload);
      retained();
      result = await resolveWorkDelay(
        db,
        scope.tenantId,
        scope.actorId,
        value.requestId,
        value.payload,
        false,
      );
      retained();
      if (result.state !== "recorded")
        throw Error("Delay change remains unconfirmed. Check the saved request again.");
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
