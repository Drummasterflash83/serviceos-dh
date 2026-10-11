/** Queue ownership, publication and settlement are decided by SQL. This adapter
 * never falls back to the generic queue writer or trusts a caller's payload. */
import type { EmailCaptureDb } from "../email_capture_ports.ts";
// Structural boundary avoids loading a remote SDK merely for worker types.
type QueueContext = {
  supabaseAdmin: EmailCaptureDb;
  tenantId: string;
  jobId: string | null;
  jobType?: string;
  payload?: unknown;
  claim?: { claimedBy: string; attemptCount: number };
};
import {
  validWorkspaceVoicemailRequest,
  type WorkspaceVoicemailRequest,
} from "./workspace-import.ts";
export type VoicemailQueueOutcome = {
  state: "succeeded" | "waiting" | "retrying" | "dead_letter" | "unconfirmed";
  historicalReceipt: boolean;
  recordsProcessed: number;
  code?: string;
};
type Db = EmailCaptureDb;
type Import = (db: Db, request: WorkspaceVoicemailRequest) => Promise<unknown>;
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
export async function runVoicemailQueueJob(
  ctx: QueueContext,
  run: Import,
): Promise<VoicemailQueueOutcome> {
  const unknown = (): VoicemailQueueOutcome => ({
    state: "unconfirmed",
    historicalReceipt: false,
    recordsProcessed: 0,
  });
  if (
    ctx.jobType !== "phone.voicemail_import" ||
    !uuid(ctx.jobId) ||
    !uuid(ctx.tenantId) ||
    !ctx.claim?.claimedBy ||
    ctx.claim.claimedBy.length > 200 ||
    !Number.isSafeInteger(ctx.claim.attemptCount) ||
    ctx.claim.attemptCount < 1
  )
    return unknown();
  const scope = {
    p_tenant: ctx.tenantId,
    p_job: ctx.jobId,
    p_worker: ctx.claim.claimedBy,
    p_attempt: ctx.claim.attemptCount,
  };
  const db = ctx.supabaseAdmin;
  const step = async (operation: string, args: Record<string, unknown> = {}) => {
    const response = await db.rpc("voicemail_queue_step", {
      ...scope,
      p_operation: operation,
      p_args: args,
    });
    const data =
      response.data && typeof response.data === "object" && !Array.isArray(response.data)
        ? (response.data as Record<string, any>)
        : null;
    // Validate the operation-specific shape below; never cast an RPC result to a receipt.
    return { data, error: response.error };
  };
  function receipt(r: any, historical: boolean): VoicemailQueueOutcome | null {
    if (
      !r ||
      r.version !== "voicemail-queue/1" ||
      r.tenant_id !== ctx.tenantId ||
      r.job_id !== ctx.jobId ||
      r.worker !== ctx.claim!.claimedBy ||
      r.attempt !== ctx.claim!.attemptCount ||
      !["succeeded", "waiting", "retrying", "dead_letter"].includes(r.state) ||
      r.coverage_complete !== false ||
      r.records_processed !== (r.state === "succeeded" ? 1 : 0) ||
      (r.state === "succeeded"
        ? !uuid(r.message_id) || r.code !== null
        : r.message_id !== null ||
          typeof r.code !== "string" ||
          !/^(voicemail|notification)_[a-z_]{1,70}$/.test(r.code)) ||
      typeof r.settled_at !== "string" ||
      !Number.isFinite(Date.parse(r.settled_at))
    )
      return null;
    return {
      state: r.state,
      historicalReceipt: historical,
      recordsProcessed: r.records_processed,
      ...(r.code ? { code: r.code } : {}),
    };
  }
  async function inspect(): Promise<VoicemailQueueOutcome> {
    try {
      const r = await step("inspect");
      if (!r.error) return receipt(r.data, true) ?? unknown();
    } catch {}
    return unknown();
  }
  let input: WorkspaceVoicemailRequest;
  try {
    const bound = await step("bind");
    if (bound.error) return inspect();
    if (bound.data?.state === "settled") return receipt(bound.data.receipt, true) ?? unknown();
    if (
      bound.data?.state !== "bound" ||
      !validWorkspaceVoicemailRequest(bound.data.request) ||
      bound.data.request.tenantId !== ctx.tenantId
    )
      return unknown();
    input = bound.data.request;
  } catch {
    return inspect();
  }
  let publication: VoicemailQueueOutcome | null = null;
  const operations: Record<string, string> = {
    voicemail_intake_route: "route",
    voicemail_intake_prepare: "prepare",
    voicemail_intake_publish: "publish",
  };
  const guarded = new Proxy(db, {
    get(target, key) {
      if (key === "rpc")
        return async (name: string, args: Record<string, unknown>) => {
          if (!Object.hasOwn(operations, name)) return target.rpc(name, args);
          const r = await step(operations[name], args);
          if (name !== "voicemail_intake_publish" || r.error) return r;
          publication = receipt(r.data, false);
          if (publication?.state !== "succeeded") throw Error("voicemail_publish_unconfirmed");
          return { data: { state: "published", message_id: r.data!.message_id }, error: null };
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    await run(guarded, input);
    // A handler returning successfully is not proof of database publication.
    return publication ?? (await inspect());
  } catch (e) {
    if (publication) return publication;
    const code =
      e instanceof Error && /^(voicemail|notification)_[a-z_]{1,70}$/.test(e.message)
        ? e.message
        : "voicemail_import_unconfirmed";
    try {
      // SQL first looks for a saved success receipt while holding the job lock.
      // A lost publication response therefore cannot be relabelled as a failure.
      const failed = await step("fail", { code });
      if (!failed.error) {
        const confirmed = receipt(failed.data, failed.data?.state === "succeeded");
        if (confirmed) return confirmed;
      }
    } catch {}
    return inspect();
  }
}
