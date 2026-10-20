import { CommusoftReadError } from "./read_page.ts";
import { readNewestCommusoftJobPage } from "./newest_job.ts";

type RpcResult = { data: unknown; error: unknown };
type Database = { rpc: (name: string, args?: Record<string, unknown>) => Promise<RpcResult> };
type State = "idle" | "waiting" | "held" | "processed" | "attention" | "unconfirmed";
type Claim = { state: string; run_id?: string; claim_token?: string; region?: "uk" | "us";
  api_key?: string; after?: number | null; send_before?: number };
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const safeCursor = (v: unknown): v is number | null =>
  v === null || (typeof v === "number" && Number.isSafeInteger(v) && v > 0);

/** One provider page per ordinary worker invocation. A lost finish response is
 * left for the durable SQL cursor; it must not be marked failed or replayed here. */
export async function runCommusoftFreshness(
  db: Database,
  signal?: AbortSignal,
  transport: typeof readNewestCommusoftJobPage = readNewestCommusoftJobPage,
): Promise<{ state: State }> {
  if (signal?.aborted) return { state: "unconfirmed" };
  const claimed = await db.rpc("new_dawn_commusoft_freshness_claim");
  if (claimed.error || !object(claimed.data)) return { state: "unconfirmed" };
  const raw = claimed.data as Claim;
  if (["idle", "waiting", "held"].includes(raw.state)) return { state: raw.state as State };
  if (raw.state !== "ready" || !uuid(raw.run_id) || !uuid(raw.claim_token) ||
    !["uk", "us"].includes(raw.region ?? "") || typeof raw.api_key !== "string" ||
    !safeCursor(raw.after) || !Number.isSafeInteger(raw.send_before))
    return { state: "unconfirmed" };
  const run = raw.run_id, token = raw.claim_token;
  try {
    const page = await transport(raw.region!, raw.api_key, raw.after!, {
      sendBefore: raw.send_before!, signal,
      stillAuthorized: async () => {
        const result = await db.rpc("new_dawn_commusoft_freshness_current",
          { p_run: run, p_claim: token });
        return !result.error && result.data === true;
      },
    });
    const settled = await db.rpc("new_dawn_commusoft_freshness_finish", {
      p_run: run, p_claim: token,
      p_rows: page.rows.map(row => ({ id: row.id, createdAt: row.createdAt })),
      p_has_more: page.hasMore,
      p_next_cursor: page.nextCursor,
      p_server_time: page.providerServerTime,
    });
    if (settled.error || !object(settled.data) ||
      !["collecting", "complete", "partial"].includes(String(settled.data.state)))
      return { state: "unconfirmed" };
    return { state: settled.data.state === "partial" ? "attention" : "processed" };
  } catch (error) {
    const code = error instanceof CommusoftReadError ? error.code : "result_unconfirmed";
    const allowed = ["authority_unavailable", "transport_unavailable", "provider_unavailable",
      "authentication_required", "access_denied", "rate_limited", "response_too_large",
      "invalid_response", "request_window_expired"];
    const failure = await db.rpc("new_dawn_commusoft_freshness_fail", {
      p_run: run, p_claim: token,
      p_code: allowed.includes(code) ? code : "result_unconfirmed",
    });
    return { state: failure.error ? "unconfirmed" : "attention" };
  }
}
