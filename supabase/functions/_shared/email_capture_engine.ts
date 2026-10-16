/** One persisted Gmail page per queue attempt. Ports resolve authorized mailbox
 * credentials server-side. Recovery runs before capture admission and never
 * needs a provider token. This engine does not restart blocked traversals.
 */
import {
  bindEmailJobAttempt,
  type EmailJobClaim,
  type EmailJobAttempt,
} from "./email_job_attempt.ts";
import { applyDurableEmailTransition, pendingEmailTransition } from "./email_ingestion_outbox.ts";
import {
  prepareEmailTransition,
  readEmailTransition,
  EmailTransitionUnconfirmed,
  type EmailProtocolClient,
  type EmailCheckpoint,
  type EmailOperation,
  type EmailTransitionResult,
} from "./email_ingestion_protocol.ts";
import {
  readGmailCaptureBoundary,
  readGmailCapturePage,
  persistGmailCapturePage,
  gmailHistoryId,
  GmailCaptureError,
  type GmailPageRequest,
  type GmailPageEvidence,
} from "./gmail_capture_page.ts";
import { createGmailPageStore } from "./gmail_page_store.ts";
import type { CaptureAdmission } from "./learn_capture_control.ts";
export type EmailMailboxSource = {
  tenantId: string;
  accountId: string;
  mailbox: string;
  /** Explicit profile identity proved by the current server-side account binding. */
  profileMailbox?: string;
  historical: { pageToken: string | null; total: number } | null;
  /** Fixed per-account horizon for full inventory, not incremental history. */
  fullImportQuery?: string | null;
};
export interface EmailCapturePorts {
  admission(tenantId: string): Promise<CaptureAdmission>;
  /** Must verify the tenant's current OAuth/Workspace relationship and account. */
  mailbox(attempt: EmailJobAttempt): Promise<EmailMailboxSource>;
  accessToken(attempt: EmailJobAttempt, source: EmailMailboxSource): Promise<string>;
  fetcher?: typeof fetch;
}
export type EmailCaptureOutcome =
  | {
      state: "completed";
      jobId: string;
      attemptId: string;
      successorId: string | null;
      historicalReceipt: boolean;
      recordsProcessed: number;
      coverageComplete: boolean | null;
    }
  | { state: "deferred"; jobId: string; attemptId: string; reason: "paused" | "unavailable" }
  | { state: "failed"; jobId: string; attemptId: string; code: string };
export class EmailQueueCompletionUnconfirmed extends Error {
  constructor() {
    super(
      "Email queue completion could not be confirmed. Recover this job before changing its outcome.",
    );
    this.name = "EmailQueueCompletionUnconfirmed";
  }
}
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: unknown, names: string[]) =>
  object(v) && Object.keys(v).length === names.length && names.every((n) => Object.hasOwn(v, n));
const pageToken = (v: unknown) =>
  v === null || (typeof v === "string" && v.length > 0 && v.length <= 8192);
const zero: GmailPageEvidence = {
  persistence: "confirmed",
  message_upsert_count: 0,
  thread_upsert_count: 0,
  ids_seen: 0,
  gone_count: 0,
  unresolved_count: 0,
};
const badContinuation = (): never => {
  throw new GmailCaptureError("parse_failed");
};
export function recentEmailPage(c: EmailCheckpoint):
  | { uninitialized: true; fetchPolicy: "missing_only" | "refetch_all" }
  | {
      uninitialized: false;
      fetchPolicy: "missing_only" | "refetch_all";
      request: GmailPageRequest;
    } {
  const v: Record<string, any> | null = c.continuation;
  if (
    !object(v) ||
    ![2, 3, 4].includes(v.version) ||
    !["missing_only", "refetch_all"].includes(v.fetch_policy)
  )
    return badContinuation();
  const labels = v.version >= 3 ? ["ALL"] : ["INBOX", "SENT"];
  if (v.phase === "uninitialized") {
    if (
      !keys(v, ["version", "phase", "intent", "fetch_policy"]) ||
      !["normal", "reconcile"].includes(v.intent) ||
      (v.fetch_policy === "refetch_all" && v.intent !== "reconcile" && v.version !== 4)
    )
      return badContinuation();
    return { uninitialized: true, fetchPolicy: v.fetch_policy };
  }
  if (
    !keys(v, [
      "version",
      "phase",
      "mode",
      "origin_history_id",
      "fetch_policy",
      "captured_history_id",
      "captured_at",
      "page_size",
      "query",
      "labels",
      "labels_state",
    ]) ||
    v.phase !== "initialized" ||
    !["history", "reconcile"].includes(v.mode) ||
    !(v.origin_history_id === null || gmailHistoryId(v.origin_history_id)) ||
    !gmailHistoryId(v.captured_history_id) ||
    (v.origin_history_id !== null && BigInt(v.captured_history_id) < BigInt(v.origin_history_id)) ||
    (v.mode === "history" && v.origin_history_id === null) ||
    (v.fetch_policy === "refetch_all" && v.mode !== "reconcile" && v.version !== 4) ||
    typeof v.captured_at !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.captured_at) ||
    !Number.isFinite(Date.parse(v.captured_at)) ||
    new Date(v.captured_at).toISOString() !== v.captured_at ||
    !Number.isInteger(v.page_size) ||
    v.page_size < 1 ||
    v.page_size > 500 ||
    !(v.query === null ||
      (typeof v.query === "string" && /^after:[1-9][0-9]{9}$/.test(v.query))) ||
    (v.mode === "history" && v.query !== null) ||
    !Array.isArray(v.labels) ||
    v.labels.length !== labels.length ||
    !labels.every((label, index) => v.labels[index] === label) ||
    !keys(v.labels_state, labels)
  )
    return badContinuation();
  for (const label of labels) {
    const s = v.labels_state[label];
    if (
      !keys(s, ["next_page_token", "complete"]) ||
      typeof s.complete !== "boolean" ||
      !pageToken(s.next_page_token) ||
      (s.complete && s.next_page_token !== null)
    )
      return badContinuation();
  }
  const label = v.version >= 3 ? "ALL" : v.labels_state.INBOX.complete ? "SENT" : "INBOX";
  if (v.labels_state[label].complete) return badContinuation();
  return {
    uninitialized: false,
    fetchPolicy: v.fetch_policy,
    request: {
      mode: v.mode,
      ...(v.version === 4 ? { trackChanges: true } : {}),
      label,
      pageSize: v.page_size,
      pageToken: v.labels_state[label].next_page_token,
      originHistoryId: v.mode === "history" ? v.origin_history_id : null,
      query: v.mode === "reconcile" ? v.query : null,
    },
  };
}
function checkSource(s: EmailMailboxSource, a: EmailJobAttempt) {
  if (
    !s ||
    s.tenantId !== a.tenantId ||
    s.accountId !== a.accountId ||
    typeof s.mailbox !== "string" ||
    !s.mailbox.trim() ||
    !(s.fullImportQuery === undefined || s.fullImportQuery === null ||
      (typeof s.fullImportQuery === "string" &&
        /^after:[1-9][0-9]{9}$/.test(s.fullImportQuery))) ||
    (s.profileMailbox !== undefined &&
      (typeof s.profileMailbox !== "string" || !/^[^\s@]+@[^\s@]+$/.test(s.profileMailbox))) ||
    (a.stream === "historical" &&
      (!s.historical ||
        !pageToken(s.historical.pageToken) ||
        !Number.isInteger(s.historical.total) ||
        s.historical.total < 0 ||
        s.historical.total > 2147483647))
  )
    throw new GmailCaptureError("source_ineligible");
}
/** A failed completion acknowledgement must not fall back to generic failJob.
 * The atomic completion may already have committed, including its successor.
 */
export async function completeEmailCaptureJob(
  db: EmailProtocolClient,
  claim: EmailJobClaim,
  attempt: EmailJobAttempt,
  summary: {
    historicalReceipt: boolean;
    coverageComplete: boolean | null;
    records: number;
    threads: number | null;
  },
): Promise<EmailCaptureOutcome> {
  if (
    attempt.jobId !== claim.jobId ||
    attempt.tenantId !== claim.tenantId ||
    !Number.isInteger(summary.records) ||
    summary.records < 0 ||
    summary.records > 2147483647 ||
    !(summary.threads === null || (Number.isInteger(summary.threads) && summary.threads >= 0)) ||
    (!summary.historicalReceipt && typeof summary.coverageComplete !== "boolean")
  )
    throw new EmailQueueCompletionUnconfirmed();
  const type =
    attempt.syncType === "messages"
      ? "email.gmail_sync"
      : attempt.stream === "historical"
        ? "email.workspace_backfill"
        : "email.workspace_sync";
  const more = !summary.historicalReceipt && summary.coverageComplete === false;
  const processed = summary.historicalReceipt ? 0 : summary.records;
  const payload = {
    email_account_id: attempt.payload.email_account_id,
    ...("max_results" in attempt.payload ? { max_results: attempt.payload.max_results } : {}),
  };
  const document = {
    result: {
      sync_run_id: attempt.attemptId,
      ingestion: {
        success: true,
        stream: attempt.stream,
        email_account_id: attempt.accountId,
        sync_run_id: attempt.attemptId,
        records_processed: summary.records,
        invocation_records_processed: processed,
        threads_processed: summary.historicalReceipt ? null : summary.threads,
        historical_receipt: summary.historicalReceipt,
        coverage_complete: summary.coverageComplete,
        retry_action: more ? "continue" : "none",
        persistence_certainty: "confirmed",
        checkpoint_certainty: "confirmed",
      },
    },
    records_processed: processed,
    continuation: more
      ? {
          job_type: type,
          job_key: type + ":" + attempt.payload.email_account_id,
          connector_id: type === "email.gmail_sync" ? "gmail" : "google-workspace",
          module_id: "communications.email",
          priority: attempt.stream === "historical" ? 200 : 100,
          payload,
        }
      : null,
  };
  try {
    const { data, error } = await db.rpc("platform_jobs_complete_email_v1", {
      p_job_id: claim.jobId,
      p_tenant_id: claim.tenantId,
      p_claimed_by: claim.claimedBy,
      p_attempt_count: claim.attemptCount,
      p_document: document,
    });
    const d = data as Record<string, any>;
    if (
      error ||
      !d ||
      d.version !== 1 ||
      !["applied", "replayed"].includes(d.disposition) ||
      d.job_id !== claim.jobId ||
      !(
        d.successor_id === null ||
        (typeof d.successor_id === "string" &&
          /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(d.successor_id))
      ) ||
      more !== (d.successor_id !== null)
    )
      throw Error();
    return {
      state: "completed",
      jobId: claim.jobId,
      attemptId: attempt.attemptId,
      successorId: d.successor_id,
      historicalReceipt: summary.historicalReceipt,
      recordsProcessed: processed,
      coverageComplete: summary.coverageComplete,
    };
  } catch {
    throw new EmailQueueCompletionUnconfirmed();
  }
}
export async function runEmailCaptureJob(
  db: EmailProtocolClient,
  inputClaim: EmailJobClaim,
  ports: EmailCapturePorts,
): Promise<EmailCaptureOutcome> {
  const claim = { ...inputClaim };
  let attempt = await bindEmailJobAttempt(db, claim),
    current: EmailCheckpoint | null = null;
  let evidence: GmailPageEvidence | undefined;
  async function latest() {
    const r = await readEmailTransition(db, attempt, crypto.randomUUID());
    if (r.code !== "not_found") throw new EmailTransitionUnconfirmed();
    return r.checkpoint;
  }
  async function transition(operation: EmailOperation, payload: Record<string, unknown>) {
    return applyDurableEmailTransition(
      db,
      prepareEmailTransition(attempt, current, crypto.randomUUID(), operation, payload),
      claim,
    );
  }
  async function failed(error: GmailCaptureError): Promise<EmailCaptureOutcome> {
    current = await latest();
    const owns = current?.owner_attempt_id === attempt.attemptId;
    const classification = (
      {
        history_expired: "provider_expired",
        continuation_expired: "checkpoint_conflict",
        pagination_no_progress: "pagination_cycle",
        checkpoint_conflict: "checkpoint_conflict",
        fetch_failed: "fetch_failure",
        parse_failed: "parse_failure",
        persistence_failed: "persistence_failure",
        source_ineligible: "source_ineligible",
        sa_config_missing: "source_ineligible",
        sa_credentials_invalid: "source_ineligible",
        admin_delegation_missing: "source_ineligible",
        scopes_missing: "source_ineligible",
        delegation_grant_invalid: "source_ineligible",
        delegation_denied: "source_ineligible",
      } as const
    )[error.code];
    const uncertain = error.persistenceUnknown;
    const known = evidence ?? zero;
    const attemptEvidence = {
      persistence: uncertain ? "unknown" : "confirmed",
      message_upsert_count: uncertain
        ? null
        : attempt.recordsProcessed + known.message_upsert_count,
      thread_upsert_count: uncertain ? null : known.thread_upsert_count,
      ids_seen: uncertain ? null : known.ids_seen,
      gone_count: uncertain ? null : known.gone_count,
      unresolved_count: uncertain ? null : 1,
      classification,
      coverage_complete: false,
    };
    const r = await transition(owns ? "block" : "finish_attempt", {
      error_code: error.code,
      attempt_evidence: attemptEvidence,
      ...(owns ? {} : { outcome: current?.owner_attempt_id ? "superseded" : "failed" }),
    });
    if (!r.accepted || r.accepted.attempt_status !== "failed")
      throw new EmailTransitionUnconfirmed();
    return { state: "failed", jobId: claim.jobId, attemptId: attempt.attemptId, code: error.code };
  }
  // A pending request already contains the exact evidence to settle. Never fetch
  // its page again merely because the original worker did not see the response.
  const pending = await pendingEmailTransition(db, attempt);
  if (pending) {
    const r = await applyDurableEmailTransition(db, pending, claim);
    if (!r.accepted) {
      if (pending.operation === "checkpoint")
        evidence = pending.payload.page_evidence as GmailPageEvidence;
      return failed(
        new GmailCaptureError(
          r.code === "pagination_no_progress" ? "pagination_no_progress" : "checkpoint_conflict",
        ),
      );
    }
    attempt = await bindEmailJobAttempt(db, claim);
  }
  if (attempt.status === "success")
    return completeEmailCaptureJob(db, claim, attempt, {
      historicalReceipt: true,
      coverageComplete: null,
      records: attempt.recordsProcessed,
      threads: null,
    });
  if (attempt.status === "failed")
    return {
      state: "failed",
      jobId: claim.jobId,
      attemptId: attempt.attemptId,
      code: "capture_failed",
    };
  const admission = await ports.admission(attempt.tenantId);
  if (admission.allowed === false)
    return {
      state: "deferred",
      jobId: claim.jobId,
      attemptId: attempt.attemptId,
      reason: admission.reason,
    };
  current = await latest();
  if (attempt.payload.restart === true || attempt.recordsProcessed !== 0)
    return failed(new GmailCaptureError("source_ineligible"));
  if (current?.owner_attempt_id !== attempt.attemptId) {
    const r = await transition("claim", {
      recovery: null,
      ...(attempt.stream === "recent" && attempt.payload.force === true ? { force: true } : {}),
    });
    if (!r.accepted) return failed(new GmailCaptureError("source_ineligible"));
    current = r.checkpoint;
    if (r.accepted.attempt_status === "success")
      return completeEmailCaptureJob(db, claim, attempt, {
        historicalReceipt: false,
        coverageComplete: r.accepted.coverage_complete,
        records: r.accepted.records_processed,
        threads: 0,
      });
    if (r.accepted.attempt_status === "failed")
      return {
        state: "failed",
        jobId: claim.jobId,
        attemptId: attempt.attemptId,
        code: "capture_failed",
      };
  }
  if (!current || current.state !== "claimed" || current.owner_attempt_id !== attempt.attemptId)
    throw new EmailTransitionUnconfirmed();
  try {
    // Validate saved recent continuation before resolving credentials or making
    // any provider request. Historical progress is read from the guarded account.
    let recent = attempt.stream === "recent" ? recentEmailPage(current) : null;
    const source = await ports.mailbox(attempt);
    checkSource(source, attempt);
    if (recent && !recent.uninitialized && "request" in recent &&
      recent.request.mode === "reconcile" &&
      (recent.request.query ?? null) !== (source.fullImportQuery ?? null))
      throw new GmailCaptureError("continuation_expired");
    const accessToken = await ports.accessToken(attempt, source);
    const boundary = await readGmailCaptureBoundary(
      accessToken,
      source.profileMailbox ?? source.mailbox,
      ports.fetcher,
    );
    if (recent?.uninitialized) {
      const r = await transition("initialize_traversal", {
        captured_history_id: boundary,
        captured_at: new Date().toISOString(),
        page_size: attempt.payload.max_results ?? 25,
        query: source.fullImportQuery ?? null,
      });
      if (!r.accepted || !r.currentMatchesReceipt || !r.checkpoint)
        throw new GmailCaptureError("parse_failed");
      current = r.checkpoint;
      recent = recentEmailPage(current);
    }
    if (recent?.uninitialized) throw new GmailCaptureError("parse_failed");
    const request: GmailPageRequest =
      recent && "request" in recent
        ? recent.request
        : {
            mode: "historical",
            label: null,
            pageSize: attempt.payload.max_results ?? 25,
            pageToken: source.historical!.pageToken,
            originHistoryId: null,
            query: source.fullImportQuery ?? null,
          };
    const page = await readGmailCapturePage(accessToken, request, ports.fetcher);
    const fetchPolicy = recent?.fetchPolicy ?? "missing_only";
    evidence = await persistGmailCapturePage({
      accessToken,
      tenantId: attempt.tenantId,
      mailbox: source.mailbox,
      page,
      fetchPolicy,
      fetcher: ports.fetcher,
      store: createGmailPageStore(db, attempt, current, source.mailbox, fetchPolicy, claim),
    });
    const r = await transition("checkpoint", {
      returned_next_page_token: page.nextPageToken,
      exhausted: page.exhausted,
      page_evidence: evidence,
      yield_after_page: true,
      ...(attempt.stream === "recent"
        ? { label: request.label, expected_input_page_token: request.pageToken }
        : {
            expected_page_token: request.pageToken,
            expected_total: source.historical!.total,
            listed_count: page.ids.length,
          }),
    });
    if (!r.accepted)
      return failed(
        new GmailCaptureError(
          r.code === "pagination_no_progress" ? "pagination_no_progress" : "checkpoint_conflict",
        ),
      );
    if (r.accepted.attempt_status !== "success" || !r.currentMatchesReceipt)
      throw new EmailTransitionUnconfirmed();
    return completeEmailCaptureJob(db, claim, attempt, {
      historicalReceipt: false,
      coverageComplete: r.accepted.coverage_complete,
      records: r.accepted.records_processed,
      threads: evidence.thread_upsert_count,
    });
  } catch (e) {
    if (e instanceof EmailTransitionUnconfirmed || e instanceof EmailQueueCompletionUnconfirmed)
      throw e;
    return failed(e instanceof GmailCaptureError ? e : new GmailCaptureError("fetch_failed"));
  }
}
