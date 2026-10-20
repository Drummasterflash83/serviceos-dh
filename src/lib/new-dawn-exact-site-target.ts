type Rpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const sourceId = (v: unknown): v is string => typeof v === "string" && /^[1-9][0-9]{0,15}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const code = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-z_]{0,79}$/.test(v);

export type ExactSiteTarget = {
  state: "ready" | "linked_current" | "legacy_current" | "reversed_valid" | "review";
  version: string | null;
  parent: string | null;
  address: string | null;
  linkId: string | null;
  auditId: string;
  reason: string | null;
  observedAt: string;
};

/** An audited, scope-checked read. Its state is advisory; apply/restore rechecks all facts. */
export async function loadExactSiteTarget(db: Rpc, input: {
  tenant: string; connection: string; external: string; reason: string;
}): Promise<ExactSiteTarget> {
  if (!uuid(input.tenant) || !uuid(input.connection) || !sourceId(input.external) ||
      input.reason.trim().length < 3 || input.reason.trim().length > 500)
    throw Error("The exact site review scope is invalid.");
  const { data, error } = await db.rpc("new_dawn_m2_exact_site_target_review", {
    p_tenant: input.tenant, p_connection: input.connection,
    p_external: input.external, p_reason: input.reason.trim(),
  });
  if (error || !object(data) || data.version !== "new-dawn-exact-site-target/1" ||
      data.tenant_id !== input.tenant || data.connection_id !== input.connection ||
      data.external_id !== input.external || !uuid(data.actor_id) || !uuid(data.audit_id) ||
      typeof data.observed_at !== "string" || !Number.isFinite(Date.parse(data.observed_at)) ||
      !["ready", "linked_current", "legacy_current", "reversed_valid", "review"].includes(String(data.state)) ||
      !(data.source_version_id === null || uuid(data.source_version_id)) ||
      !(data.recorded_parent_id === null || sourceId(data.recorded_parent_id)) ||
      !(data.source_address_line === null ||
        (typeof data.source_address_line === "string" && data.source_address_line.length <= 1000)) ||
      !(data.link_id === null || uuid(data.link_id)) ||
      !(data.reason === null || code(data.reason)))
    throw Error("The exact site review result is unavailable. Refresh before acting.");
  const state = data.state as ExactSiteTarget["state"];
  if ((state === "ready" && data.link_id !== null) ||
      (["linked_current", "legacy_current", "reversed_valid"].includes(state) && !uuid(data.link_id)) ||
      (state !== "review" && (!uuid(data.source_version_id) || !sourceId(data.recorded_parent_id))) ||
      (state === "review" && !code(data.reason)))
    throw Error("The exact site review result is inconsistent. Refresh before acting.");
  return { state, version: data.source_version_id as string | null,
    parent: data.recorded_parent_id as string | null,
    address: data.source_address_line as string | null,
    linkId: data.link_id as string | null, auditId: data.audit_id as string,
    reason: data.reason as string | null, observedAt: data.observed_at as string };
}
