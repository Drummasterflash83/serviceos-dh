import { parseVerificationReceipt, validateVerificationRequest } from "./verification_contract.ts";
import type { VerificationRequest } from "./verification_contract.ts";
import type { VerificationExecution } from "./verify_connection.ts";

export type VerificationSession = {
  actorId: string;
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: cors });
async function boundedBody(req: Request): Promise<unknown> {
  if (
    req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" ||
    !req.body
  )
    throw Error();
  const reader = req.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const chunks: Uint8Array[] = [];
        let length = 0;
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.byteLength;
          if (length > 10000) throw Error();
          chunks.push(part.value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error()), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

/** User endpoint. Platform cross-client authority is decided by the authenticated
 * SQL RPC; a tenant role or an infrastructure/service token cannot approve a read.
 */
export function commusoftVerificationEndpoint(ports: {
  authenticate: (req: Request) => Promise<VerificationSession | null>;
  execute: (tenantId: string, requestId: string) => Promise<VerificationExecution>;
}) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return json({ code: "method_not_allowed" }, 405);
    let session: VerificationSession | null;
    try {
      session = await ports.authenticate(req);
    } catch {
      return json({ code: "verification_unavailable" }, 503);
    }
    if (!session) return json({ code: "authentication_required" }, 401);
    let request: VerificationRequest;
    let mode: "apply" | "check" | "cancel";
    try {
      const body = (await boundedBody(req)) as Record<string, unknown>;
      if (
        !body ||
        typeof body !== "object" ||
        Object.keys(body).length !== 2 ||
        !["apply", "check", "cancel"].includes(String(body.mode))
      )
        throw Error();
      validateVerificationRequest(body.request);
      request = body.request;
      mode = body.mode as typeof mode;
      if (session.actorId !== request.actorId) return json({ code: "actor_mismatch" }, 403);
    } catch {
      return json({ code: "verification_request_invalid" }, 400);
    }
    const resolve = async (action: typeof mode) => {
      const reply = await session.rpc("learn_commusoft_verify_request", {
        p_tenant: request.tenantId,
        p_request: request.requestId,
        p_actor: session.actorId,
        p_definition: request.definition,
        p_mode: action,
      });
      if (reply.error) throw Error();
      const receipt = parseVerificationReceipt(reply.data, request);
      if (action !== "check" && receipt.state === "pending") throw Error();
      return receipt;
    };
    try {
      let receipt = await resolve(mode);
      let execution: VerificationExecution | undefined;
      // Only explicit apply may execute; receipt reads/cancellation never contact
      // a provider. Running/expired/settled approvals cannot release another key.
      if (mode === "apply" && receipt.state === "approved") {
        try {
          execution = await ports.execute(request.tenantId, request.requestId);
        } catch {
          execution = { state: "unconfirmed" };
        }
        receipt = await resolve("check");
      }
      const retryAt =
        execution?.state === "waiting" && Number.isSafeInteger(execution.retryAt)
          ? execution.retryAt
          : undefined;
      return json({ receipt, ...(retryAt === undefined ? {} : { retry_at: retryAt }) });
    } catch {
      return json({ code: "verification_unconfirmed" }, 503);
    }
  };
}
