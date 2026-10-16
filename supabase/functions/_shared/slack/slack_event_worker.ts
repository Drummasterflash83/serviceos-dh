import type { WorkerHandlerContext, WorkerHandlerResult } from "../worker_contract.ts";
import { fetchApprovedSlackEventSource, type PendingSlackEvent } from "./slack_event_reconcile.ts";

type Context = {
  version: "learn-slack-event-context/1";
  tenantId: string; jobId: string; eventId: string;
  teamId: string; channelId: string; sourceTs: string;
  threadTs: string | null; hintKind: "message_hint" | "correction_hint";
  correction: "changed" | "deleted" | null;
  connectionId: string; connectionRevision: string; secretRef: string;
  tokenKind: "user" | "bot"; userId: string | null;
};

class EventWorkError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number;
  constructor(code: string, retryable: boolean, retryAfterSeconds = 0) {
    super(code);
    this.code = code;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const TS = /^\d{10,12}\.\d{1,6}$/;
const EVENT = /^Ev[A-Za-z0-9]{4,100}$/;
const token = (value: unknown, kind: "user" | "bot") => typeof value === "string" &&
  value.length <= 1000 && new RegExp(`^xox${kind === "user" ? "p" : "b"}-[A-Za-z0-9-]+$`).test(value);
const valid = (value: unknown): value is Context => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const x = value as Partial<Context>;
  return x.version === "learn-slack-event-context/1" &&
    typeof x.tenantId === "string" && UUID.test(x.tenantId) &&
    typeof x.jobId === "string" && UUID.test(x.jobId) &&
    typeof x.eventId === "string" && EVENT.test(x.eventId) &&
    typeof x.teamId === "string" && /^T[A-Z0-9]{1,63}$/.test(x.teamId) &&
    typeof x.channelId === "string" && /^C[A-Z0-9]{1,63}$/.test(x.channelId) &&
    typeof x.sourceTs === "string" && TS.test(x.sourceTs) &&
    (x.threadTs === null || typeof x.threadTs === "string" && TS.test(x.threadTs)) &&
    (x.hintKind === "message_hint" && x.correction === null ||
      x.hintKind === "correction_hint" && ["changed", "deleted"].includes(x.correction ?? "")) &&
    typeof x.connectionId === "string" && UUID.test(x.connectionId) &&
    typeof x.connectionRevision === "string" && Number.isFinite(Date.parse(x.connectionRevision)) &&
    typeof x.secretRef === "string" && UUID.test(x.secretRef) &&
    (x.tokenKind === "user" && typeof x.userId === "string" && /^U[A-Z0-9]{1,63}$/.test(x.userId) ||
      x.tokenKind === "bot" && x.userId === null);
};

/** Dedicated handler for the existing paced Slack worker; no event body or
 * token reaches a job payload, database hint, log or response. */
export async function handleSlackEventSync(
  ctx: WorkerHandlerContext,
  fetcher: typeof fetch = fetch,
): Promise<WorkerHandlerResult> {
  if (ctx.jobType !== "slack.event_sync" || !ctx.jobId || !UUID.test(ctx.jobId) ||
      !ctx.claim || !UUID.test(ctx.tenantId))
    return { success: false, error: { code: "slack_event_job_invalid",
      message: "Slack event job unavailable.", retryable: false } };
  const args = { p_tenant: ctx.tenantId, p_job: ctx.jobId,
    p_claimed_by: ctx.claim.claimedBy, p_attempt: ctx.claim.attemptCount };
  const db = ctx.supabaseAdmin;
  try {
    const initial = await db.rpc("learn_slack_event_context", args);
    if (initial.error || !valid(initial.data) ||
        initial.data.tenantId !== ctx.tenantId || initial.data.jobId !== ctx.jobId ||
        initial.data.eventId !== ctx.payload.event_id)
      throw new EventWorkError("slack_event_binding_unavailable", false);
    const binding = initial.data;
    const credential = await db.rpc("learn_slack_event_credential", args);
    if (credential.error || !token(credential.data, binding.tokenKind))
      throw new EventWorkError("slack_event_credential_unavailable", false);
    const secret = credential.data as string;
    const identity = JSON.stringify(binding);
    const authorised = async () => {
      if (ctx.signal?.aborted) return false;
      const current = await db.rpc("learn_slack_event_context", args);
      return !current.error && valid(current.data) && JSON.stringify(current.data) === identity;
    };
    let requests = 0;
    const request = async (method: "auth.test" | "conversations.info" |
      "conversations.history" | "conversations.replies", params: Record<string, string>) => {
      if (!await authorised()) throw new EventWorkError("slack_event_authority_changed", true);
      if (++requests > 3) throw new EventWorkError("slack_event_request_budget_exhausted", false);
      const url = new URL(`https://slack.com/api/${method}`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      let response: Response;
      try {
        response = await fetcher(url.toString(), {
          method: method === "auth.test" ? "POST" : "GET", redirect: "error",
          headers: { Authorization: `Bearer ${secret}`,
            ...(method === "auth.test" ? { "Content-Type": "application/json" } : {}) },
          ...(method === "auth.test" ? { body: "{}" } : {}),
          signal: ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(15000)])
            : AbortSignal.timeout(15000),
        });
      } catch { throw new EventWorkError("slack_event_network_error", !ctx.signal?.aborted); }
      if (response.status === 429) {
        const header = response.headers.get("retry-after");
        await response.body?.cancel();
        const seconds = header && /^\d{1,8}$/.test(header) ? Number(header) : 60;
        throw new EventWorkError("slack_event_rate_limited", true, Math.max(60, seconds));
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new EventWorkError("slack_event_provider_http_error", response.status >= 500);
      }
      if (!response.body) throw new EventWorkError("slack_event_provider_invalid", false);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.byteLength;
          if (length > 4 * 1024 * 1024)
            throw new EventWorkError("slack_event_response_too_large", false);
          chunks.push(part.value);
        }
      } finally { await reader.cancel(); }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let result: unknown;
      try { result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch { throw new EventWorkError("slack_event_provider_invalid", false); }
      if (!result || typeof result !== "object" || Array.isArray(result) ||
          (result as Record<string, unknown>).ok !== true)
        throw new EventWorkError("slack_event_provider_denied", false);
      if (!await authorised()) throw new EventWorkError("slack_event_authority_changed", true);
      return result;
    };
    const hint: PendingSlackEvent = { tenantId: binding.tenantId,
      eventId: binding.eventId, teamId: binding.teamId, channelId: binding.channelId,
      sourceTs: binding.sourceTs, threadTs: binding.threadTs,
      kind: binding.hintKind, correction: binding.correction };
    const source = await fetchApprovedSlackEventSource(hint, {
      authorised, request, expectedIdentity: binding.tokenKind === "user"
        ? { kind: "user", userId: binding.userId! } : { kind: "bot" },
    });
    const committed = await db.rpc("learn_slack_event_commit", { ...args,
      p_records: source.records, p_source_absent: source.outcome === "absent_after_delete",
      p_public_visible: true });
    if (committed.error || committed.data?.version !== "learn-slack-event-source/1" ||
        committed.data?.eventId !== binding.eventId)
      throw new EventWorkError("slack_event_commit_unconfirmed", true);
    return { success: true, recordsProcessed: source.records.length,
      result: { outcome: source.outcome, sourceVersion: committed.data.sourceVersion ?? null } };
  } catch (error) {
    const known = error instanceof EventWorkError ? error : null;
    const code = known?.code ?? (error instanceof Error &&
      /^slack_event_[a-z_]{1,80}$/.test(error.message) ? error.message : "slack_event_worker_failed");
    const retryable = known?.retryable ??
      ["slack_event_authority_unavailable", "slack_event_source_not_visible_yet",
        "slack_event_edit_unconfirmed", "slack_event_delete_unconfirmed",
        "slack_event_source_incomplete"].includes(code);
    return { success: false, error: { code,
      message: "Slack event source reconciliation failed.", retryable,
      retryAfterSeconds: known?.retryAfterSeconds ?? 0 } };
  }
}
