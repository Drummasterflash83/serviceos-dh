/** Server-only revocation. A durable lease releases one token once; an uncertain
 * outcome requires operator review, never an automatic second provider request.
 */
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const token = (v: unknown): v is string =>
  typeof v === "string" && /^[\x21-\x7e]{1,16384}$/.test(v);
export type DisconnectState =
  "queued" | "revoking" | "revoked" | "manual_review" | "reviewed" | "check_status";
export interface DisconnectInput {
  tenantId: string;
  connectionId: string;
  requestId: string;
  revision: number;
  reason: string;
}

export async function disconnectQuickBooks(
  input: DisconnectInput,
  ports: {
    userRpc: Rpc;
    serviceRpc: Rpc;
    fetcher?: typeof fetch;
    clock?: () => number;
    signal?: AbortSignal;
  },
): Promise<{
  connectionId: string;
  requestId: string;
  state: DisconnectState;
  localCaptureStopped: true;
}> {
  const i = Object.freeze({ ...input });
  if (
    ![i.tenantId, i.connectionId, i.requestId].every(uuid) ||
    !Number.isSafeInteger(i.revision) ||
    i.revision < 1 ||
    typeof i.reason !== "string" ||
    !i.reason.trim() ||
    i.reason.length > 1000
  )
    throw new Error("request_invalid");
  const result = (state: DisconnectState) => ({
    connectionId: i.connectionId,
    requestId: i.requestId,
    state,
    localCaptureStopped: true as const,
  });
  // This call uses a validated user JWT. Service authority cannot create a user action.
  const stopped = await ports.userRpc("learn_quickbooks_disconnect_request", {
    p_tenant: i.tenantId,
    p_connection: i.connectionId,
    p_request: i.requestId,
    p_revision: i.revision,
    p_reason: i.reason,
  });
  if (
    stopped.error ||
    !object(stopped.data) ||
    stopped.data.id !== i.requestId ||
    stopped.data.connectionId !== i.connectionId ||
    stopped.data.localCaptureStopped !== true
  )
    throw new Error("disconnect_not_confirmed");
  if (["revoking", "revoked", "manual_review", "reviewed"].includes(String(stopped.data.state)))
    return result(stopped.data.state as DisconnectState);
  if (stopped.data.state !== "queued") return result("check_status");
  let lease: string | null = null;
  try {
    const acquired = await ports.serviceRpc("learn_quickbooks_disconnect_acquire", {
      p_request: i.requestId,
    });
    if (acquired.error || !object(acquired.data)) return result("check_status");
    const a = acquired.data;
    if (["revoking", "revoked", "manual_review", "reviewed"].includes(String(a.state)))
      return result(a.state as DisconnectState);
    if (
      a.state !== "ready" ||
      a.requestId !== i.requestId ||
      !uuid(a.leaseId) ||
      typeof a.leaseUntil !== "string"
    )
      return result("check_status");
    lease = a.leaseId;
    const now = ports.clock ?? Date.now,
      remaining = Date.parse(a.leaseUntil) - now();
    if (
      !Number.isFinite(remaining) ||
      remaining <= 0 ||
      remaining > 120000 ||
      !token(a.clientId) ||
      a.clientId.includes(":") ||
      !token(a.clientSecret) ||
      !token(a.refreshToken)
    )
      throw new Error("lease_invalid");
    const deadline = AbortSignal.timeout(Math.ceil(Math.min(remaining, 30000)));
    const signal = ports.signal ? AbortSignal.any([ports.signal, deadline]) : deadline;
    const current = await ports.serviceRpc("learn_quickbooks_disconnect_current", {
      p_request: i.requestId,
      p_lease: lease,
    });
    if (current.error || current.data !== true) throw new Error("authority_changed");
    signal.throwIfAborted();
    const response = await (ports.fetcher ?? fetch)(
      "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
      {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          Authorization: `Basic ${btoa(`${a.clientId}:${a.clientSecret}`)}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: a.refreshToken }),
      },
    );
    // Intuit's documented revoke success is HTTP 200, with no required body.
    // Do not retain provider payloads or include secrets in diagnostic errors.
    await response.body?.cancel();
    signal.throwIfAborted();
    const finished = await ports.serviceRpc("learn_quickbooks_disconnect_finish", {
      p_request: i.requestId,
      p_lease: lease,
      p_revoked: response.status === 200,
    });
    if (finished.error || !object(finished.data)) return result("check_status");
    return result(
      finished.data.state === "revoked"
        ? "revoked"
        : finished.data.state === "manual_review"
          ? "manual_review"
          : "check_status",
    );
  } catch {
    if (lease) {
      try {
        const marked = await ports.serviceRpc("learn_quickbooks_disconnect_finish", {
          p_request: i.requestId,
          p_lease: lease,
          p_revoked: false,
        });
        if (!marked.error && object(marked.data) && marked.data.state === "manual_review")
          return result("manual_review");
      } catch {
        /* A saved/expired lease remains discoverable through status. */
      }
    }
    return result("check_status");
  }
}
