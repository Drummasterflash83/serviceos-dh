import { readStoredHistoryScope } from "./slack_history_binding.ts";
import { readSlackCredentialBinding } from "./slack_credential_binding.ts";
import { SlackHistoryTransportError } from "./slack_history_errors.ts";
import { SLACK_HISTORY_PROVIDER_REQUESTS_PER_JOB } from "./slack_provider_budget.ts";
import type {
  HistoryServerPorts,
  HistoryRequestIdentity,
  HistoryArguments,
} from "./slack_history_request.ts";
import type { WorkerHandlerContext } from "../worker_contract.ts";

const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const denied = () => new SlackHistoryTransportError("slack_history_authority_unavailable", false);
const fields = [
  "tenantId",
  "accountId",
  "teamId",
  "channelId",
  "oldest",
  "latest",
  "consentReference",
  "expiresAt",
  "maxPages",
  "parentTimestamp",
] as const;

/** Actual server transport. Only this closure sees the exact existing Vault
 * credential bound to this approved job. It never accepts URLs, methods or credentials
 * from a job payload and never falls back to notification credentials. */
export function createSlackHistoryServerPorts(
  ctx: WorkerHandlerContext,
  fetcher: typeof fetch = fetch,
  clock: () => number = Date.now,
): HistoryServerPorts {
  const db = ctx.supabaseAdmin;
  async function stored(identity: Readonly<HistoryRequestIdentity>) {
    const scope = await readStoredHistoryScope(ctx, clock);
    if (!scope || !uuid(scope.connectionId)) return null;
    const actual = {
      tenantId: ctx.tenantId,
      accountId: scope.accountId,
      teamId: scope.scope.teamId,
      channelId: scope.channelId,
      oldest: scope.scope.oldest,
      latest: scope.scope.latest,
      consentReference: scope.scope.consentReference,
      expiresAt: scope.expiresAt,
      maxPages: scope.maxPages,
      parentTimestamp: scope.scope.parentTimestamp,
    };
    if (!fields.every((key) => actual[key] === identity[key])) return null;
    const { data: c, error } = await db
      .from("provider_connections")
      .select(
        "id,tenant_id,provider,status,revoked_at,updated_at,non_secret_config,configured_fields,secret_refs",
      )
      .eq("tenant_id", ctx.tenantId)
      .eq("id", scope.connectionId)
      .eq("provider", "slack")
      .maybeSingle();
    if (
      error ||
      !c ||
      c.id !== scope.connectionId ||
      c.tenant_id !== ctx.tenantId ||
      c.provider !== "slack" ||
      c.status !== "configured" ||
      c.revoked_at !== null ||
      c.non_secret_config?.team_id !== identity.teamId ||
      typeof c.updated_at !== "string" ||
      !Number.isFinite(Date.parse(c.updated_at))
    )
      return null;
    const credential = readSlackCredentialBinding(c);
    if (!credential) return null;
    // This infrastructure-only profile is bound to the exact reviewed connection
    // revision and Vault reference. Browser/job claims cannot opt into a faster tier.
    const rate = await db.rpc("learn_slack_page_limit", {p_tenant:ctx.tenantId,p_connection:c.id,p_team:identity.teamId});
    // A rolling deployment may precede schema-cache refresh. Only a missing
    // profile function/table is a safe conservative fallback; other errors stop.
    const missing=rate.error && ["PGRST202","42883","42P01"].includes(rate.error.code);
    const pageLimit=missing?15:rate.data;
    if((rate.error&&!missing) || (pageLimit!==15 && pageLimit!==100))return null;
    return { id: c.id, revision: c.updated_at, pageLimit:pageLimit as 15|100, ...credential };
  }
  return {
    acquire: async (supplied) => {
      const identity = Object.freeze({ ...supplied });
      const initial = await stored(identity);
      if (!initial) return null;
      // Fail before obtaining credentials or provider content if storage is absent.
      for (const table of ["slack_messages", "slack_message_versions"]) {
        const result = await db.from(table).select("id").eq("tenant_id", ctx.tenantId).limit(0);
        if (result.error) return null;
      }
      const authorised = async () => {
        if (ctx.signal?.aborted) return false;
        const current = await stored(identity);
        return (
          !!current &&
          current.id === initial.id &&
          current.revision === initial.revision &&
          current.pageLimit === initial.pageLimit &&
          current.secretRef === initial.secretRef &&
          current.kind === initial.kind && current.userId === initial.userId
        );
      };
      if (!(await authorised())) return null;
      const secret = await db.rpc(ctx.jobType==='slack.thread_sync'?"learn_slack_read_thread_credential":"learn_slack_read_credential", {
        p_tenant_id: ctx.tenantId,
        p_job_id: ctx.jobId,
        p_claimed_by: ctx.claim!.claimedBy,
        p_attempt_count: ctx.claim!.attemptCount,
        p_connection_id: initial.id,
        p_revision: initial.revision,
        p_secret_id: initial.secretRef,
      });
      if (
        secret.error ||
        typeof secret.data !== "string" ||
        !(initial.kind === "user" ? /^xoxp-[A-Za-z0-9-]+$/ : /^xoxb-[A-Za-z0-9-]+$/).test(secret.data) ||
        secret.data.length > 1000
      )
        return null;
      const token = secret.data;
      let providerRequests = 0;
      async function request(
        method: "auth.test" | "conversations.info" | "conversations.history" | "conversations.replies",
        params: Record<string, string> = {},
      ) {
        if (!(await authorised())) throw denied();
        if (providerRequests >= SLACK_HISTORY_PROVIDER_REQUESTS_PER_JOB)
          throw new SlackHistoryTransportError("slack_history_request_budget_exhausted", false);
        providerRequests++;
        // The durable campaign ledger includes identity/channel checks and all
        // retries. Never dispatch when the reservation reply is uncertain.
        let reservation;
        try {
          reservation = await db.rpc('learn_slack_campaign_reserve_request', {
            p_tenant: ctx.tenantId, p_job: ctx.jobId,
            p_claimed_by: ctx.claim!.claimedBy, p_attempt: ctx.claim!.attemptCount,
            p_ordinal: providerRequests,
          });
        } catch {
          throw new SlackHistoryTransportError('slack_history_campaign_request_unconfirmed', true);
        }
        if (reservation.error)
          throw new SlackHistoryTransportError('slack_history_campaign_request_unconfirmed', true);
        if (reservation.data !== true)
          throw new SlackHistoryTransportError('slack_history_campaign_request_unavailable', false);
        const url = new URL(`https://slack.com/api/${method}`);
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        let response: Response;
        try {
          response = await fetcher(url.toString(), {
            method: method === "auth.test" ? "POST" : "GET",
            redirect: "error",
            headers: {
              Authorization: `Bearer ${token}`,
              ...(method === "auth.test" ? { "Content-Type": "application/json" } : {}),
            },
            ...(method === "auth.test" ? { body: "{}" } : {}),
            signal: ctx.signal
              ? AbortSignal.any([ctx.signal, AbortSignal.timeout(15000)])
              : AbortSignal.timeout(15000),
          });
        } catch {
          throw new SlackHistoryTransportError("slack_history_network_error", !ctx.signal?.aborted);
        }
        if (response.status === 429) {
          const raw = response.headers.get("retry-after");
          const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : 60;
          await response.body?.cancel();
          if (!Number.isSafeInteger(seconds) || seconds > 31536000)
            throw new SlackHistoryTransportError("slack_history_retry_delay_invalid", false);
          throw new SlackHistoryTransportError(
            "slack_history_rate_limited",
            true,
            Math.max(60, seconds),
          );
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new SlackHistoryTransportError(
            "slack_history_provider_error",
            response.status >= 500,
          );
        }
        if (!response.body)
          throw new SlackHistoryTransportError("slack_history_invalid_response", false);
        const reader = response.body.getReader(),
          chunks: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            length += part.value.length;
            if (length > 4 * 1024 * 1024)
              throw new SlackHistoryTransportError("slack_history_response_too_large", false);
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel();
        }
        const bytes = new Uint8Array(length);
        let at = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, at);
          at += chunk.length;
        }
        let data: any;
        try {
          data = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          throw new SlackHistoryTransportError("slack_history_invalid_response", false);
        }
        if (data?.ok !== true)
          throw new SlackHistoryTransportError(
            data?.error === "ratelimited"
              ? "slack_history_rate_limited"
              : "slack_history_provider_denied",
            data?.error === "ratelimited",
            data?.error === "ratelimited" ? 60 : undefined,
          );
        if (!(await authorised())) throw denied();
        return data;
      }
      const auth = await request("auth.test");
      if (
        auth.team_id !== identity.teamId ||
        (initial.kind === "user"
          ? auth.user_id !== initial.userId || !!auth.bot_id
          : typeof auth.bot_id !== "string" || !/^B[A-Z0-9]+$/.test(auth.bot_id))
      )
        return null;
      const inspectChannel = async () => {
        const data = await request("conversations.info", { channel: identity.channelId });
        const c = data.channel;
        if (
          !c ||
          c.id !== identity.channelId ||
          c.is_channel !== true ||
          c.is_private !== false ||
          c.is_shared !== false ||
          typeof c.is_member !== "boolean" ||
          (initial.kind === "bot" && c.is_member !== true) ||
          c.is_im === true || c.is_mpim === true ||
          c.is_ext_shared === true ||
          c.is_org_shared === true ||
          c.is_pending_ext_shared === true ||
          (Array.isArray(c.pending_shared) && c.pending_shared.length)
        )
          throw denied();
        return {
          tenantId: ctx.tenantId,
          accountId: identity.accountId,
          teamId: identity.teamId,
          channelId: identity.channelId,
          isPrivate: false,
          isShared: false,
          isMember: c.is_member,
          ...(initial.kind === "user" ? { publicUserAccess: true as const } : {}),
        };
      };
      return {
        identity,
        pageLimit:initial.pageLimit,
        authorised,
        inspectChannel,
        history: async (args: HistoryArguments) => {
          // Defence in depth: the lease is safe even if called without the adapter.
          if (
            args.ts !== identity.parentTimestamp ||
            args.channel !== identity.channelId ||
            args.oldest !== identity.oldest ||
            args.latest !== identity.latest ||
            args.limit !== initial.pageLimit ||
            Object.keys(args).some(
              (k) => !["channel", "oldest", "latest", "limit", "cursor",...(identity.parentTimestamp?["ts"]:[])].includes(k),
            ) ||
            (args.cursor !== undefined &&
              (typeof args.cursor !== "string" || !args.cursor || args.cursor.length > 1024))
          )
            throw denied();
          const params = {
            channel: identity.channelId,
            oldest: identity.oldest,
            latest: identity.latest,
            limit: String(initial.pageLimit),
            inclusive: "true",
            ...(identity.parentTimestamp?{ts:identity.parentTimestamp}:{}),
            ...(args.cursor ? { cursor: args.cursor } : {}),
          };
          await inspectChannel();
          return request(identity.parentTimestamp?"conversations.replies":"conversations.history", params);
        },
      };
    },
  };
}
