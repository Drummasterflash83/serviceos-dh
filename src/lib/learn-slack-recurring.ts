export type RecurringClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
};
export type RecurringChannel = {
  accountId: string;
  name: string;
  teamId: string | null;
  channelId: string | null;
  enabled: boolean;
  revision: number;
  state: string;
  nextStart: string | null;
  nextCheckAt: string | null;
  updatedAt: string | null;
  completeVerified: boolean;
  pausedWindow: boolean;
};
export type RecurringPage = {
  version: "learn-slack-recurring/1";
  tenantId: string;
  canWrite: boolean;
  channels: RecurringChannel[];
  next: string | null;
};
export type RecurringRequest = {
  tenantId: string;
  actorId: string;
  requestId: string;
  accountId: string;
  revision: number;
  enabled: boolean;
  reason: string;
};
export type RecurringReceipt =
  | { tenantId: string; requestId: string; accountId: string; state: "pending" | "cancelled" }
  | {
      tenantId: string;
      requestId: string;
      accountId: string;
      state: "recorded";
      enabled: boolean;
      revision: number;
    };
export type RecurringScope = { backend: string; tenantId: string; actorId: string };
export type SavedRecurring = {
  version: 1;
  backend: string;
  label: string;
  request: RecurringRequest;
};
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type RecurringLock = <T>(key: string, task: () => Promise<T>) => Promise<T>;
const uuid = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s);
const object = (s: any) => s && typeof s === "object" && !Array.isArray(s);
const date = (s: any) => s === null || (typeof s === "string" && Number.isFinite(Date.parse(s)));
export const recurringStates: Record<string, string> = {
  not_configured: "Not enabled",
  ready: "Awaiting scheduler check",
  disabled: "Paused",
  capture_paused: "Paused by LEARN controls",
  approval_changed: "Approval needs review",
  account_unavailable: "Channel account needs attention",
  connection_changed: "Connection needs review",
  connector_paused: "Slack connection is paused",
  window_active: "Processing the approved window",
  window_incomplete: "Window incomplete — review recovery",
  completion_unverified: "Completion needs verification",
  window_changed: "Window changed — review before continuing",
  caught_up: "Approved channel windows are up to date",
  window_queued: "Next window queued",
};
export async function readRecurringChannels(
  db: RecurringClient,
  tenantId: string,
  after: string | null = null,
): Promise<RecurringPage> {
  if (!uuid(tenantId) || (after !== null && !uuid(after))) throw Error("Choose a valid company.");
  try {
    const { data: d, error } = await db.rpc("learn_slack_recurring_read", {
      p_tenant: tenantId,
      p_after: after,
    });
    if (
      error ||
      !object(d) ||
      d.version !== "learn-slack-recurring/1" ||
      d.tenantId !== tenantId ||
      typeof d.canWrite !== "boolean" ||
      !Array.isArray(d.channels) ||
      d.channels.length > 50 ||
      !(d.next === null || uuid(d.next))
    )
      throw Error();
    let last = after ?? "";
    const channels = d.channels.map((c: any): RecurringChannel => {
      if (
        !object(c) ||
        !uuid(c.accountId) ||
        c.accountId <= last ||
        typeof c.name !== "string" ||
        c.name.length > 200 ||
        !(c.teamId === null || (typeof c.teamId === "string" && /^T[A-Z0-9]+$/.test(c.teamId))) ||
        !(
          c.channelId === null ||
          (typeof c.channelId === "string" && /^C[A-Z0-9]+$/.test(c.channelId))
        ) ||
        ![c.enabled, c.completeVerified, c.pausedWindow].every((v) => typeof v === "boolean") ||
        !Number.isSafeInteger(c.revision) ||
        c.revision < 0 ||
        !Object.hasOwn(recurringStates, c.state) ||
        ![c.nextStart, c.nextCheckAt, c.updatedAt].every(date) ||
        (c.enabled && c.revision === 0)
      )
        throw Error();
      last = c.accountId;
      return {
        accountId: c.accountId,
        name: c.name,
        teamId: c.teamId,
        channelId: c.channelId,
        enabled: c.enabled,
        revision: c.revision,
        state: c.state,
        nextStart: c.nextStart,
        nextCheckAt: c.nextCheckAt,
        updatedAt: c.updatedAt,
        completeVerified: c.completeVerified,
        pausedWindow: c.pausedWindow,
      };
    });
    if (d.next !== null && (channels.length !== 50 || d.next !== last)) throw Error();
    return { version: d.version, tenantId, canWrite: d.canWrite, channels, next: d.next };
  } catch {
    throw Error(
      "Ongoing Slack capture could not be checked. Refresh or ask OpenFolk to check the connection.",
    );
  }
}
function validate(r: RecurringRequest) {
  if (
    !object(r) ||
    Object.keys(r).sort().join() !==
      "accountId,actorId,enabled,reason,requestId,revision,tenantId" ||
    ![r.tenantId, r.actorId, r.requestId, r.accountId].every(uuid) ||
    !Number.isSafeInteger(r.revision) ||
    r.revision < 0 ||
    typeof r.enabled !== "boolean" ||
    typeof r.reason !== "string" ||
    !r.reason.trim() ||
    r.reason.length > 1000
  )
    throw Error("Review the channel, action and reason before saving.");
}
export async function resolveRecurring(
  db: RecurringClient,
  r: RecurringRequest,
  mode: "apply" | "check" | "cancel",
): Promise<RecurringReceipt> {
  validate(r);
  if (!["apply", "check", "cancel"].includes(mode)) throw Error("Invalid request action.");
  try {
    const { data: d, error } = await db.rpc("learn_slack_recurring_control", {
      p_tenant: r.tenantId,
      p_actor: r.actorId,
      p_request: r.requestId,
      p_account: r.accountId,
      p_revision: r.revision,
      p_enabled: r.enabled,
      p_reason: r.reason,
      p_mode: mode,
    });
    if (
      error ||
      !object(d) ||
      d.tenantId !== r.tenantId ||
      d.requestId !== r.requestId ||
      d.accountId !== r.accountId
    )
      throw Error();
    const base = { tenantId: r.tenantId, requestId: r.requestId, accountId: r.accountId };
    if (d.state === "pending" || d.state === "cancelled") return { ...base, state: d.state };
    if (d.state !== "recorded" || d.enabled !== r.enabled || d.revision !== r.revision + 1)
      throw Error();
    return { ...base, state: "recorded", enabled: d.enabled, revision: d.revision };
  } catch {
    throw Error(
      "The change could not be confirmed. Keep this saved request and check its result before trying again.",
    );
  }
}
export function recurringOutboxKey(s: RecurringScope) {
  if (!uuid(s.tenantId) || !uuid(s.actorId) || !/^https:\/\/[^/?#]+$/.test(s.backend))
    throw Error("A signed-in company and service are required.");
  return `serviceos:slack-recurring:1:${encodeURIComponent(s.backend)}:${s.actorId}:${s.tenantId}`;
}
function checked(s: RecurringScope, d: SavedRecurring): SavedRecurring {
  recurringOutboxKey(s);
  if (
    !object(d) ||
    Object.keys(d).sort().join() !== "backend,label,request,version" ||
    d.version !== 1 ||
    d.backend !== s.backend ||
    d.request?.actorId !== s.actorId ||
    d.request?.tenantId !== s.tenantId ||
    typeof d.label !== "string" ||
    d.label.length > 200
  )
    throw Error("Saved request belongs to another session or is invalid.");
  validate(d.request);
  return { ...d, request: { ...d.request } };
}
export function readSavedRecurring(store: StoragePort, s: RecurringScope): SavedRecurring | null {
  const raw = store.getItem(recurringOutboxKey(s));
  if (raw === null) return null;
  if (raw.length > 8000)
    throw Error("Saved request is too large. Keep browser data and ask OpenFolk to review it.");
  try {
    return checked(s, JSON.parse(raw));
  } catch {
    throw Error(
      "Saved request could not be verified. Keep browser data and ask OpenFolk to review it.",
    );
  }
}
export async function resolveSavedRecurring(
  db: RecurringClient,
  store: StoragePort,
  lock: RecurringLock,
  s: RecurringScope,
  draft: SavedRecurring,
  mode: "apply" | "check" | "cancel",
  allowed: () => boolean,
): Promise<RecurringReceipt> {
  const key = recurringOutboxKey(s),
    saved = checked(s, draft),
    encoded = JSON.stringify(saved);
  return lock(key, async () => {
    if (!allowed()) throw Error("Access or company changed. Saved request retained.");
    const prior = readSavedRecurring(store, s);
    if (prior && JSON.stringify(prior) !== encoded)
      throw Error("Resolve the existing saved request first.");
    store.setItem(key, encoded);
    if (store.getItem(key) !== encoded) throw Error("Could not save the request for recovery.");
    const authority = await readRecurringChannels(db, s.tenantId);
    if (!allowed() || !authority.canWrite)
      throw Error("Current editing access could not be confirmed. Saved request retained.");
    let result = await resolveRecurring(db, saved.request, mode === "apply" ? "check" : mode);
    if (mode === "apply" && result.state === "pending") {
      if (!allowed()) throw Error("Access or company changed. Saved request retained.");
      result = await resolveRecurring(db, saved.request, "apply");
    }
    if (result.state !== "pending") {
      if (!allowed() || store.getItem(key) !== encoded)
        throw Error("Result recorded, but the saved context changed. Check its receipt again.");
      store.removeItem(key);
      if (store.getItem(key) !== null)
        throw Error("Result recorded; recovery storage needs another check.");
    }
    return result;
  });
}
