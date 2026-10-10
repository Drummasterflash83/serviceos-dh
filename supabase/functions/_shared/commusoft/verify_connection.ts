import { CommusoftReadError, readCommusoftPage } from "./read_page.ts";

type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;
export type VerificationExecution =
  { state: "unconfirmed" } | { state: "waiting"; retryAt: number } | { state: "finished" }; // The browser reads the authenticated retained receipt.
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Server-only execution of an already authenticated, persisted approval.
 * Never retries acquisition, provider transport or finalization. A lost reply is
 * resolved with the user's receipt RPC, never by releasing the credential twice.
 * No source payload, API key, raw RPC result or exception leaves this function.
 */
export async function verifyCommusoftConnection(
  tenantId: string,
  requestId: string,
  ports: { rpc: Rpc; fetcher?: typeof fetch; clock?: () => number; signal?: AbortSignal },
): Promise<VerificationExecution> {
  if (!uuid(tenantId) || !uuid(requestId)) return { state: "unconfirmed" };
  const scope = { p_tenant: tenantId, p_request: requestId };
  try {
    const acquired = await ports.rpc("learn_commusoft_verify_acquire", scope);
    if (acquired.error || !object(acquired.data)) return { state: "unconfirmed" };
    const permit = acquired.data;
    if (permit.state === "wait") {
      if (
        !Number.isSafeInteger(permit.retryAt) ||
        Number(permit.retryAt) <= (ports.clock ?? Date.now)()
      )
        return { state: "unconfirmed" };
      return { state: "waiting", retryAt: Number(permit.retryAt) };
    }
    if (
      permit.state !== "ready" ||
      !uuid(permit.permitId) ||
      (permit.region !== "uk" && permit.region !== "us") ||
      typeof permit.apiKey !== "string" ||
      !/^[\x21-\x7e]{1,4096}$/.test(permit.apiKey) ||
      !Number.isSafeInteger(permit.sendBefore)
    )
      return { state: "unconfirmed" };
    const bound = { ...scope, p_permit: permit.permitId };
    let code: string = "access_verified";
    let retryAt: number | null = null;
    try {
      const page = await readCommusoftPage(
        { region: permit.region, resource: "properties", after: null, limit: 1 },
        permit.apiKey,
        {
          fetcher: ports.fetcher,
          clock: ports.clock,
          signal: ports.signal,
          sendBefore: Number(permit.sendBefore),
          stillAuthorized: async () => {
            const current = await ports.rpc("learn_commusoft_verify_authorized", bound);
            return !current.error && current.data === true;
          },
        },
      );
      retryAt = page.quota.retryAt;
      // Deliberately discard records and rawEnvelope. This checks read access;
      // it is not an import, account-identity proof or collection coverage claim.
    } catch (error) {
      code = error instanceof CommusoftReadError ? error.code : "transport_unavailable";
      retryAt = error instanceof CommusoftReadError ? error.retryAt : null;
    }
    const finished = await ports.rpc("learn_commusoft_verify_finish", {
      ...bound,
      p_code: code,
      p_retry_at: retryAt === null ? null : new Date(retryAt).toISOString(),
    });
    if (
      finished.error ||
      !object(finished.data) ||
      finished.data.tenant_id !== tenantId ||
      finished.data.request_id !== requestId ||
      !["recorded", "cancelled"].includes(String(finished.data.state))
    )
      return { state: "unconfirmed" };
    return { state: "finished" };
  } catch {
    return { state: "unconfirmed" };
  }
}
