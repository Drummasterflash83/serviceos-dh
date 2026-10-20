export const drummondsTenantId = "00000000-0000-0000-0000-000000000001";

export type MdViewReceipt = {
  tenantId: string;
  actorId: string;
  auditId: string;
  openedAt: string;
  expiresAt: string;
};

const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);

export function readMdViewReceipt(value: unknown, actor: string, now = Date.now()): MdViewReceipt {
  if (!object(value) || value.version !== "new-dawn-drummonds-md-view/1" ||
    value.tenant_id !== drummondsTenantId || value.actor_id !== actor ||
    !uuid(value.audit_id) || value.read_only !== true ||
    typeof value.opened_at !== "string" || typeof value.expires_at !== "string")
    throw Error("MD view unavailable");
  const opened = Date.parse(value.opened_at), expires = Date.parse(value.expires_at);
  if (!Number.isFinite(opened) || !Number.isFinite(expires) ||
    opened > now + 60_000 || opened < now - 60_000 ||
    expires <= now || expires > opened + 15 * 60_000 + 1000)
    throw Error("MD view unavailable");
  return {
    tenantId: drummondsTenantId, actorId: actor, auditId: value.audit_id,
    openedAt: value.opened_at, expiresAt: value.expires_at,
  };
}
