import { CommusoftReadError, readCommusoftPage } from "./read_page.ts";
import { readStoredCommusoftScope } from "./stored_scope.ts";
import type { CommusoftWorkerScope, StoredCommusoftScope } from "./stored_scope.ts";
import type { CommusoftPage } from "./read_page.ts";

/** Credential-owning database port. The implementation must atomically revalidate
 * the exact approval/checkpoint/claim, reserve shared per-key quota and resolve
 * the tenant-qualified Vault reference. No general credential-broker fallback.
 * The local permit_server bridge implements this port using scoped RPCs. Its
 * migration is not deployed and the source worker is not registered yet.
 */
export interface CommusoftPagePermitPorts {
  acquire: (
    scope: StoredCommusoftScope,
    claim: { claimedBy: string; attemptCount: number },
  ) => Promise<
    | { state: "ready"; apiKey: string; permitId: string; sendBefore: number }
    | { state: "wait"; retryAt: number }
    | null
  >;
  // Must extend a shared credential gate, including when authority changed after
  // the request. The exact acquired permit binds the update; no secret argument.
  defer: (permitId: string, retryAt: number) => Promise<boolean>;
  fetcher?: typeof fetch;
  clock?: () => number;
}

/** One page per invocation. Captures context before awaiting, reads durable scope
 * again before secret acquisition and around the provider read, and returns no
 * credential. Publication still needs an atomic authority/checkpoint check.
 */
export async function readApprovedCommusoftPage(
  supplied: CommusoftWorkerScope,
  ports: CommusoftPagePermitPorts,
): Promise<{ scope: StoredCommusoftScope; page: CommusoftPage; permitId: string }> {
  const ctx = { ...supplied, claim: supplied.claim && { ...supplied.claim } };
  const clock = ports.clock ?? Date.now;
  const scope = await readStoredCommusoftScope(ctx, clock);
  if (!scope || scope.complete || scope.pages >= Number(scope.approval.maxPages)) {
    throw new CommusoftReadError("authority_unavailable");
  }
  const authorized = async () => {
    const current = await readStoredCommusoftScope(ctx, clock);
    return !!current && current.scopeKey === scope.scopeKey;
  };
  if (!(await authorized())) throw new CommusoftReadError("authority_unavailable");
  let permit;
  try {
    permit = await ports.acquire(structuredClone(scope), { ...ctx.claim! });
  } catch {
    throw new CommusoftReadError("authority_unavailable");
  }
  if (!permit) throw new CommusoftReadError("authority_unavailable");
  if (permit.state === "wait") {
    if (!Number.isSafeInteger(permit.retryAt) || permit.retryAt <= clock()) {
      throw new CommusoftReadError("authority_unavailable");
    }
    throw new CommusoftReadError("rate_limited", permit.retryAt);
  }
  if (
    permit.state !== "ready" ||
    !Number.isSafeInteger(permit.sendBefore) ||
    typeof permit.permitId !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(permit.permitId)
  ) {
    throw new CommusoftReadError("authority_unavailable");
  }
  if (permit.sendBefore <= clock()) throw new CommusoftReadError("request_window_expired");
  const defer = async (retryAt: number) => {
    try {
      if (await ports.defer(permit.permitId, retryAt)) return;
    } catch {
      /* Throw a safe error, never credential-port internals. */
    }
    throw new CommusoftReadError("provider_unavailable", retryAt);
  };
  let page: CommusoftPage;
  try {
    page = await readCommusoftPage(scope.request, permit.apiKey, {
      stillAuthorized: authorized,
      clock,
      fetcher: ports.fetcher,
      signal: ctx.signal,
      sendBefore: permit.sendBefore,
    });
  } catch (error) {
    if (error instanceof CommusoftReadError && error.retryAt !== null) await defer(error.retryAt);
    throw error;
  }
  if (page.quota.retryAt !== null) await defer(page.quota.retryAt);
  if (!(await authorized())) throw new CommusoftReadError("authority_unavailable");
  return { scope, page, permitId: permit.permitId };
}
