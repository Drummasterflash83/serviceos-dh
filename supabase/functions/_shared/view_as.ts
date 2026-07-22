// view_as — the PURE authorization core of secure View-As.
//
// A Tenant Superadmin opens a short-lived, read-only preview of what another user/role/
// team/permission-profile/unassigned-user sees. The context is server-resolved: the real
// actor's JWT is always retained, the browser never receives the worker/service secret,
// and RLS is never bypassed in the browser. This module makes the entry checks + usability
// checks unit-provable (no IO). The Edge Function performs the loads and writes.
//
// deno-lint-ignore-file no-explicit-any
export const VIEW_AS_MAX_MINUTES = 30;
export const SUBJECT_KINDS = ["user", "role", "team", "permission_profile", "unassigned"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];
export type ViewMode = "view" | "supervised_test";

export interface OpenInput {
  actorIsSuperadmin: boolean;   // actor holds an ACTIVE tenant.superadmin grant
  actorTenantId: string;
  subjectKind: string;
  subjectTenantId: string | null; // tenant the subject belongs to (null for 'unassigned')
  mode: string;                 // 'view' | 'supervised_test'
  supervisedAllowed: boolean;   // supervised_test is separately permissioned; default false
}
export interface OpenDecision {
  ok: boolean; code?: string; message?: string;
  mode?: ViewMode; readOnly?: boolean; expiresInMinutes?: number;
}

export function authorizeOpen(i: OpenInput): OpenDecision {
  if (!i.actorIsSuperadmin) return { ok: false, code: "forbidden", message: "View-As requires Tenant Superadmin" };
  if (!SUBJECT_KINDS.includes(i.subjectKind as SubjectKind)) return { ok: false, code: "bad_request", message: `invalid subject_kind: ${i.subjectKind}` };
  // Same-tenant only (an unassigned subject represents a not-yet-bound profile in THIS tenant).
  if (i.subjectKind !== "unassigned" && i.subjectTenantId !== i.actorTenantId) {
    return { ok: false, code: "cross_tenant", message: "subject belongs to a different tenant" };
  }
  const mode = i.mode === "supervised_test" ? "supervised_test" : "view";
  if (mode === "supervised_test" && !i.supervisedAllowed) {
    return { ok: false, code: "supervised_not_permitted", message: "supervised test mode is separately permissioned" };
  }
  // Default is read-only. Supervised test mode is still gated by normal policy/approval at
  // the write path; it does NOT relax RLS or permit destructive/external actions here.
  return { ok: true, mode, readOnly: mode === "view", expiresInMinutes: VIEW_AS_MAX_MINUTES };
}

export interface UsabilityInput { ended_at: string | null; expires_at: string; read_only: boolean; actor_user_id: string; }
export interface Usability { usable: boolean; reason?: string; readOnly: boolean; }
/** A context is usable only if it is the actor's own, not exited, and not expired. */
export function isContextUsable(ctx: UsabilityInput, callerUserId: string, now: number): Usability {
  if (ctx.actor_user_id !== callerUserId) return { usable: false, reason: "not_actor", readOnly: true };
  if (ctx.ended_at) return { usable: false, reason: "ended", readOnly: ctx.read_only };
  if (Date.parse(ctx.expires_at) <= now) return { usable: false, reason: "expired", readOnly: ctx.read_only };
  return { usable: true, readOnly: ctx.read_only };
}

/** Read-only contexts reject any state-changing action outright (server-side belt-and-braces). */
export function assertReadOnly(usable: Usability): { allowed: boolean; code?: string } {
  if (usable.readOnly) return { allowed: false, code: "read_only_context" };
  return { allowed: true };
}
