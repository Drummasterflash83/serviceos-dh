export type ExactSiteReceipt =
  | { state: "linked"; siteId: string; linkId: string; sourceVersionId: string; auditId: string }
  | { state: "review"; reason: string };
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const sourceId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const reasonCode = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z_]{0,79}$/.test(value);
const unavailable = () => Error("The exact work-site result could not be verified. Refresh the source and audit before retrying.");
type Rpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };

/** Confirm one version of one retained workaddress after the human reviews its exact parent ID. */
export async function applyExactSite(db: Rpc, input: {
  tenant: string; connection: string; external: string; version: string; reason: string;
}): Promise<ExactSiteReceipt> {
  if (!uuid(input.tenant) || !uuid(input.connection) || !sourceId(input.external) ||
    !uuid(input.version) || input.reason.trim().length < 3 || input.reason.trim().length > 500)
    throw unavailable();
  const { data, error } = await db.rpc("new_dawn_commusoft_exact_site_apply", {
    p_tenant: input.tenant, p_connection: input.connection, p_external: input.external,
    p_version: input.version, p_reason: input.reason.trim(),
  });
  if (error || !record(data)) throw unavailable();
  if (data.state === "review" && reasonCode(data.reason))
    return { state: "review", reason: data.reason };
  if (data.state === "linked" && uuid(data.site_id) && uuid(data.link_id) &&
    uuid(data.audit_id) && data.source_version_id === input.version)
    return { state: "linked", siteId: data.site_id, linkId: data.link_id,
      sourceVersionId: input.version, auditId: data.audit_id };
  throw unavailable();
}

/** Restore an operator-confirmed exact site link that was previously reversed. */
export async function restoreExactSite(db: Rpc, input: {
  tenant: string; linkId: string; reason: string;
}): Promise<{ state: "restored"; linkId: string; auditId: string } | { state: "review"; reason: string }> {
  if (!uuid(input.tenant) || !uuid(input.linkId) || input.reason.trim().length < 3 ||
      input.reason.trim().length > 500) throw unavailable();
  const { data, error } = await db.rpc("new_dawn_commusoft_exact_site_toggle", {
    p_tenant: input.tenant, p_link: input.linkId, p_action: "restore",
    p_reason: input.reason.trim(),
  });
  if (error || !record(data)) throw unavailable();
  if (data.state === "review" && reasonCode(data.reason))
    return { state: "review", reason: data.reason };
  if (data.state === "restored" && data.link_id === input.linkId && uuid(data.audit_id))
    return { state: "restored", linkId: input.linkId, auditId: data.audit_id };
  throw unavailable();
}
