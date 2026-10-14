import type { InformationClient } from "./openfolk-client-information.ts";
export type SlackEvidenceRow = {
  id: string;
  interaction_id: string;
  source_id: string;
  source_version: string;
  recorded_at: string;
  posted_at: string;
  channel_id: string;
  summary: string | null;
  excerpt: string;
  attribution: "unresolved";
};
export type SlackEvidencePage = {
  rows: SlackEvidenceRow[];
  next_after: string | null;
  observed_at: string;
  scanned: number;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, any>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const time = (v: unknown): v is string =>
  typeof v === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const bounded = (v: unknown, n: number): v is string =>
  typeof v === "string" && Array.from(v).length <= n;
export async function readSlackEvidence(
  client: InformationClient,
  args: {
    tenant: string;
    actor: string;
    after?: string | null;
    operatorReason?: string;
  },
  signal: AbortSignal,
  now = Date.now(),
): Promise<SlackEvidencePage> {
  const after = args.after ?? null,
    operator = args.operatorReason !== undefined;
  const fail = () =>
    Error("Saved Slack evidence could not be verified. Refresh or ask OpenFolk to check access.");
  if (
    ![args.tenant, args.actor].every(uuid) ||
    (after !== null && !uuid(after)) ||
    !Number.isFinite(now) ||
    (operator &&
      (typeof args.operatorReason !== "string" ||
        args.operatorReason.trim().length < 3 ||
        args.operatorReason.trim().length > 500))
  )
    throw fail();
  const { data: p, error } = await client
    .rpc("learn_slack_evidence_read", {
      p_tenant: args.tenant,
      p_after: after,
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
      "after",
      "rows",
      "next_after",
      "scanned",
      "observed_at",
      "operator_mode",
      "audit_id",
    ]) ||
    p.version !== "learn-slack-evidence/1" ||
    p.tenant_id !== args.tenant ||
    p.actor_id !== args.actor ||
    p.after !== after ||
    p.operator_mode !== operator ||
    (operator ? !uuid(p.audit_id) : p.audit_id !== null) ||
    !time(p.observed_at) ||
    Math.abs(Date.parse(p.observed_at) - now) > 60000 ||
    !Array.isArray(p.rows) ||
    p.rows.length > 25 ||
    !Number.isSafeInteger(p.scanned) ||
    p.scanned < 0 ||
    p.scanned > 50 ||
    p.scanned < p.rows.length ||
    (p.next_after !== null &&
      (!uuid(p.next_after) || (after && p.next_after <= after) || !p.scanned))
  )
    throw fail();
  let previous = after;
  for (const r of p.rows) {
    if (
      !object(r) ||
      !exact(r, [
        "id",
        "interaction_id",
        "source_id",
        "source_version",
        "recorded_at",
        "posted_at",
        "channel_id",
        "summary",
        "excerpt",
        "attribution",
      ]) ||
      ![r.id, r.interaction_id, r.source_id].every(uuid) ||
      (previous && r.id <= previous) ||
      (p.next_after && r.id > p.next_after) ||
      !time(r.recorded_at) ||
      !time(r.posted_at) ||
      !bounded(r.channel_id, 100) ||
      !r.channel_id ||
      !(r.summary === null || bounded(r.summary, 240)) ||
      !bounded(r.excerpt, 320) ||
      typeof r.source_version !== "string" ||
      !/^[a-f0-9]{64}$/.test(r.source_version) ||
      r.attribution !== "unresolved"
    )
      throw fail();
    previous = r.id;
  }
  return { rows: p.rows, next_after: p.next_after, observed_at: p.observed_at, scanned: p.scanned };
}
