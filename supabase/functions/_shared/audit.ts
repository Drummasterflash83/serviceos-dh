// writeAudit — the single shared writer for the append-only audit_logs table.
// Used by governance-sensitive Edge Functions (work transitions, View-As, superadmin
// actions) so every authority-bearing action records WHO did WHAT, in which tenant,
// with the real authenticated actor — even when a View-As preview context is active.
//
// deno-lint-ignore no-explicit-any
type Admin = any;

export interface AuditEntry {
  tenantId: string;
  actor: string;                 // real authenticated actor (email|userId) — NEVER the viewed subject
  action: string;                // e.g. 'work.transition.complete', 'view_as.open'
  resourceType: string;          // 'intelligence_object' | 'view_as_context' | ...
  resourceId?: string | null;
  status?: "ok" | "denied" | "error";
  detail?: Record<string, unknown>;
}

export async function writeAudit(admin: Admin, e: AuditEntry): Promise<void> {
  try {
    await admin.from("audit_logs").insert({
      tenant_id: e.tenantId,
      actor: e.actor,
      action: e.action,
      resource_type: e.resourceType,
      resource_id: e.resourceId ?? null,
      status: e.status ?? "ok",
      detail: e.detail ?? {},
    });
  } catch (_err) {
    // Audit is best-effort and must never break the primary action; the caller has
    // already enforced authority. A failed audit insert is logged, not fatal.
    console.error("writeAudit failed", e.action, _err);
  }
}
