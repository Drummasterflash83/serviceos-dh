export type ExactJobLinkReceipt =
  | { state: "linked"; jobId: string; linkId: string; auditId: string; versionId: string }
  | { state: "already_linked"; jobId: string; linkId: string; versionId: string }
  | { state: "review"; reason: string };
export type ExactJobReverseReceipt =
  | { state: "reversed"; linkId: string; auditId: string }
  | { state: "already_reversed"; linkId: string }
  | { state: "review"; reason: string };

const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const sourceId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const reasonCode = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z_]{0,79}$/.test(value);
const unavailable = () => Error("The exact job-link result could not be verified. Refresh its source and audit before retrying.");
type Rpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };

/** The database alone decides whether both current source IDs map uniquely. */
export async function applyExactJobLink(db: Rpc, input: {
  tenant: string; connection: string; external: string; version: string; reason: string;
}): Promise<ExactJobLinkReceipt> {
  if (!uuid(input.tenant) || !uuid(input.connection) || !sourceId(input.external) ||
    !uuid(input.version) || input.reason.trim().length < 3 || input.reason.trim().length > 500)
    throw unavailable();
  const { data, error } = await db.rpc("new_dawn_commusoft_exact_link_apply", {
    p_tenant: input.tenant, p_connection: input.connection, p_external: input.external,
    p_version: input.version, p_reason: input.reason.trim(),
  });
  if (error || !record(data)) throw unavailable();
  if (data.state === "review" && reasonCode(data.reason))
    return { state: "review", reason: data.reason };
  if (data.state === "linked" && data.rule === "commusoft_exact_dual_id_v1" &&
    uuid(data.job_id) && uuid(data.link_id) && uuid(data.audit_id) &&
    data.version_id === input.version)
    return { state: "linked", jobId: data.job_id, linkId: data.link_id,
      auditId: data.audit_id, versionId: input.version };
  if (data.state === "already_linked" && uuid(data.job_id) && uuid(data.link_id) &&
    data.version_id === input.version)
    return { state: "already_linked", jobId: data.job_id,
      linkId: data.link_id, versionId: input.version };
  throw unavailable();
}

/** Reversal hides the current source link; all source, job and audit rows remain. */
export async function reverseExactJobLink(db: Rpc, input: {
  tenant: string; link: string; reason: string;
}): Promise<ExactJobReverseReceipt> {
  if (!uuid(input.tenant) || !uuid(input.link) ||
    input.reason.trim().length < 3 || input.reason.trim().length > 500) throw unavailable();
  const { data, error } = await db.rpc("new_dawn_commusoft_exact_link_toggle", {
    p_tenant: input.tenant, p_link: input.link, p_action: "reverse",
    p_reason: input.reason.trim(),
  });
  if (error || !record(data)) throw unavailable();
  if (data.state === "review" && reasonCode(data.reason))
    return { state: "review", reason: data.reason };
  if (data.state === "reversed" && data.link_id === input.link && uuid(data.audit_id))
    return { state: "reversed", linkId: input.link, auditId: data.audit_id };
  if (data.state === "already_reversed" && data.link_id === input.link)
    return { state: "already_reversed", linkId: input.link };
  throw unavailable();
}
