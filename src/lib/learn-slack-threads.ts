import { SlackImportError } from "./learn-slack-import-errors.ts";
export type SlackThreadClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: any; error: { code?: string } | null }>;
};
export type SlackStoredChannel = {
  id: string;
  name: string;
  status: string;
  teamId: string;
  channelId: string;
};
export type SlackThreadImport = {
  id: string;
  approvedAt: string;
  start: string;
  end: string;
  pages: number;
  pageLimit: number;
  complete: boolean;
  status: string | null;
  availableAt: string | null;
  errorCode: string | null;
  stopReason: string | null;
};
export type SlackObservedThread = {
  sourceId: string;
  sourceVersion: string;
  parentTimestamp: string;
  observedTimestamp: string;
  excerpt: string;
  latestImport: SlackThreadImport | null;
};
export type SlackThreadPage = {
  version: "learn-slack-threads/1";
  tenantId: string;
  accountId: string;
  teamId: string;
  channelId: string;
  canImport: boolean;
  connectionRevision: string | null;
  threads: SlackObservedThread[];
  nextCursor: string | null;
  coverage: "observed_threads_only";
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const stamp = (v: unknown): v is string => typeof v === "string" && /^\d{1,12}\.\d{1,6}$/.test(v);
const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const micros = (v: string) => {
  const [s, f] = v.split(".");
  return BigInt(s) * 1000000n + BigInt(f.padEnd(6, "0"));
};
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
export async function loadSlackStoredChannels(
  db: SlackThreadClient,
  tenantId: string,
  afterId: string | null = null,
) {
  if (!uuid(tenantId) || (afterId !== null && !uuid(afterId)))
    throw Error("Invalid company or channel page.");
  const { data, error } = await db.rpc("learn_slack_accounts_read", {
    p_tenant_id: tenantId,
    p_after_id: afterId,
  });
  if (
    error ||
    data?.version !== "learn-slack-accounts/1" ||
    data.tenantId !== tenantId ||
    !Array.isArray(data.accounts) ||
    data.accounts.length > 20 ||
    (data.nextCursor !== null && !uuid(data.nextCursor))
  )
    throw Error("Stored Slack channels are unavailable. Reload to try again.");
  const seen = new Set<string>();
  let last = afterId;
  for (const a of data.accounts) {
    if (
      !uuid(a.id) ||
      seen.has(a.id) ||
      (last !== null && a.id <= last) ||
      typeof a.name !== "string" ||
      typeof a.status !== "string" ||
      !/^T[A-Z0-9]+$/.test(a.teamId) ||
      !/^C[A-Z0-9]+$/.test(a.channelId)
    )
      throw Error("Stored Slack channel response could not be verified.");
    seen.add(a.id);
    last = a.id;
  }
  if (data.nextCursor !== null && (data.accounts.length !== 20 || data.nextCursor !== last))
    throw Error("Stored Slack channel cursor could not be verified.");
  return data as { accounts: SlackStoredChannel[]; nextCursor: string | null };
}
function validImport(v: any) {
  return (
    v === null ||
    (uuid(v?.id) &&
      date(v.approvedAt) &&
      date(v.start) &&
      date(v.end) &&
      Date.parse(v.start) < Date.parse(v.end) &&
      Number.isInteger(v.pages) &&
      v.pages >= 0 &&
      Number.isInteger(v.pageLimit) &&
      v.pageLimit >= 1 &&
      v.pageLimit <= 10 &&
      v.pages <= v.pageLimit &&
      typeof v.complete === "boolean" &&
      (v.status === null || statuses.includes(v.status)) &&
      (v.availableAt === null || date(v.availableAt)) &&
      (v.errorCode === null || /^slack_history_[a-z_]{1,80}$/.test(v.errorCode)) &&
      (v.stopReason === null ||
        [
          "window_pages_complete",
          "page_budget_exhausted",
          "run_page_limit",
          "authorisation_changed",
        ].includes(v.stopReason)))
  );
}
export async function loadSlackObservedThreads(
  db: SlackThreadClient,
  tenantId: string,
  accountId: string,
  beforeParent: string | null = null,
): Promise<SlackThreadPage> {
  if (!uuid(tenantId) || !uuid(accountId) || (beforeParent !== null && !stamp(beforeParent)))
    throw Error("Invalid company or thread page.");
  const { data, error } = await db.rpc("learn_slack_threads_read", {
    p_tenant_id: tenantId,
    p_account_id: accountId,
    p_before_parent: beforeParent,
  });
  if (
    error ||
    data?.version !== "learn-slack-threads/1" ||
    data.tenantId !== tenantId ||
    data.accountId !== accountId ||
    data.coverage !== "observed_threads_only" ||
    typeof data.canImport !== "boolean" ||
    !/^T[A-Z0-9]+$/.test(data.teamId) ||
    !/^C[A-Z0-9]+$/.test(data.channelId) ||
    (data.connectionRevision !== null && !date(data.connectionRevision)) ||
    (data.canImport && !date(data.connectionRevision)) ||
    !Array.isArray(data.threads) ||
    data.threads.length > 20 ||
    (data.nextCursor !== null && !stamp(data.nextCursor))
  )
    throw Error("Stored threads are unavailable. Reload to try again.");
  let last = beforeParent;
  const sources = new Set<string>();
  for (const t of data.threads) {
    if (
      !uuid(t.sourceId) ||
      sources.has(t.sourceId) ||
      !/^[a-f0-9]{64}$/.test(t.sourceVersion) ||
      !stamp(t.parentTimestamp) ||
      !stamp(t.observedTimestamp) ||
      micros(t.parentTimestamp) > micros(t.observedTimestamp) ||
      (last !== null && micros(t.parentTimestamp) >= micros(last)) ||
      typeof t.excerpt !== "string" ||
      t.excerpt.length > 400 ||
      !validImport(t.latestImport)
    )
      throw Error("Thread evidence response could not be verified.");
    sources.add(t.sourceId);
    last = t.parentTimestamp;
  }
  if (data.nextCursor !== null && (data.threads.length !== 20 || data.nextCursor !== last))
    throw Error("Thread page cursor could not be verified.");
  return data;
}
export type SlackThreadRequest = {
  requestId: string;
  tenantId: string;
  accountId: string;
  sourceId: string;
  sourceVersion: string;
  parentTimestamp: string;
  connectionRevision: string;
  start: string;
  end: string;
  maxPages: number;
  reason: string;
};
export function validateSlackThreadRequest(r: SlackThreadRequest, now = Date.now()) {
  const start = Date.parse(r.start),
    end = Date.parse(r.end);
  if (
    !uuid(r.requestId) ||
    !uuid(r.tenantId) ||
    !uuid(r.accountId) ||
    !uuid(r.sourceId) ||
    !/^[a-f0-9]{64}$/.test(r.sourceVersion) ||
    !stamp(r.parentTimestamp) ||
    !date(r.connectionRevision) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end > now ||
    Number(r.parentTimestamp) * 1000 > end ||
    !Number.isInteger(r.maxPages) ||
    r.maxPages < 1 ||
    r.maxPages > 10 ||
    !r.reason.trim() ||
    r.reason.trim().length > 1000
  )
    throw Error(
      "Choose a fixed past period that includes time after this thread started, a page limit and a reason.",
    );
}
export async function startSlackThreadImport(db: SlackThreadClient, r: SlackThreadRequest) {
  validateSlackThreadRequest(r);
  const { data, error } = await db.rpc("learn_slack_start_thread_import", {
    p_tenant_id: r.tenantId,
    p_request_id: r.requestId,
    p_account_id: r.accountId,
    p_source_message_id: r.sourceId,
    p_source_version: r.sourceVersion,
    p_connection_revision: r.connectionRevision,
    p_start: new Date(r.start).toISOString(),
    p_end: new Date(r.end).toISOString(),
    p_max_pages: r.maxPages,
    p_reason: r.reason.trim(),
  });
  if (error)
    throw new SlackImportError(
      error.code ?? "unknown",
      error.code === "42501"
        ? "Company owner or admin access is required."
        : ["PT409", "40001"].includes(error.code ?? "")
          ? "The source, connection or saved request changed. Reload the thread evidence before preparing another import."
          : error.code === "22023"
            ? "The thread import details were rejected. Review the source and window before approving again."
            : error.code === "55000"
              ? "A thread import is already active or this connection is disabled. Review its status before preparing another request."
              : "Thread approval was not confirmed. Retry the same request to avoid duplicates.",
    );
  if (
    data?.requestId !== r.requestId ||
    data.accountId !== r.accountId ||
    !uuid(data.jobId) ||
    typeof data.reused !== "boolean"
  )
    throw Error("Thread approval response could not be verified. Retry the same request.");
  return data as { requestId: string; accountId: string; jobId: string; reused: boolean };
}
export function slackThreadProgress(i: SlackThreadImport | null) {
  if (!i) return "No thread import recorded";
  if (i.status === "dead_letter" || i.status === "failed") return "Stopped — needs attention";
  if (i.status === "cancelled") return "Cancelled — evidence retained";
  if (i.status === "retrying") return "Waiting to retry";
  if (i.status === "queued") return "Queued";
  if (i.status === "running") return "Importing";
  if (i.status === "succeeded" && i.complete) return "Approved window pages captured";
  if (i.stopReason === "page_budget_exhausted") return "Page limit reached — window incomplete";
  if (i.stopReason === "authorisation_changed")
    return "Connection or approval changed — window incomplete";
  return "Window incomplete — check progress";
}
