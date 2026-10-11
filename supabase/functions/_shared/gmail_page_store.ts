import type {
  EmailCheckpoint,
  EmailProtocolClient,
  EmailScope,
} from "./email_ingestion_protocol.ts";
import { validateEmailJobLease, type EmailJobLease } from "./email_job_attempt.ts";
import type { GmailPageStore } from "./gmail_capture_page.ts";
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
/** Scope is captured once per owned checkpoint. Renew it after each transition.
 * Unknown replies never count as persistence or trigger an automatic retry.
 */
export function createGmailPageStore(
  db: EmailProtocolClient,
  scope: EmailScope,
  checkpoint: EmailCheckpoint,
  mailbox: string,
  fetchPolicy: "missing_only" | "refetch_all",
  lease?: EmailJobLease,
): GmailPageStore {
  if (lease) validateEmailJobLease(lease);
  if (
    !scope ||
    !checkpoint ||
    ![scope.tenantId, scope.accountId, scope.attemptId, checkpoint.generation].every(uuid) ||
    !["recent", "historical"].includes(scope.stream) ||
    checkpoint.contract_version !== 2 ||
    checkpoint.tenant_id !== scope.tenantId ||
    checkpoint.email_account_id !== scope.accountId ||
    checkpoint.stream !== scope.stream ||
    checkpoint.owner_attempt_id !== scope.attemptId ||
    checkpoint.state !== "claimed" ||
    typeof checkpoint.revision !== "string" ||
    !/^(0|[1-9][0-9]{0,18})$/.test(checkpoint.revision) ||
    BigInt(checkpoint.revision) > 9223372036854775807n ||
    typeof mailbox !== "string" ||
    !mailbox.trim() ||
    !["missing_only", "refetch_all"].includes(fetchPolicy) ||
    (scope.stream === "historical" && fetchPolicy !== "missing_only") ||
    (scope.stream === "recent" &&
      (checkpoint.continuation?.phase !== "initialized" ||
        checkpoint.continuation?.fetch_policy !== fetchPolicy))
  )
    throw Error("Email storage requires the current owned mailbox checkpoint.");
  const context = Object.freeze({
    tenant_id: scope.tenantId,
    email_account_id: scope.accountId,
    attempt_id: scope.attemptId,
    stream: scope.stream,
    generation: checkpoint.generation,
    revision: checkpoint.revision,
    mailbox,
    fetch_policy: fetchPolicy,
  });
  const claim = { p_claimed_by: lease?.claimedBy ?? null, p_claim: lease?.attemptCount ?? null };
  async function invoke(name: string, args: Record<string, unknown>) {
    try {
      const { data, error } = await db.rpc(name, { p_context: context, ...claim, ...args });
      const d = data as Record<string, any>;
      if (
        error ||
        !d ||
        d.version !== "learn-email-store/1" ||
        !d.context ||
        Object.keys(d.context).length !== Object.keys(context).length ||
        Object.entries(context).some(([key, value]) => d.context[key] !== value)
      )
        throw Error();
      return d;
    } catch {
      throw Error("Email page storage could not be confirmed. Keep the current checkpoint.");
    }
  }
  return {
    async existingMessageIds(ids) {
      const d = await invoke("learn_email_store_existing", { p_ids: [...ids] });
      if (
        !Array.isArray(d.existing_ids) ||
        new Set(d.existing_ids).size !== d.existing_ids.length ||
        d.existing_ids.some((id: unknown) => typeof id !== "string" || !ids.includes(id))
      )
        throw Error("Email existing-message lookup could not be confirmed.");
      return [...d.existing_ids];
    },
    async markUnavailable(ids) {
      const d = await invoke("learn_email_store_unavailable", { p_ids: [...ids] });
      if (
        !Number.isInteger(d.observed_count) ||
        d.observed_count < 0 ||
        d.observed_count > ids.length
      )
        throw Error("Email availability could not be confirmed.");
    },
    async savePage(threads, messages) {
      const d = await invoke("learn_email_store_page", {
        p_threads: structuredClone(threads),
        p_messages: structuredClone(messages),
      });
      if (
        !Number.isInteger(d.thread_upsert_count) ||
        d.thread_upsert_count < 0 ||
        d.thread_upsert_count > threads.length ||
        !Number.isInteger(d.message_upsert_count) ||
        d.message_upsert_count < 0 ||
        d.message_upsert_count > messages.length
      )
        throw Error("Email page write counts could not be confirmed.");
      return {
        thread_upsert_count: d.thread_upsert_count,
        message_upsert_count: d.message_upsert_count,
      };
    },
  };
}
