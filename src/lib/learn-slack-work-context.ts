import { readOperatorInputWriteAccess, type OperatorInputClient } from "./learn-operator-inputs.ts";
import {
  inputOutboxKey,
  type InputScope,
  type InputLock,
  type RequestStore,
} from "./learn-operator-request-scope.ts";

export type SlackContext = {
  version: "learn-slack-context-state/1";
  tenant_id: string;
  actor_id: string;
  interaction_id: string;
  revision: string;
  source_version: string;
  current_job_id: string | null;
  context: { state: string; scope: string } | null;
  job: { id: string; title: string; job_number: string | null; status: string } | null;
  checked_at: string;
};
export type SlackContextRequest = {
  tenantId: string;
  actorId: string;
  interactionId: string;
  requestId: string;
  definition: { revision: string; job_id: string | null; reason: string };
};
export type SavedSlackContext = { version: 1; backend: string; request: SlackContextRequest };
export type SlackContextResult = {
  state: "pending" | "committed" | "cancelled";
  requestId: string;
};
const object = (v: any) => v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const reason = (v: unknown) => typeof v === "string" && v.trim().length >= 3 && v.length <= 500;
const validDate = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
const nullableId = (v: unknown) => v === null || uuid(v);
export const slackContextKey = (s: InputScope, interaction: string) => {
  if (!uuid(interaction)) throw Error("Choose a retained Slack message.");
  return `${inputOutboxKey(s)}:slack-context:${interaction}`;
};
export async function readSlackContext(
  db: OperatorInputClient,
  s: InputScope,
  interaction: string,
  job: string | null,
  accessReason: string,
): Promise<SlackContext> {
  slackContextKey(s, interaction);
  if (!nullableId(job) || !reason(accessReason))
    throw Error("Choose the context and enter your reason.");
  const { data, error } = await db.rpc("learn_operator_slack_context", {
    p_tenant: s.tenantId,
    p_interaction: interaction,
    p_job: job,
    p_reason: accessReason.trim(),
  });
  const d = data as any;
  if (
    error ||
    !object(d) ||
    d.version !== "learn-slack-context-state/1" ||
    d.tenant_id !== s.tenantId ||
    d.actor_id !== s.actorId ||
    d.interaction_id !== interaction ||
    !hash(d.revision) ||
    !hash(d.source_version) ||
    !uuid(d.audit_id) ||
    !nullableId(d.current_job_id) ||
    !validDate(d.checked_at) ||
    Math.abs(Date.now() - Date.parse(d.checked_at)) > 300000 ||
    (job === null
      ? d.job !== null
      : !object(d.job) ||
        d.job.id !== job ||
        typeof d.job.title !== "string" ||
        !(d.job.job_number === null || typeof d.job.job_number === "string") ||
        typeof d.job.status !== "string") ||
    !(
      d.context === null ||
      (object(d.context) &&
        ["reviewed", "source_changed"].includes(d.context.state) &&
        ["job", "company"].includes(d.context.scope))
    )
  )
    throw Error(
      "Slack context could not be verified. Reload the message and check operator access.",
    );
  return {
    version: d.version,
    tenant_id: d.tenant_id,
    actor_id: d.actor_id,
    interaction_id: interaction,
    revision: d.revision,
    source_version: d.source_version,
    current_job_id: d.current_job_id,
    context: d.context === null ? null : { state: d.context.state, scope: d.context.scope },
    job:
      d.job === null
        ? null
        : { id: d.job.id, title: d.job.title, job_number: d.job.job_number, status: d.job.status },
    checked_at: d.checked_at,
  };
}
function validate(r: SlackContextRequest) {
  if (
    !object(r) ||
    Object.keys(r).sort().join() !== "actorId,definition,interactionId,requestId,tenantId" ||
    ![r.tenantId, r.actorId, r.interactionId, r.requestId].every(uuid) ||
    !object(r.definition) ||
    Object.keys(r.definition).sort().join() !== "job_id,reason,revision" ||
    !hash(r.definition.revision) ||
    !nullableId(r.definition.job_id) ||
    !reason(r.definition.reason)
  )
    throw Error("The saved Slack review needs inspection. Keep the browser data.");
}
function checked(s: InputScope, interaction: string, value: SavedSlackContext) {
  slackContextKey(s, interaction);
  if (
    !object(value) ||
    Object.keys(value).sort().join() !== "backend,request,version" ||
    value.version !== 1 ||
    value.backend !== s.backend ||
    value.request?.tenantId !== s.tenantId ||
    value.request?.actorId !== s.actorId ||
    value.request?.interactionId !== interaction
  )
    throw Error("Saved review belongs to another operator, company, message or backend.");
  validate(value.request);
  return structuredClone(value);
}
export function readSavedSlackContext(
  store: RequestStore,
  s: InputScope,
  interaction: string,
): SavedSlackContext | null {
  const raw = store.getItem(slackContextKey(s, interaction));
  if (raw === null) return null;
  if (raw.length > 6000) throw Error("Saved review needs inspection. Keep the browser data.");
  return checked(s, interaction, JSON.parse(raw));
}
export async function resolveSlackContext(
  db: OperatorInputClient,
  r: SlackContextRequest,
  mode: "apply" | "check" | "cancel",
): Promise<SlackContextResult> {
  validate(r);
  if (!["apply", "check", "cancel"].includes(mode)) throw Error("Invalid action.");
  try {
    const { data, error } = await db.rpc("learn_operator_slack_context_review", {
      p_tenant: r.tenantId,
      p_actor: r.actorId,
      p_request: r.requestId,
      p_interaction: r.interactionId,
      p_definition: r.definition,
      p_mode: mode,
    });
    const d = data as any;
    if (
      error ||
      !object(d) ||
      d.version !== "learn-slack-context-review/1" ||
      !["pending", "committed", "cancelled"].includes(d.state) ||
      d.tenant_id !== r.tenantId ||
      d.actor_id !== r.actorId ||
      d.interaction_id !== r.interactionId ||
      d.request_id !== r.requestId ||
      !object(d.definition) ||
      Object.keys(d.definition).sort().join() !== "job_id,reason,revision" ||
      d.definition.revision !== r.definition.revision ||
      d.definition.job_id !== r.definition.job_id ||
      d.definition.reason !== r.definition.reason
    )
      throw Error();
    if (
      d.state === "committed" &&
      (!object(d.context) ||
        d.context.version !== "learn-slack-work-context/1" ||
        d.context.state !== "reviewed" ||
        d.context.request_id !== r.requestId ||
        d.context.reviewed_by !== r.actorId ||
        !validDate(d.context.reviewed_at) ||
        !hash(d.context.source_version) ||
        d.context.job_id !== r.definition.job_id ||
        d.context.scope !== (r.definition.job_id ? "job" : "company") ||
        !Number.isSafeInteger(d.events_consumed) ||
        d.events_consumed < 0)
    )
      throw Error();
    return { state: d.state, requestId: r.requestId };
  } catch {
    throw Error(
      "The result could not be confirmed. Check the saved review before retrying. If the source changed, cancel the unrecorded request and review again.",
    );
  }
}
export async function resolveSavedSlackContext(
  db: OperatorInputClient,
  store: RequestStore,
  lock: InputLock,
  s: InputScope,
  interaction: string,
  draft: SavedSlackContext,
  mode: "apply" | "check" | "cancel",
  allowed: () => boolean,
) {
  const value = checked(s, interaction, draft),
    encoded = JSON.stringify(value),
    key = slackContextKey(s, interaction);
  return lock(key, async () => {
    if (!allowed()) throw Error("Operator context changed. Request retained.");
    const prior = readSavedSlackContext(store, s, interaction);
    if (prior && JSON.stringify(prior) !== encoded)
      throw Error("Resolve the existing saved review first.");
    if (!prior && mode !== "apply") throw Error("Saved request changed. Reload the message.");
    store.setItem(key, encoded);
    if (store.getItem(key) !== encoded) throw Error("Could not save the review. Nothing was sent.");
    if ((await readOperatorInputWriteAccess(db)) !== true || !allowed())
      throw Error("Current operator authority could not be confirmed. Request retained.");
    let result = await resolveSlackContext(db, value.request, "check");
    if (result.state === "pending" && mode !== "check") {
      if (!allowed()) throw Error("Operator context changed. Request retained.");
      result = await resolveSlackContext(db, value.request, mode);
    }
    if (result.state !== "pending") {
      if (!allowed() || store.getItem(key) !== encoded)
        throw Error("Context changed. Check the saved result again.");
      store.removeItem(key);
      if (store.getItem(key) !== null)
        throw Error("Result recorded; local recovery check still needed.");
    }
    return result;
  });
}
