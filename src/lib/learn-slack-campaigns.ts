import type { RecurringClient, RecurringLock, RecurringScope } from "./learn-slack-recurring.ts";
export type CampaignDefinition = {
  connectionId: string;
  connectionRevision: string;
  channelIds: string[];
  start: string;
  end: string;
  expiresAt: string;
  requestBudget: number;
  reason: string;
};
export type CampaignRecoveryInput = {
  campaignId: string;
  accountId: string;
  importId: string;
  failedJobId: string;
  checkpointHash: string;
  reason: string;
};
export type CampaignAction =
  | { operation: "recover_page"; input: CampaignRecoveryInput }
  | {
      operation: "replay_source";
      input: { campaignId: string; sourceMessageId: string; sourceVersion: string; reason: string };
    }
  | { operation: "start"; input: CampaignDefinition }
  | {
      operation: "control";
      input: { campaignId: string; revision: number; enabled: boolean; reason: string };
    }
  | {
      operation: "close";
      input: { campaignId: string; revision: number; action: "stop" | "handoff"; reason: string };
    };
export type CampaignDraft = CampaignAction & {
  version: 1;
  backend: string;
  actorId: string;
  tenantId: string;
  requestId: string;
};
export type CampaignChannel = {
  accountId: string;
  channelId: string;
  state: string;
  channelPagesComplete: boolean;
  discoveryComplete: boolean;
  observedThreads: number;
  completedThreads: number;
  threadsComplete: boolean;
  complete: boolean;
};
export type Campaign = {
  tenantId: string;
  campaignId: string;
  revision: number;
  enabled: boolean;
  start: string;
  end: string;
  expiresAt: string;
  requestBudget: number;
  requestsReserved: number;
  complete: boolean;
  threadsComplete: boolean;
  lifecycle?: "stopped" | "ongoing";
  channels: CampaignChannel[];
};
export type CampaignSummary = {
  campaignId: string;
  start: string;
  end: string;
  enabled: boolean;
  lifecycle: "open" | "stopped" | "ongoing";
  channelCount: number;
};
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const uuid = (x: unknown): x is string =>
  typeof x === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const object = (x: any) => x && typeof x === "object" && !Array.isArray(x);
const date = (x: any) => typeof x === "string" && Number.isFinite(Date.parse(x));
const count = (x: any) => Number.isSafeInteger(x) && x >= 0;
const keys = (x: object, names: string) =>
  Object.keys(x).sort().join() === names.split(",").sort().join();
const reason = (x: any) => typeof x === "string" && x.trim().length > 0 && x.length <= 1000;
export const campaignStates: Record<string, string> = {
  queued: "Queued",
  window_active: "Reading channel history",
  window_queued: "Next channel page queued",
  thread_active: "Reading thread replies",
  thread_queued: "Thread replies queued",
  discovering_threads: "Finding observed threads",
  campaign_window_complete: "Approved window captured",
  request_budget_exhausted: "Request allowance used — new approval needed",
  approval_expired: "Approval expired — review continuation",
  authority_or_capture_unavailable: "Access or capture needs review",
  thread_needs_review: "Thread continuation needs review",
  needs_review: "Import needs review",
  thread_evidence_invalid: "Thread evidence needs review",
  stored_state_unavailable: "Stored import needs review",
  scope_changed: "Import scope changed",
  completion_unverified: "Completion not yet verified",
};
export function campaignKey(s: RecurringScope) {
  if (!uuid(s.actorId) || !uuid(s.tenantId) || !/^https:\/\/[^/?#]+$/.test(s.backend))
    throw Error("A signed-in company and service are required.");
  return `serviceos:slack-campaign:1:${encodeURIComponent(s.backend)}:${s.actorId}:${s.tenantId}`;
}
function validate(d: CampaignDraft) {
  if (
    !object(d) ||
    !keys(d, "version,backend,actorId,tenantId,requestId,operation,input") ||
    d.version !== 1 ||
    !uuid(d.requestId) ||
    !object(d.input)
  )
    throw Error("Saved campaign request needs review.");
  campaignKey(d);
  const x = d.input;
  if (!reason(x.reason)) throw Error("Add a reason for this change.");
  if (d.operation === "start") {
    const x = d.input;
    if (
      !keys(
        x,
        "connectionId,connectionRevision,channelIds,start,end,expiresAt,requestBudget,reason",
      ) ||
      !uuid(x.connectionId) ||
      !date(x.connectionRevision) ||
      ![x.start, x.end, x.expiresAt].every(date) ||
      Date.parse(x.start) < 0 ||
      Date.parse(x.end) <= Date.parse(x.start) ||
      !Array.isArray(x.channelIds) ||
      x.channelIds.length < 1 ||
      x.channelIds.length > 500 ||
      new Set(x.channelIds).size !== x.channelIds.length ||
      x.channelIds.some((c) => typeof c !== "string" || !/^C[A-Z0-9]{1,99}$/.test(c)) ||
      !count(x.requestBudget) ||
      x.requestBudget < 9 ||
      x.requestBudget > 1000000
    )
      throw Error("Review the connection, channels, fixed dates and request allowance.");
  } else if (d.operation === "replay_source") {
    if (
      !keys(x, "campaignId,sourceMessageId,sourceVersion,reason") ||
      !uuid(d.input.campaignId) ||
      !uuid(d.input.sourceMessageId) ||
      !/^[a-f0-9]{64}$/.test(d.input.sourceVersion)
    )
      throw Error("Use the exact campaign, retained source ID and 64-character source version.");
  } else if (d.operation === "recover_page") {
    if (
      !keys(x, "campaignId,accountId,importId,failedJobId,checkpointHash,reason") ||
      ![d.input.campaignId, d.input.accountId, d.input.importId, d.input.failedJobId].every(uuid) ||
      !/^[a-f0-9]{64}$/.test(d.input.checkpointHash)
    )
      throw Error("Refresh the exact failed page and checkpoint before recovery.");
  } else if (d.operation === "control" || d.operation === "close") {
    const x = d.input;
    if (!uuid(x.campaignId) || !count(x.revision) || x.revision < 1)
      throw Error("Refresh the selected campaign before changing it.");
    if (
      d.operation === "control" &&
      (!keys(d.input, "campaignId,revision,enabled,reason") || typeof d.input.enabled !== "boolean")
    )
      throw Error("Invalid capture control.");
    if (
      d.operation === "close" &&
      (!keys(d.input, "campaignId,revision,action,reason") ||
        !["stop", "handoff"].includes(d.input.action))
    )
      throw Error("Invalid campaign action.");
  } else throw Error("Invalid campaign action.");
}
export function prepareCampaign(d: CampaignDraft, now = Date.now()): CampaignDraft {
  validate(d);
  if (
    d.operation === "start" &&
    (Date.parse(d.input.end) > now ||
      Date.parse(d.input.expiresAt) <= now ||
      Date.parse(d.input.expiresAt) > now + 30 * 86400000)
  )
    throw Error("Choose a past cutoff and an approval expiry within 30 days.");
  return JSON.parse(JSON.stringify(d));
}
export function readSavedCampaign(store: Store, s: RecurringScope): CampaignDraft | null {
  const raw = store.getItem(campaignKey(s));
  if (raw === null) return null;
  try {
    if (raw.length > 150000) throw Error();
    const d = JSON.parse(raw);
    validate(d);
    if (d.backend !== s.backend || d.actorId !== s.actorId || d.tenantId !== s.tenantId)
      throw Error();
    return d;
  } catch {
    throw Error(
      "Saved campaign request could not be verified. Keep browser data and ask OpenFolk to review it.",
    );
  }
}
export async function listCampaigns(
  db: RecurringClient,
  tenantId: string,
  after: string | null = null,
) {
  if (!uuid(tenantId) || (after !== null && !uuid(after))) throw Error("Choose a valid company.");
  try {
    const { data: d, error } = await db.rpc("learn_slack_campaign_list", {
      p_tenant: tenantId,
      p_after: after,
    });
    if (
      error ||
      !object(d) ||
      d.version !== "learn-slack-campaign-list/1" ||
      d.tenantId !== tenantId ||
      typeof d.canWrite !== "boolean" ||
      !Array.isArray(d.campaigns) ||
      d.campaigns.length > 20
    )
      throw Error();
    let last = after ?? "";
    for (const c of d.campaigns) {
      if (
        !object(c) ||
        !uuid(c.campaignId) ||
        c.campaignId <= last ||
        ![c.start, c.end].every(date) ||
        typeof c.enabled !== "boolean" ||
        !["open", "stopped", "ongoing"].includes(c.lifecycle) ||
        !count(c.channelCount) ||
        c.channelCount < 1 ||
        c.channelCount > 500
      )
        throw Error();
      last = c.campaignId;
    }
    if (d.next !== null && (!uuid(d.next) || d.next !== last || d.campaigns.length !== 20))
      throw Error();
    return {
      campaigns: d.campaigns as CampaignSummary[],
      canWrite: d.canWrite as boolean,
      next: d.next as string | null,
    };
  } catch {
    throw Error("Campaigns could not be checked. Refresh or ask OpenFolk to check the service.");
  }
}
export async function readCampaign(
  db: RecurringClient,
  tenantId: string,
  campaignId: string,
): Promise<Campaign> {
  if (!uuid(tenantId) || !uuid(campaignId)) throw Error("Choose a valid campaign.");
  try {
    const { data: d, error } = await db.rpc("learn_slack_campaign_read", {
      p_tenant: tenantId,
      p_campaign: campaignId,
    });
    if (
      error ||
      !object(d) ||
      d.version !== "learn-slack-campaign/1" ||
      d.tenantId !== tenantId ||
      d.campaignId !== campaignId ||
      !count(d.revision) ||
      d.revision < 1 ||
      ![d.start, d.end, d.expiresAt].every(date) ||
      typeof d.enabled !== "boolean" ||
      !count(d.requestBudget) ||
      d.requestBudget < 9 ||
      d.requestBudget > 1000000 ||
      !count(d.requestsReserved) ||
      d.requestsReserved > d.requestBudget ||
      d.coverage !== "fixed_window_observed_threads" ||
      d.requestAccounting !== "conservative_dispatch_reservations" ||
      !Array.isArray(d.channels) ||
      d.channels.length < 1 ||
      d.channels.length > 500 ||
      (d.lifecycle !== undefined && !["stopped", "ongoing"].includes(d.lifecycle))
    )
      throw Error();
    const ids = new Set();
    const accounts = new Set();
    for (const c of d.channels) {
      if (
        !object(c) ||
        !uuid(c.accountId) ||
        accounts.has(c.accountId) ||
        typeof c.channelId !== "string" ||
        !/^C[A-Z0-9]{1,99}$/.test(c.channelId) ||
        ids.has(c.channelId) ||
        typeof c.state !== "string" ||
        c.state.length > 100 ||
        ![c.channelPagesComplete, c.discoveryComplete, c.threadsComplete, c.complete].every(
          (x) => typeof x === "boolean",
        ) ||
        !count(c.observedThreads) ||
        !count(c.completedThreads) ||
        c.completedThreads > c.observedThreads ||
        c.threadsComplete !== (c.discoveryComplete && c.completedThreads === c.observedThreads) ||
        c.complete !== (c.channelPagesComplete && c.threadsComplete)
      )
        throw Error();
      ids.add(c.channelId);
      accounts.add(c.accountId);
    }
    if (
      d.complete !== d.channels.every((c: CampaignChannel) => c.complete) ||
      d.threadsComplete !== d.channels.every((c: CampaignChannel) => c.threadsComplete)
    )
      throw Error();
    return d;
  } catch {
    throw Error("Campaign progress could not be verified. Refresh before taking action.");
  }
}
export type CampaignReceipt = { state: string; campaignId?: string; jobId?: string };
export type SourceReplayReceipt = { draft: CampaignDraft; jobId: string };
export function readSourceReplayReceipt(
  store: Store,
  scope: RecurringScope,
): SourceReplayReceipt | null {
  const raw = store.getItem(campaignKey(scope) + ":replay-receipt");
  if (raw === null) return null;
  try {
    if (raw.length > 150000) throw Error();
    const r = JSON.parse(raw);
    validate(r.draft);
    if (
      !keys(r, "draft,jobId") ||
      !["replay_source", "recover_page"].includes(r.draft.operation) ||
      !uuid(r.jobId) ||
      r.draft.backend !== scope.backend ||
      r.draft.actorId !== scope.actorId ||
      r.draft.tenantId !== scope.tenantId
    )
      throw Error();
    return r;
  } catch {
    throw Error(
      "Saved replay receipt could not be verified. Keep browser data for OpenFolk review.",
    );
  }
}
async function dispatch(
  db: RecurringClient,
  d: CampaignDraft,
  mode: "apply" | "check" | "cancel",
): Promise<CampaignReceipt> {
  try {
    const { data: r, error } = await db.rpc("learn_slack_campaign_dispatch", {
      p_tenant: d.tenantId,
      p_actor: d.actorId,
      p_request: d.requestId,
      p_operation: d.operation,
      p_input: d.input,
      p_mode: mode,
    });
    if (error || !object(r) || r.tenantId !== d.tenantId || r.requestId !== d.requestId)
      throw Error();
    if (r.state === "pending" || r.state === "cancelled")
      return r as { state: string; campaignId?: string };
    if (d.operation === "replay_source" || d.operation === "recover_page") {
      if (r.state !== "committed" || !uuid(r.jobId)) throw Error();
      return { state: "committed", campaignId: d.input.campaignId, jobId: r.jobId };
    }
    if (
      r.state !== "recorded" ||
      r.campaignId !== (d.operation === "start" ? d.requestId : d.input.campaignId) ||
      r.revision !== (d.operation === "start" ? 1 : d.input.revision + 1)
    )
      throw Error();
    if (d.operation === "control" && r.enabled !== d.input.enabled) throw Error();
    if (
      d.operation === "close" &&
      (r.lifecycle !== (d.input.action === "stop" ? "stopped" : "ongoing") ||
        typeof r.historicalComplete !== "boolean" ||
        (d.input.action === "handoff" && r.historicalComplete !== true))
    )
      throw Error();
    return r as { state: string; campaignId?: string };
  } catch {
    throw Error(
      "The change was not confirmed. Keep this saved request and check its result before trying again.",
    );
  }
}
export async function resolveCampaign(
  db: RecurringClient,
  store: Store,
  lock: RecurringLock,
  s: RecurringScope,
  d: CampaignDraft,
  mode: "apply" | "check" | "cancel",
  allowed: () => boolean,
) {
  validate(d);
  if (
    d.backend !== s.backend ||
    d.actorId !== s.actorId ||
    d.tenantId !== s.tenantId ||
    !["apply", "check", "cancel"].includes(mode)
  )
    throw Error("Company or sign-in changed. Saved request retained.");
  const key = campaignKey(s),
    encoded = JSON.stringify(d),
    frozen = JSON.parse(encoded) as CampaignDraft;
  return lock(key, async () => {
    if (!allowed()) throw Error("Editing access changed. Saved request retained.");
    const old = readSavedCampaign(store, s);
    if (old && JSON.stringify(old) !== encoded)
      throw Error("Resolve the existing saved request first.");
    store.setItem(key, encoded);
    if (store.getItem(key) !== encoded) throw Error("Could not save this request for recovery.");
    const authority = await listCampaigns(db, s.tenantId);
    if (!allowed() || !authority.canWrite)
      throw Error("Current editing access could not be confirmed. Saved request retained.");
    let r = await dispatch(db, frozen, mode === "apply" ? "check" : mode);
    if (mode === "apply" && r.state === "pending") {
      if (!allowed() || store.getItem(key) !== encoded)
        throw Error("Saved context changed. Check the original request.");
      r = await dispatch(db, frozen, "apply");
    }
    if (r.state !== "pending") {
      if (!allowed() || store.getItem(key) !== encoded)
        throw Error("Result recorded, but the saved context changed. Check its receipt again.");
      if (
        (d.operation === "replay_source" || d.operation === "recover_page") &&
        r.state === "committed"
      ) {
        const prior = readSourceReplayReceipt(store, s);
        if (
          prior?.draft.requestId === d.requestId &&
          (JSON.stringify(prior.draft) !== encoded || prior.jobId !== r.jobId)
        )
          throw Error("Saved replay receipt changed. Keep the request for operator review.");
        const receiptKey = key + ":replay-receipt";
        const receipt = JSON.stringify({ draft: frozen, jobId: r.jobId });
        store.setItem(receiptKey, receipt);
        if (store.getItem(receiptKey) !== receipt)
          throw Error("Replay was queued; keep the saved request until its receipt can be saved.");
      }
      store.removeItem(key);
      if (store.getItem(key) !== null)
        throw Error("Result recorded; recovery storage needs another check.");
    }
    return r;
  });
}

export type CampaignRecoveryState = {
  campaignId: string;
  accountId: string;
  importId: string;
  checkpointHash: string;
  jobId: string | null;
  status: string | null;
  errorCode: string | null;
  diagnostic: { type: string; hidden: string; subtypeType: string; subtype: string | null } | null;
};
export async function readCampaignRecovery(
  db: RecurringClient,
  tenant: string,
  campaign: string,
  account: string,
  request: string | null = null,
): Promise<CampaignRecoveryState> {
  if (![tenant, campaign, account].every(uuid) || (request !== null && !uuid(request)))
    throw Error("Choose a valid campaign channel.");
  try {
    const { data: d, error } = await db.rpc("learn_slack_campaign_recovery_read", {
      p_tenant: tenant,
      p_campaign: campaign,
      p_account: account,
      p_request: request,
    });
    if (
      error ||
      !object(d) ||
      d.version !== "slack-campaign-recovery/1" ||
      d.tenantId !== tenant ||
      d.campaignId !== campaign ||
      d.accountId !== account ||
      d.requestId !== request ||
      !uuid(d.importId) ||
      typeof d.checkpointHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(d.checkpointHash) ||
      (d.jobId !== null && !uuid(d.jobId)) ||
      (d.status !== null &&
        ![
          "queued",
          "running",
          "retrying",
          "succeeded",
          "failed",
          "dead_letter",
          "cancelled",
          "skipped",
        ].includes(d.status)) ||
      (d.errorCode !== null &&
        (typeof d.errorCode !== "string" || !/^slack_history_[a-z_]{1,80}$/.test(d.errorCode)))
    )
      throw Error();
    if (
      d.diagnostic !== null &&
      (!object(d.diagnostic) ||
        d.diagnostic.version !== "slack-structure/1" ||
        ![
          "slack_history_message_shape_unsupported",
          "slack_history_message_subtype_unsupported",
        ].includes(d.diagnostic.code) ||
        !["missing", "message", "other"].includes(d.diagnostic.type) ||
        !["missing", "true", "false", "other"].includes(d.diagnostic.hidden) ||
        !["missing", "string", "other"].includes(d.diagnostic.subtypeType) ||
        (d.diagnostic.subtype !== null &&
          (typeof d.diagnostic.subtype !== "string" ||
            !/^[a-z_]{1,64}$/.test(d.diagnostic.subtype))))
    )
      throw Error();
    return {
      campaignId: campaign,
      accountId: account,
      importId: d.importId,
      checkpointHash: d.checkpointHash,
      jobId: d.jobId,
      status: d.status,
      errorCode: d.errorCode,
      diagnostic:
        d.diagnostic === null
          ? null
          : {
              type: d.diagnostic.type,
              hidden: d.diagnostic.hidden,
              subtypeType: d.diagnostic.subtypeType,
              subtype: d.diagnostic.subtype,
            },
    };
  } catch {
    throw Error(
      "Campaign page recovery could not be verified. Keep the existing checkpoint and refresh.",
    );
  }
}
