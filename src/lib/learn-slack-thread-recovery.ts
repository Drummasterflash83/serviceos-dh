import type { SlackThreadClient } from "./learn-slack-threads.ts";

export type SlackThreadRecoveryMode = "continue" | "restart";
export type SlackThreadRecoveryState = {
  version: "learn-slack-thread-recovery/1";
  tenantId: string;
  accountId: string;
  teamId: string;
  channelId: string;
  importId: string;
  approvedAt: string;
  previousImportId: string | null;
  recoveryMode: SlackThreadRecoveryMode | null;
  parentTimestamp: string;
  supersededBy: string | null;
  stateVersion: string;
  stateValid: boolean;
  active: boolean;
  canContinue: boolean;
  canRestart: boolean;
  window: { start: string; end: string; pageLimit: number; expiresAt: string } | null;
  progress: { pagesThisApproval: number; complete: boolean; hasCursor: boolean } | null;
  latestJob: {
    id: string;
    status: string;
    availableAt: string | null;
    errorCode: string | null;
    stopReason: string | null;
  } | null;
  coverage: "observed_thread_window";
};
export type SlackThreadRecoveryRequest = {
  requestId: string;
  tenantId: string;
  accountId: string;
  importId: string;
  stateVersion: string;
  mode: SlackThreadRecoveryMode;
  maxPages: number;
  reason: string;
};
export class SlackThreadRecoveryError extends Error {
  kind: "invalid" | "unavailable" | "forbidden" | "conflict" | "uncertain";
  constructor(kind: SlackThreadRecoveryError["kind"], message: string) {
    super(message);
    this.name = "SlackThreadRecoveryError";
    this.kind = kind;
  }
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
const budget = (v: unknown) => Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 10;
const mode = (v: unknown) => v === "continue" || v === "restart";
const statuses = [
  "queued",
  "running",
  "retrying",
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
  "dead_letter",
];
const stops = [
  "window_pages_complete",
  "page_budget_exhausted",
  "run_page_limit",
  "authorisation_changed",
];
const unavailable = () =>
  new SlackThreadRecoveryError(
    "unavailable",
    "Thread progress could not be verified. Reload before reviewing recovery.",
  );

export async function loadSlackThreadRecovery(
  db: SlackThreadClient,
  tenantId: string,
  accountId: string,
  importId: string,
): Promise<SlackThreadRecoveryState> {
  if (!uuid(tenantId) || !uuid(accountId) || !uuid(importId)) throw unavailable();
  let response;
  try {
    response = await db.rpc("learn_slack_thread_recovery_read", {
      p_tenant_id: tenantId,
      p_import_id: importId,
    });
  } catch {
    throw unavailable();
  }
  const { data: d, error } = response;
  if (
    error ||
    !d ||
    d.version !== "learn-slack-thread-recovery/1" ||
    d.tenantId !== tenantId ||
    d.accountId !== accountId ||
    d.importId !== importId ||
    typeof d.parentTimestamp !== "string" ||
    !/^\d{1,12}\.\d{1,6}$/.test(d.parentTimestamp) ||
    (d.supersededBy !== null && !uuid(d.supersededBy)) ||
    d.coverage !== "observed_thread_window" ||
    typeof d.teamId !== "string" ||
    !/^T[A-Z0-9]+$/.test(d.teamId) ||
    typeof d.channelId !== "string" ||
    !/^C[A-Z0-9]+$/.test(d.channelId) ||
    !hash(d.stateVersion) ||
    [d.stateValid, d.active, d.canContinue, d.canRestart].some((v) => typeof v !== "boolean") ||
    (d.importId !== null && !uuid(d.importId)) ||
    !date(d.approvedAt) ||
    (d.previousImportId !== null && !uuid(d.previousImportId)) ||
    (d.recoveryMode !== null && !mode(d.recoveryMode)) ||
    (d.previousImportId === null) !== (d.recoveryMode === null) ||
    d.previousImportId === importId ||
    d.supersededBy === importId
  )
    throw unavailable();
  const w = d.window,
    p = d.progress,
    j = d.latestJob;
  if (d.stateValid) {
    if (
      !uuid(d.importId) ||
      !date(d.approvedAt) ||
      !w ||
      !p ||
      !date(w.start) ||
      !date(w.end) ||
      !date(w.expiresAt) ||
      Date.parse(w.start) < 0 ||
      Date.parse(w.end) <= Date.parse(w.start) ||
      !budget(w.pageLimit) ||
      !Number.isInteger(p.pagesThisApproval) ||
      p.pagesThisApproval < 0 ||
      p.pagesThisApproval > w.pageLimit ||
      typeof p.complete !== "boolean" ||
      typeof p.hasCursor !== "boolean" ||
      (p.complete && p.hasCursor)
    )
      throw unavailable();
  } else if (w !== null || p !== null) throw unavailable();
  if (
    (d.canRestart && (!d.stateValid || d.active || p?.complete || d.supersededBy !== null)) ||
    (d.canContinue && (!d.canRestart || (!p?.hasCursor && p?.pagesThisApproval !== 0)))
  )
    throw unavailable();
  if (
    j !== null &&
    (!j ||
      !uuid(j.id) ||
      !statuses.includes(j.status) ||
      (j.availableAt !== null && !date(j.availableAt)) ||
      (j.errorCode !== null &&
        (typeof j.errorCode !== "string" || !/^slack_history_[a-z_]{1,80}$/.test(j.errorCode))) ||
      (j.stopReason !== null && !stops.includes(j.stopReason)))
  )
    throw unavailable();
  // Return only the public contract, never unexpected checkpoint/credential fields.
  return {
    version: d.version,
    tenantId,
    accountId,
    teamId: d.teamId,
    channelId: d.channelId,
    importId: d.importId,
    approvedAt: d.approvedAt,
    previousImportId: d.previousImportId,
    recoveryMode: d.recoveryMode,
    parentTimestamp: d.parentTimestamp,
    supersededBy: d.supersededBy,
    stateVersion: d.stateVersion,
    stateValid: d.stateValid,
    active: d.active,
    canContinue: d.canContinue,
    canRestart: d.canRestart,
    window:
      w === null
        ? null
        : { start: w.start, end: w.end, pageLimit: w.pageLimit, expiresAt: w.expiresAt },
    progress:
      p === null
        ? null
        : { pagesThisApproval: p.pagesThisApproval, complete: p.complete, hasCursor: p.hasCursor },
    latestJob:
      j === null
        ? null
        : {
            id: j.id,
            status: j.status,
            availableAt: j.availableAt,
            errorCode: j.errorCode,
            stopReason: j.stopReason,
          },
    coverage: d.coverage,
  };
}

export function validateSlackThreadRecoveryRequest(r: SlackThreadRecoveryRequest) {
  if (
    !uuid(r.requestId) ||
    !uuid(r.tenantId) ||
    !uuid(r.accountId) ||
    !uuid(r.importId) ||
    !hash(r.stateVersion) ||
    !mode(r.mode) ||
    !budget(r.maxPages) ||
    typeof r.reason !== "string" ||
    r.reason.trim().length < 1 ||
    r.reason.trim().length > 1000
  )
    throw new SlackThreadRecoveryError(
      "invalid",
      "Review a stored thread, choose continue or restart, a page limit from 1 to 10 and a reason.",
    );
}

export async function resumeSlackThread(db: SlackThreadClient, r: SlackThreadRecoveryRequest) {
  validateSlackThreadRecoveryRequest(r);
  const uncertain = () =>
    new SlackThreadRecoveryError(
      "uncertain",
      "Recovery approval was not confirmed. Keep and retry this same request to avoid duplicates.",
    );
  let response;
  try {
    response = await db.rpc("learn_slack_resume_thread", {
      p_tenant_id: r.tenantId,
      p_request_id: r.requestId,
      p_import_id: r.importId,
      p_expected_state_version: r.stateVersion,
      p_mode: r.mode,
      p_max_pages: r.maxPages,
      p_reason: r.reason.trim(),
    });
  } catch {
    throw uncertain();
  }
  const { data, error } = response;
  if (error) {
    if (error.code === "42501")
      throw new SlackThreadRecoveryError(
        "forbidden",
        "Company owner or admin access is required outside preview.",
      );
    if (error.code === "PT409")
      throw new SlackThreadRecoveryError(
        "conflict",
        "Thread progress, connection or request changed. Reload before preparing another recovery.",
      );
    if (error.code === "55000")
      throw new SlackThreadRecoveryError(
        "unavailable",
        "Recovery is unavailable for the current thread state. Reload its progress.",
      );
    if (error.code === "22023")
      throw new SlackThreadRecoveryError(
        "invalid",
        "The recovery approval is invalid. Review its settings.",
      );
    throw uncertain();
  }
  if (
    data?.requestId !== r.requestId ||
    data.accountId !== r.accountId ||
    data.previousImportId !== r.importId ||
    !uuid(data.jobId) ||
    typeof data.reused !== "boolean"
  )
    throw uncertain();
  return {
    requestId: r.requestId,
    accountId: r.accountId,
    previousImportId: r.importId,
    jobId: data.jobId as string,
    reused: data.reused as boolean,
  };
}
