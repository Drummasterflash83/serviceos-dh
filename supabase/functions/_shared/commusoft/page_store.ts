import type { CommusoftWorkerScope } from "./stored_scope.ts";
import type { readApprovedCommusoftPage } from "./bound_page.ts";

type RpcContext = CommusoftWorkerScope & {
  supabaseAdmin: CommusoftWorkerScope["supabaseAdmin"] & {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: unknown }>;
  };
};
export interface CommusoftPageReceipt {
  pageId: string;
  checkpoint: { approvalId: string; after: number | null; pages: number; complete: boolean };
  records: number;
  already: boolean;
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const obj = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function claimArgs(ctx: RpcContext) {
  if (
    !uuid(ctx.tenantId) ||
    !uuid(ctx.jobId) ||
    !ctx.claim?.claimedBy ||
    !Number.isSafeInteger(ctx.claim.attemptCount) ||
    ctx.claim.attemptCount < 1 ||
    ctx.signal?.aborted
  )
    throw Error("commusoft_publication_authority_unavailable");
  return {
    p_tenant_id: ctx.tenantId,
    p_job_id: ctx.jobId,
    p_claimed_by: ctx.claim.claimedBy,
    p_attempt_count: ctx.claim.attemptCount,
  };
}
function receipt(value: unknown): CommusoftPageReceipt {
  if (
    !obj(value) ||
    !uuid(value.pageId) ||
    typeof value.already !== "boolean" ||
    !Number.isInteger(value.records) ||
    value.records < 0 ||
    value.records > 100 ||
    !obj(value.checkpoint) ||
    !uuid(value.checkpoint.approvalId) ||
    !Number.isSafeInteger(value.checkpoint.pages) ||
    value.checkpoint.pages < 1 ||
    value.checkpoint.pages > 10000 ||
    typeof value.checkpoint.complete !== "boolean" ||
    (value.checkpoint.complete && value.checkpoint.after !== null) ||
    (!value.checkpoint.complete &&
      (!Number.isSafeInteger(value.checkpoint.after) || value.checkpoint.after < 1))
  ) {
    throw Error("commusoft_publication_receipt_invalid");
  }
  // Construct rather than forwarding any unexpected server fields to the worker.
  return {
    pageId: value.pageId,
    checkpoint: {
      approvalId: value.checkpoint.approvalId,
      after: value.checkpoint.after,
      pages: value.checkpoint.pages,
      complete: value.checkpoint.complete,
    },
    records: value.records,
    already: value.already,
  };
}

/** One atomic RPC, no automatic write retries. The server rechecks authority and
 * the retained permit, saves the raw page/versions, advances the cursor and leaves
 * a job receipt in the same transaction. A failed acknowledgement is uncertain;
 * the worker must check committedPage before any subsequent provider request.
 */
export async function persistCommusoftPage(
  ctx: RpcContext,
  input: Awaited<ReturnType<typeof readApprovedCommusoftPage>>,
): Promise<CommusoftPageReceipt> {
  const args = claimArgs(ctx);
  if (
    input.scope.tenantId !== args.p_tenant_id ||
    input.scope.jobId !== args.p_job_id ||
    !uuid(input.permitId)
  ) {
    throw Error("commusoft_publication_authority_unavailable");
  }
  const expected = {
    approvalId: input.scope.approval.approvalId,
    pages: input.scope.pages + 1,
    after: input.page.nextCursor,
    complete: input.page.collectionExhausted,
    records: input.page.records.length,
  };
  let result;
  try {
    result = await ctx.supabaseAdmin.rpc("learn_commusoft_commit_page", {
      ...args,
      p_permit_id: input.permitId,
      p_envelope: structuredClone(input.page.rawEnvelope),
    });
  } catch {
    throw Error("commusoft_publication_unavailable");
  }
  if (result.error) throw Error("commusoft_publication_unavailable");
  const saved = receipt(result.data);
  if (
    saved.checkpoint.approvalId !== expected.approvalId ||
    saved.checkpoint.pages !== expected.pages ||
    saved.checkpoint.after !== expected.after ||
    saved.checkpoint.complete !== expected.complete ||
    saved.records !== expected.records
  ) {
    throw Error("commusoft_publication_receipt_invalid");
  }
  return saved;
}

/** Source-free recovery; checked even if a module was disabled after commit. */
export async function committedCommusoftPage(
  ctx: RpcContext,
): Promise<CommusoftPageReceipt | null> {
  const args = claimArgs(ctx);
  let result;
  try {
    result = await ctx.supabaseAdmin.rpc("learn_commusoft_committed_page", args);
  } catch {
    throw Error("commusoft_publication_unavailable");
  }
  if (result.error) throw Error("commusoft_publication_unavailable");
  if (result.data === null) return null;
  const saved = receipt(result.data);
  if (!saved.already) throw Error("commusoft_publication_receipt_invalid");
  return saved;
}
