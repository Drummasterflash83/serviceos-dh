import type { InformationClient } from "./openfolk-client-information.ts";
export type SlackSource = {
  id: string;
  tenant_id: string;
  message_text: string;
  text_shortened: boolean;
  team_id: string;
  channel_id: string;
  posted_at: string;
  provider_timestamp: string;
  thread_timestamp: string | null;
  source_version: string;
  retained_at: string;
  author_ref: string | null;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, any>, fields: string[]) =>
  Object.keys(v).length === fields.length && fields.every((k) => Object.hasOwn(v, k));
const time = (v: unknown): v is string =>
  typeof v === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const stamp = (v: unknown): v is string => typeof v === "string" && /^\d{1,12}\.\d{1,6}$/.test(v);
const failure = () =>
  Error(
    "This Slack source is unavailable or could not be verified. Refresh or ask OpenFolk to check access.",
  );
export async function readSlackCardSource(
  client: InformationClient,
  args: { tenant: string; actor: string; id: string; operatorReason?: string },
  signal: AbortSignal,
  now = Date.now(),
): Promise<{ record: SlackSource; observedAt: string }> {
  const operator = args.operatorReason !== undefined;
  if (
    ![args.tenant, args.actor, args.id].every(uuid) ||
    !Number.isFinite(now) ||
    (operator &&
      (typeof args.operatorReason !== "string" ||
        args.operatorReason.trim().length < 3 ||
        args.operatorReason.trim().length > 500))
  )
    throw failure();
  const { data: p, error } = await client
    .rpc("learn_slack_card_source_read", {
      p_tenant: args.tenant,
      p_id: args.id,
      p_operator_reason: operator ? args.operatorReason!.trim() : null,
    })
    .abortSignal(signal);
  if (
    error ||
    !object(p) ||
    !exact(p, [
      "version",
      "tenant_id",
      "actor_id",
      "id",
      "record",
      "observed_at",
      "audit_id",
      "operator_mode",
    ]) ||
    p.version !== "learn-slack-card-source/1" ||
    p.tenant_id !== args.tenant ||
    p.actor_id !== args.actor ||
    p.id !== args.id ||
    p.operator_mode !== operator ||
    (operator ? !uuid(p.audit_id) : p.audit_id !== null) ||
    !time(p.observed_at) ||
    Date.parse(p.observed_at) > now + 60000 ||
    Date.parse(p.observed_at) < now - 60000
  )
    throw failure();
  const r = p.record;
  if (
    !object(r) ||
    !exact(r, [
      "id",
      "tenant_id",
      "message_text",
      "text_shortened",
      "team_id",
      "channel_id",
      "posted_at",
      "provider_timestamp",
      "thread_timestamp",
      "source_version",
      "retained_at",
      "author_ref",
    ]) ||
    r.id !== args.id ||
    r.tenant_id !== args.tenant ||
    typeof r.message_text !== "string" ||
    Array.from(r.message_text).length > 40000 ||
    typeof r.text_shortened !== "boolean" ||
    (r.text_shortened && Array.from(r.message_text).length !== 40000) ||
    ![r.team_id, r.channel_id].every(
      (v) => typeof v === "string" && v.length > 0 && v.length <= 100,
    ) ||
    (r.author_ref !== null && (typeof r.author_ref !== "string" || r.author_ref.length > 100)) ||
    !stamp(r.provider_timestamp) ||
    (r.thread_timestamp !== null && !stamp(r.thread_timestamp)) ||
    !time(r.posted_at) ||
    Math.abs(Date.parse(r.posted_at) - Math.floor(Number(r.provider_timestamp) * 1000)) > 1 ||
    !time(r.retained_at) ||
    typeof r.source_version !== "string" ||
    !/^[a-f0-9]{64}$/.test(r.source_version)
  )
    throw failure();
  return { record: r as SlackSource, observedAt: p.observed_at };
}
