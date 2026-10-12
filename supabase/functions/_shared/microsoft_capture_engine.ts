/** One journaled source page per queue job. Local worker registration uses the
 * credential and owned settlement paths; hosted/real-mailbox acceptance is separate. */
import { object, uuid, id, MicrosoftMailError } from "./microsoft_graph_transport.ts";
import { MicrosoftCredentialError } from "./microsoft_oauth.ts";
import {
  beginMicrosoftFolderDiscovery,
  stepMicrosoftFolderDiscovery,
  validateMicrosoftFolderDiscovery,
  type MicrosoftFolderDiscovery,
  type MicrosoftMailboxScope,
} from "./microsoft_mail_folders.ts";
import {
  readMicrosoftMailPage,
  microsoftMailRequestUrl,
  validateMicrosoftMailContinuation,
  type MicrosoftMailRequest,
} from "./microsoft_mail_page.ts";
export type MicrosoftJournalDb = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
export type MicrosoftCaptureClaim = {
  tenantId: string;
  jobId: string;
  claimedBy: string;
  attemptCount: number;
};
export type MicrosoftCaptureContext = MicrosoftMailboxScope & {
  bindingId: string;
  kind: "folders" | "messages";
  folderId: string;
};
export type MicrosoftMessageCheckpoint = {
  contract: "microsoft-message-checkpoint/1";
  scope: MicrosoftMailboxScope & { folderId: string };
  pageSize: number;
  continuation: MicrosoftMailRequest["continuation"];
  /** Requests in the active delta round. Older initial checkpoints may omit it. */
  visitedRequests?: string[];
};
type Checkpoint = MicrosoftFolderDiscovery | MicrosoftMessageCheckpoint;
export type MicrosoftJournalReceipt = {
  contract: "microsoft-journal-receipt/1";
  tenantId: string;
  streamId: string;
  requestId: string;
  revision: string;
  recordedAt: string;
};
export type MicrosoftCaptureResult =
  | {
      state: "source_page_stored";
      jobId: string;
      receipt: MicrosoftJournalReceipt;
      recovered: boolean;
      observationsStored: number;
      needsContinuation: boolean;
      /** Neither journal storage nor delta completion establishes mailbox-wide coverage. */
      mailboxCoverage: "unverified";
    }
  | { state: "discovery_exhausted"; jobId: string; mailboxCoverage: "unverified" };
export interface MicrosoftCapturePorts {
  /** Revalidate current credential/binding/account authority server-side immediately
   * before acquiring the token. Never use a browser-supplied access token. */
  accessToken(context: MicrosoftCaptureContext, claim: MicrosoftCaptureClaim): Promise<string>;
  fetcher?: typeof fetch;
  requestId?: () => string;
  now?: () => number;
}
export class MicrosoftJournalError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`Microsoft journal: ${code}`);
    this.name = "MicrosoftJournalError";
    this.code = code;
  }
}
function bad(code: string): never {
  throw new MicrosoftJournalError(code);
}
const revision = (v: unknown): v is string =>
  typeof v === "string" && /^(0|[1-9][0-9]{0,15})$/.test(v) && BigInt(v) <= 9007199254740991n;
const sameScope = (v: unknown, c: MicrosoftCaptureContext, folder: boolean) =>
  object(v) &&
  Object.keys(v).length === (folder ? 4 : 3) &&
  v.tenantId === c.tenantId &&
  v.accountId === c.accountId &&
  v.mailboxId === c.mailboxId &&
  (!folder || v.folderId === c.folderId);
function validateCheckpoint(raw: unknown, c: MicrosoftCaptureContext): asserts raw is Checkpoint {
  if (!object(raw) || !sameScope(raw.scope, c, c.kind === "messages")) bad("invalid_checkpoint");
  try {
    if (c.kind === "folders") {
      validateMicrosoftFolderDiscovery(c, raw as MicrosoftFolderDiscovery);
      return;
    }
    if (raw.contract !== "microsoft-message-checkpoint/1") bad("invalid_checkpoint");
    microsoftMailRequestUrl({
      ...raw.scope,
      pageSize: raw.pageSize,
      continuation: raw.continuation,
    });
    if (raw.visitedRequests !== undefined) {
      if (
        !Array.isArray(raw.visitedRequests) ||
        raw.visitedRequests.length > 10000 ||
        new Set(raw.visitedRequests).size !== raw.visitedRequests.length
      )
        bad("invalid_checkpoint");
      for (const url of raw.visitedRequests) {
        // The first request may be the initial selected-field URL; later ones
        // must remain valid next/delta requests for this exact mailbox/folder.
        const initial = microsoftMailRequestUrl({
          ...raw.scope,
          pageSize: raw.pageSize,
          continuation: null,
        });
        if (url === initial) continue;
        let allowed = false;
        for (const kind of ["next", "delta"] as const) {
          try {
            validateMicrosoftMailContinuation(raw.scope, { kind, url });
            allowed = true;
            break;
          } catch {}
        }
        if (!allowed) bad("invalid_checkpoint");
      }
      if (raw.continuation?.kind === "delta" && raw.visitedRequests.length)
        bad("invalid_checkpoint");
    }
  } catch {
    bad("invalid_checkpoint");
  }
}
function initialCheckpoint(c: MicrosoftCaptureContext): Checkpoint {
  const scope = { tenantId: c.tenantId, accountId: c.accountId, mailboxId: c.mailboxId };
  return c.kind === "folders"
    ? beginMicrosoftFolderDiscovery(scope, 25)
    : {
        contract: "microsoft-message-checkpoint/1",
        scope: { ...scope, folderId: c.folderId },
        pageSize: 25,
        continuation: null,
        visitedRequests: [],
      };
}
function receipt(raw: unknown, tenantId: string): MicrosoftJournalReceipt {
  if (
    !object(raw) ||
    raw.contract !== "microsoft-journal-receipt/1" ||
    raw.tenantId !== tenantId ||
    !uuid(raw.streamId) ||
    !uuid(raw.requestId) ||
    !revision(raw.revision) ||
    raw.revision === "0" ||
    typeof raw.recordedAt !== "string" ||
    !Number.isFinite(Date.parse(raw.recordedAt))
  )
    bad("invalid_receipt");
  return {
    contract: raw.contract,
    tenantId,
    streamId: raw.streamId,
    requestId: raw.requestId,
    revision: raw.revision,
    recordedAt: raw.recordedAt,
  };
}
function needsContinuation(checkpoint: Checkpoint): boolean {
  return checkpoint.contract === "microsoft-folder-discovery/1"
    ? checkpoint.pending.length > 0
    : checkpoint.continuation?.kind === "next";
}
/** Does not settle the queue or claim imported-message counts. Only confirmed
 * source observations are reported, including removals and duplicate provider events. */
export async function runMicrosoftCapturePage(
  db: MicrosoftJournalDb,
  input: MicrosoftCaptureClaim,
  ports: MicrosoftCapturePorts,
): Promise<MicrosoftCaptureResult> {
  if (
    !input ||
    ![input.tenantId, input.jobId].every(uuid) ||
    typeof input.claimedBy !== "string" ||
    !input.claimedBy ||
    input.claimedBy.length > 256 ||
    !Number.isSafeInteger(input.attemptCount) ||
    input.attemptCount < 1
  )
    bad("invalid_job");
  const claim = structuredClone(input);
  const args = {
    p_tenant: claim.tenantId,
    p_job: claim.jobId,
    p_worker: claim.claimedBy,
    p_claim: claim.attemptCount,
  };
  async function rpc(name: string, extra: Record<string, unknown>, code: string): Promise<any> {
    try {
      const response = await db.rpc(name, { ...args, ...extra });
      if (response.error) bad(code);
      return response.data;
    } catch {
      return bad(code);
    }
  }
  const job = await rpc("learn_microsoft_journal_job", {}, "job_unconfirmed");
  if (
    !object(job) ||
    job.contract !== "microsoft-journal-job/1" ||
    job.tenantId !== claim.tenantId ||
    job.jobId !== claim.jobId ||
    !["email.microsoft_discovery", "email.microsoft_sync"].includes(job.jobType) ||
    !object(job.payload) ||
    Object.keys(job.payload).length !== 5
  )
    bad("invalid_job");
  const p = job.payload;
  if (
    ![p.email_account_id, p.mailbox_id, p.binding_id].every(uuid) ||
    p.kind !== (job.jobType === "email.microsoft_discovery" ? "folders" : "messages") ||
    (p.kind === "folders" ? p.folder_id !== "" : !id(p.folder_id))
  )
    bad("invalid_job");
  const context: MicrosoftCaptureContext = {
    tenantId: claim.tenantId,
    accountId: p.email_account_id,
    mailboxId: p.mailbox_id,
    bindingId: p.binding_id,
    kind: p.kind,
    folderId: p.folder_id,
  };
  if (job.receipt !== null) {
    const saved = receipt(job.receipt, claim.tenantId);
    validateCheckpoint(job.receipt.checkpoint, context);
    if (
      !Number.isSafeInteger(job.receipt.observationsStored) ||
      job.receipt.observationsStored < 0 ||
      job.receipt.observationsStored > 1000
    )
      bad("invalid_receipt");
    return {
      state: "source_page_stored",
      jobId: claim.jobId,
      receipt: saved,
      recovered: true,
      observationsStored: job.receipt.observationsStored,
      needsContinuation: needsContinuation(job.receipt.checkpoint),
      mailboxCoverage: "unverified",
    };
  }
  const stream = await rpc(
    "learn_microsoft_journal_open",
    {
      p_account: context.accountId,
      p_mailbox: context.mailboxId,
      p_binding: context.bindingId,
      p_kind: context.kind,
      p_folder: context.folderId,
      p_initial: initialCheckpoint(context),
    },
    "stream_unconfirmed",
  );
  if (
    !object(stream) ||
    stream.contract !== "microsoft-journal-stream/1" ||
    stream.tenantId !== claim.tenantId ||
    !uuid(stream.streamId) ||
    !revision(stream.revision)
  )
    bad("invalid_checkpoint");
  validateCheckpoint(stream.checkpoint, context);
  const before: Checkpoint = structuredClone(stream.checkpoint),
    streamId = stream.streamId,
    beforeRevision = stream.revision;
  if (before.contract === "microsoft-folder-discovery/1" && before.pending.length === 0)
    return { state: "discovery_exhausted", jobId: claim.jobId, mailboxCoverage: "unverified" };
  if (beforeRevision === "9007199254740991") bad("revision_limit");
  let token: string;
  try {
    token = await ports.accessToken(structuredClone(context), structuredClone(claim));
  } catch (error) {
    if (error instanceof MicrosoftCredentialError) throw error;
    return bad("authorization_unconfirmed");
  }
  let page: unknown, after: Checkpoint, count: number;
  if (before.contract === "microsoft-folder-discovery/1") {
    const step = await stepMicrosoftFolderDiscovery(
      token,
      context,
      before,
      ports.fetcher,
      ports.now,
    );
    if (!step.page) bad("invalid_checkpoint");
    page = step.page;
    after = step.checkpoint;
    count = step.page.folders.length;
  } else {
    const request = {
      ...before.scope,
      pageSize: before.pageSize,
      continuation: before.continuation,
    };
    const url = microsoftMailRequestUrl(request),
      visited = before.visitedRequests ?? [];
    if (visited.length >= 10000) bad("round_limit");
    if (visited.includes(url)) throw new MicrosoftMailError("pagination_no_progress");
    const read = await readMicrosoftMailPage(token, request, ports.fetcher, ports.now);
    if (read.continuation.kind === "next" && visited.includes(read.continuation.url))
      throw new MicrosoftMailError("pagination_no_progress");
    page = read;
    count = read.events.length;
    after = {
      ...before,
      continuation: read.continuation,
      visitedRequests: read.folderRoundComplete ? [] : [...visited, url],
    };
  }
  validateCheckpoint(after, context);
  let requestId: string;
  try {
    requestId = (ports.requestId ?? (() => crypto.randomUUID()))();
  } catch {
    return bad("invalid_request_id");
  }
  if (!uuid(requestId)) bad("invalid_request_id");
  const answer = await rpc(
    "learn_microsoft_journal_commit",
    {
      p_stream: streamId,
      p_request: requestId,
      p_revision: beforeRevision,
      p_before: before,
      p_page: page,
      p_after: after,
    },
    "commit_unconfirmed",
  );
  let saved: MicrosoftJournalReceipt;
  try {
    saved = receipt(answer, claim.tenantId);
  } catch {
    return bad("commit_unconfirmed");
  }
  if (
    saved.streamId !== streamId ||
    saved.requestId !== requestId ||
    BigInt(saved.revision) !== BigInt(beforeRevision) + 1n
  )
    bad("commit_unconfirmed");
  return {
    state: "source_page_stored",
    jobId: claim.jobId,
    receipt: saved,
    recovered: false,
    observationsStored: count,
    needsContinuation: needsContinuation(after),
    mailboxCoverage: "unverified",
  };
}
