import {
  resumeSlackThread,
  validateSlackThreadRecoveryRequest,
  type SlackThreadRecoveryRequest,
  type SlackThreadRecoveryState,
} from "./learn-slack-thread-recovery.ts";
import type { SlackThreadClient } from "./learn-slack-threads.ts";
export type ThreadRecoveryScope = { backend: string; actorId: string; tenantId: string };
export type ThreadRecoveryDraft = {
  version: 1;
  actorId: string;
  backend: string;
  createdAt: string;
  request: SlackThreadRecoveryRequest;
  review: {
    parentTimestamp: string;
    teamId: string;
    channelId: string;
    start: string;
    end: string;
  };
};
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ThreadRecoveryLock = <T>(key: string, task: () => Promise<T>) => Promise<T>;
const uuid = (s: unknown) =>
  typeof s === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(s);
export function threadRecoveryOutboxKey(scope: ThreadRecoveryScope) {
  if (!uuid(scope.actorId) || !uuid(scope.tenantId) || !/^https:\/\/[^/?#]+$/.test(scope.backend))
    throw Error("A signed-in company and backend are required for saved recovery.");
  return `serviceos:slack-thread-recovery:1:${encodeURIComponent(scope.backend)}:${scope.actorId}:${scope.tenantId}`;
}
function checked(scope: ThreadRecoveryScope, d: ThreadRecoveryDraft): ThreadRecoveryDraft {
  threadRecoveryOutboxKey(scope);
  if (
    !d ||
    d.version !== 1 ||
    d.actorId !== scope.actorId ||
    d.backend !== scope.backend ||
    d.request?.tenantId !== scope.tenantId ||
    !Number.isFinite(Date.parse(d.createdAt))
  )
    throw Error("Saved recovery belongs to a different session or cannot be verified.");
  validateSlackThreadRecoveryRequest(d.request);
  const r = d.review;
  if (
    !r ||
    typeof r.parentTimestamp !== "string" ||
    !/^\d{1,12}\.\d{1,6}$/.test(r.parentTimestamp) ||
    !/^T[A-Z0-9]+$/.test(r.teamId) ||
    !/^C[A-Z0-9]+$/.test(r.channelId) ||
    !Number.isFinite(Date.parse(r.start)) ||
    !Number.isFinite(Date.parse(r.end)) ||
    Date.parse(r.start) < 0 ||
    Date.parse(r.end) <= Date.parse(r.start)
  )
    throw Error("Saved recovery window could not be verified.");
  return {
    version: 1,
    actorId: d.actorId,
    backend: d.backend,
    createdAt: d.createdAt,
    request: {
      requestId: d.request.requestId,
      tenantId: d.request.tenantId,
      accountId: d.request.accountId,
      importId: d.request.importId,
      stateVersion: d.request.stateVersion,
      mode: d.request.mode,
      maxPages: d.request.maxPages,
      reason: d.request.reason,
    },
    review: {
      parentTimestamp: r.parentTimestamp,
      teamId: r.teamId,
      channelId: r.channelId,
      start: r.start,
      end: r.end,
    },
  };
}
export function readThreadRecoveryDraft(
  storage: StoragePort,
  scope: ThreadRecoveryScope,
): ThreadRecoveryDraft | null {
  const raw = storage.getItem(threadRecoveryOutboxKey(scope));
  if (raw === null) return null;
  if (raw.length > 16000) throw Error("Saved recovery is too large to verify.");
  try {
    return checked(scope, JSON.parse(raw));
  } catch {
    throw Error(
      "Saved recovery could not be verified. Keep this browser data and contact support before approving again.",
    );
  }
}
export function prepareThreadRecoveryDraft(
  scope: ThreadRecoveryScope,
  state: SlackThreadRecoveryState,
  request: SlackThreadRecoveryRequest,
): ThreadRecoveryDraft {
  if (
    state.tenantId !== scope.tenantId ||
    request.accountId !== state.accountId ||
    request.importId !== state.importId ||
    state.supersededBy !== null ||
    request.stateVersion !== state.stateVersion ||
    !state.window ||
    !state.stateValid ||
    state.active ||
    (request.mode === "continue" ? !state.canContinue : !state.canRestart)
  )
    throw Error("Refresh thread progress before reviewing recovery.");
  return checked(scope, {
    version: 1,
    actorId: scope.actorId,
    backend: scope.backend,
    createdAt: new Date().toISOString(),
    request,
    review: {
      parentTimestamp: state.parentTimestamp,
      teamId: state.teamId,
      channelId: state.channelId,
      start: state.window.start,
      end: state.window.end,
    },
  });
}
/** Save before sending; serialize same-browser tabs; never clear uncertain work. */
export async function submitThreadRecoveryDraft(
  db: SlackThreadClient,
  storage: StoragePort,
  lock: ThreadRecoveryLock,
  scope: ThreadRecoveryScope,
  draft: ThreadRecoveryDraft,
  allowed: () => boolean,
) {
  const key = threadRecoveryOutboxKey(scope),
    value = checked(scope, draft);
  return lock(key, async () => {
    if (!allowed()) throw Error("Company owner or admin access is required outside preview.");
    const old = readThreadRecoveryDraft(storage, scope);
    if (old && JSON.stringify(old) !== JSON.stringify(value))
      throw Error("Another saved recovery is waiting. Reload it before approving a new request.");
    const encoded = JSON.stringify(value);
    storage.setItem(key, encoded);
    if (storage.getItem(key) !== encoded)
      throw Error("Recovery could not be saved in this browser. No request was sent.");
    if (!allowed())
      throw Error(
        "This review closed or your approval access changed. The saved request has not been sent.",
      );
    const receipt = await resumeSlackThread(db, value.request);
    // Do not discard a replacement written outside our lock (for example another
    // app version). Successful resolution is the only automatic removal path.
    if (storage.getItem(key) !== encoded)
      throw Error(
        "Approval was recorded, but saved browser state changed. Reload before continuing.",
      );
    storage.removeItem(key);
    if (storage.getItem(key) !== null)
      throw Error(
        "Approval was recorded, but its saved request could not be cleared. Retry the same request.",
      );
    return receipt;
  });
}
export async function discardRejectedThreadRecovery(
  storage: StoragePort,
  lock: ThreadRecoveryLock,
  scope: ThreadRecoveryScope,
  requestId: string,
) {
  return lock(threadRecoveryOutboxKey(scope), async () => {
    const d = readThreadRecoveryDraft(storage, scope);
    if (d && d.request.requestId !== requestId)
      throw Error("The saved request changed. Reload before clearing it.");
    storage.removeItem(threadRecoveryOutboxKey(scope));
    if (storage.getItem(threadRecoveryOutboxKey(scope)) !== null)
      throw Error("The rejected review could not be cleared from this browser.");
  });
}
