import type { CommusoftPagePermitPorts } from "./bound_page.ts";
import type { CommusoftWorkerScope } from "./stored_scope.ts";
import { checkAuthorityTransport, CommusoftReadError } from "./read_page.ts";

interface RpcClient {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown; status?: number }>;
}
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Server-only bridge. Never uses a generic secret lookup, browser-supplied key or
 * alternate credential when the atomic acquisition is missing/denied. No runtime
 * registration: source persistence and settlement must exist before enabling it.
 */
export function createCommusoftPermitPorts(
  supplied: CommusoftWorkerScope & {
    supabaseAdmin: CommusoftWorkerScope["supabaseAdmin"] & RpcClient;
  },
  fetcher: typeof fetch = fetch,
  clock: () => number = Date.now,
): CommusoftPagePermitPorts {
  const tenantId = supplied.tenantId,
    jobId = supplied.jobId;
  const claim = supplied.claim && { ...supplied.claim };
  const db = supplied.supabaseAdmin;
  const valid = () =>
    uuid(tenantId) &&
    uuid(jobId) &&
    !!claim?.claimedBy &&
    Number.isSafeInteger(claim.attemptCount) &&
    claim.attemptCount > 0;
  const claimArgs = () => ({
    p_tenant_id: tenantId,
    p_job_id: jobId,
    p_claimed_by: claim?.claimedBy,
    p_attempt_count: claim?.attemptCount,
  });
  return {
    fetcher,
    clock,
    acquire: async (scope, callerClaim) => {
      if (
        !valid() ||
        supplied.signal?.aborted ||
        scope.tenantId !== tenantId ||
        scope.jobId !== jobId ||
        callerClaim.claimedBy !== claim?.claimedBy ||
        callerClaim.attemptCount !== claim?.attemptCount
      )
        return null;
      try {
        const result = await db.rpc("learn_commusoft_acquire_page", {
          ...claimArgs(),
          p_expected: structuredClone(scope),
        });
        checkAuthorityTransport(result);
        const { data, error } = result;
        if (error || !object(data)) return null;
        if (
          data.state === "wait" &&
          Object.keys(data).every((k) => ["state", "retryAt", "waitKind"].includes(k)) &&
          Number.isSafeInteger(data.retryAt) &&
          Number(data.retryAt) > clock() &&
          (data.waitKind === undefined || data.waitKind === "lease" || data.waitKind === "quota")
        ) {
          return { state: "wait", retryAt: Number(data.retryAt),
            ...(data.waitKind === undefined ? {} : { waitKind: data.waitKind }) };
        }
        if (
          data.state === "ready" &&
          Object.keys(data).every((k) =>
            ["state", "apiKey", "permitId", "sendBefore"].includes(k),
          ) &&
          typeof data.apiKey === "string" &&
          /^[\x21-\x7e]{1,4096}$/.test(data.apiKey) &&
          uuid(data.permitId) &&
          Number.isSafeInteger(data.sendBefore)
        ) {
          return {
            state: "ready",
            apiKey: data.apiKey,
            permitId: data.permitId,
            sendBefore: Number(data.sendBefore),
          };
        }
        return null;
      } catch (error) {
        if (error instanceof CommusoftReadError && error.code === "authority_transport_unavailable")
          throw error;
        return null;
      }
    },
    defer: async (permitId, retryAt) => {
      // Delayed provider responses may outlive cancellation/revocation. The RPC
      // checks the retained permit and only extends the existing credential gate.
      if (
        !valid() ||
        !uuid(permitId) ||
        !Number.isSafeInteger(retryAt) ||
        retryAt < 0 ||
        retryAt > 8640000000000000
      )
        return false;
      try {
        const { data, error } = await db.rpc("learn_commusoft_defer_page", {
          ...claimArgs(),
          p_permit_id: permitId,
          p_retry_at: new Date(retryAt).toISOString(),
        });
        return !error && data === true;
      } catch {
        return false;
      }
    },
  };
}
