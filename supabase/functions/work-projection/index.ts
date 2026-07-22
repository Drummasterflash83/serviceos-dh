// ServiceOS — Edge Function: work-projection
//
// The Command Centre's single work list. Loads the caller's tenant-scoped canonical
// action objects (intelligence_objects, object_class='action'), FOLDS recommendations in
// as evidence (never a second queue), links each to its objective + health, then returns a
// role-scoped, explainably RANKED list plus the "my position now" counts. Read-only.
//
// Reuses resolveUserOwnership for the role/authority resolution (no logic duplicated) and
// the pure work_projection module for folding + ranking. Standard ApiResult shape.
//
// Runtime: Deno. Deploy with verify_jwt=false (auth enforced via requireTenantUser).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import { resolveUserOwnership } from "../_shared/ownership.ts";
import {
  foldRecommendations, projectWork, rankWork, DEFAULT_RANK_WEIGHTS,
  type ProjectionOwnership, type ProjectedWork,
} from "../_shared/work_projection.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-tenant-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });
const fail = (code: string, message: string, s: number) => json({ ok: false, error: { code, message } }, s);
const TERMINAL = new Set(["complete", "cancelled"]);

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = url && key ? createClient(url, key) : null;
  if (!admin) return fail("config_error", "Supabase admin client is not configured", 500);

  // Auth: all tenant roles may READ their Command Centre.
  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops", "viewer"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const { tenantId, userId } = auth.ctx;
  let userRef = auth.ctx.email ?? userId;
  const now = Date.now();

  let body: Row = {};
  try { body = ((await req.json()) ?? {}) as Row; } catch { body = {}; }

  // ── View-As re-scoping (read-only): a Tenant Superadmin previews another user's CC ──
  let effectiveUserId = userId;
  let effectiveRole: string | null = auth.ctx.role;
  let readOnly = false;
  let viewingAs: { kind: string; ref: string | null } | null = null;
  const viewCtxId = body.view_as_context_id ? String(body.view_as_context_id) : null;
  if (viewCtxId) {
    const { data: vctx } = await admin.from("view_as_context").select("*").eq("id", viewCtxId).eq("tenant_id", tenantId).maybeSingle();
    const usable = vctx && vctx.actor_user_id === userId && !vctx.ended_at && Date.parse(vctx.expires_at as string) > now;
    const { data: am } = await admin.from("team_members").select("id").eq("tenant_id", tenantId).eq("profile_id", userId).is("effective_to", null).maybeSingle();
    let isSuper = false;
    if (am) {
      const g = (await admin.from("authority_grants").select("effective_from, effective_to").eq("tenant_id", tenantId).eq("member_id", am.id).eq("permission", "tenant.superadmin")).data ?? [];
      isSuper = (g as Row[]).some((x) => (x.effective_from ? Date.parse(x.effective_from as string) : -Infinity) <= now && (x.effective_to ? Date.parse(x.effective_to as string) : Infinity) > now);
    }
    if (!vctx || !usable || !isSuper) return fail("view_as_invalid", "View-As context invalid, expired, or not permitted", 403);
    readOnly = true;
    viewingAs = { kind: vctx.subject_kind as string, ref: (vctx.subject_ref as string) ?? null };
    if (vctx.subject_kind === "user" && vctx.subject_ref) {
      effectiveUserId = vctx.subject_ref as string;
      effectiveRole = null;
      const { data: sp } = await admin.from("profiles").select("email").eq("id", effectiveUserId).maybeSingle();
      userRef = (sp?.email as string | null) ?? effectiveUserId;
    } else {
      effectiveUserId = "00000000-0000-0000-0000-000000000000"; // role/team/unassigned → honest empty ownership
      userRef = String(vctx.subject_ref ?? "unassigned");
    }
  }

  // ── ownership (reuse resolveUserOwnership; effective = subject when viewing) ──
  const { data: member } = await admin.from("team_members")
    .select("id, display_name, formal_role, observed_role, observed_status, authority_level, org_unit_id")
    .eq("tenant_id", tenantId).eq("profile_id", effectiveUserId).is("effective_to", null).maybeSingle();
  let responsibilities: Row[] = [], grants: Row[] = [], objectivesOwned: Row[] = [], teams: Row[] = [], managed: Row[] = [];
  const memberId = (member?.id as string | undefined) ?? null;
  if (memberId) {
    responsibilities = (await admin.from("responsibility_assignments")
      .select("kind, target_ref, label, raci_role, weekday_mask, cover_for, confidence, effective_from, effective_to")
      .eq("tenant_id", tenantId).eq("member_id", memberId)).data ?? [];
    const rawGrants = (await admin.from("authority_grants").select("permission, scope, scope_ref, effective_from, effective_to")
      .eq("tenant_id", tenantId).eq("member_id", memberId)).data ?? [];
    const perms = (await admin.from("authority_permissions").select("permission, category")).data ?? [];
    const catOf = new Map((perms as Row[]).map((p) => [p.permission, p.category]));
    grants = (rawGrants as Row[]).map((g) => ({ ...g, category: catOf.get(g.permission) ?? null }));
    const objRefs = (responsibilities as Row[]).filter((r) => r.kind === "objective" && r.target_ref).map((r) => r.target_ref);
    if (objRefs.length) objectivesOwned = (await admin.from("objectives").select("id, title, status").eq("tenant_id", tenantId).in("id", objRefs)).data ?? [];
    if (member?.org_unit_id) teams = (await admin.from("org_units").select("id, name").eq("id", member.org_unit_id)).data ?? [];
    if (["owner", "director"].includes(member?.authority_level)) managed = (await admin.from("team_members").select("id, display_name").eq("tenant_id", tenantId).neq("id", memberId).is("effective_to", null)).data ?? [];
  }
  const resolved = resolveUserOwnership({
    tenantId, userId: effectiveUserId, now: new Date(now).toISOString(), profileRole: effectiveRole,
    member: (member as Row) ?? null, responsibilities, authorityGrants: grants,
    objectives: objectivesOwned, teams, managedMembers: managed,
  });
  const perms = new Set(resolved.authority.map((a) => a.permission));
  const own: ProjectionOwnership = {
    userRef, memberId,
    authorityLevel: resolved.user.authorityLevel,
    isLeadership: ["director", "owner"].includes(resolved.user.authorityLevel ?? "") || perms.has("tenant.superadmin"),
    ownedObjectiveIds: new Set(resolved.objectives.map((o) => o.id)),
    responsibilityRefs: new Set(resolved.responsibilities.filter((r) => r.ref).map((r) => r.ref as string)),
    teamOrgUnitIds: new Set(resolved.teams.map((t) => t.id)),
    managedMemberIds: new Set(resolved.managedUsers.map((m) => m.id)),
    perms,
  };

  // ── canonical action objects ───────────────────────────────────────────────
  const actionTypes = (await admin.from("domain_object_types").select("domain, object_type").eq("object_class", "action")).data ?? [];
  const typeKeys = new Set(actionTypes.map((t: Row) => `${t.domain}:${t.object_type}`));
  const { data: rawActions } = await admin.from("intelligence_objects")
    .select("id, domain, object_type, subject, status, attributes, priority, confidence, deadline, responsible_ref, accountable_ref, waiting_on_ref, source_interactions, source_entities, updated_at")
    .eq("tenant_id", tenantId).limit(500);
  const actions = (rawActions ?? []).filter((a: Row) => typeKeys.has(`${a.domain}:${a.object_type}`) && !TERMINAL.has(a.status));
  const actionIds = actions.map((a: Row) => a.id);

  // objective links per action → objectives + health + a metric
  const links = actionIds.length
    ? (await admin.from("objective_links").select("objective_id, target_ref")
        .eq("tenant_id", tenantId).eq("target_kind", "intelligence_object").in("target_ref", actionIds)).data ?? []
    : [];
  const linksByAction = new Map<string, string[]>();
  for (const l of links as Row[]) { const a = linksByAction.get(l.target_ref) ?? []; a.push(l.objective_id); linksByAction.set(l.target_ref, a); }
  const objIds = [...new Set((links as Row[]).map((l) => l.objective_id))];
  const objectives = objIds.length ? (await admin.from("objectives").select("id, title, status").eq("tenant_id", tenantId).in("id", objIds)).data ?? [] : [];
  const objById = new Map((objectives as Row[]).map((o) => [o.id, o]));
  const health = objIds.length ? (await admin.from("objective_health").select("objective_id, status, evaluated_at").eq("tenant_id", tenantId).in("objective_id", objIds).order("evaluated_at", { ascending: false })).data ?? [] : [];
  const healthByObj = new Map<string, Row>();
  for (const h of health as Row[]) if (!healthByObj.has(h.objective_id)) healthByObj.set(h.objective_id, h);

  // recommendations (open) + related automation intents
  const recs = (await admin.from("recommendations").select("id, type, title, detail, severity, status, card_id, interaction_id, person_id, company_id, evidence, recommended_action, confidence, source_rule, due_at, created_at")
    .eq("tenant_id", tenantId).eq("status", "open").limit(500)).data ?? [];
  const fold = foldRecommendations(actions, recs as Row[], linksByAction);
  const intents = actionIds.length
    ? (await admin.from("automation_intents").select("id, status, action_object_id").eq("tenant_id", tenantId).in("action_object_id", actionIds)).data ?? []
    : [];
  const intentsByAction = new Map<string, Row[]>();
  for (const i of intents as Row[]) { const a = intentsByAction.get(i.action_object_id) ?? []; a.push(i); intentsByAction.set(i.action_object_id, a); }

  // ── project + rank ─────────────────────────────────────────────────────────
  const projected: ProjectedWork[] = actions.map((a: Row) => {
    const objId = (linksByAction.get(a.id) ?? [])[0] ?? null;
    return projectWork(a, {
      objective: objId ? objById.get(objId) ?? null : null,
      objectiveHealth: objId ? healthByObj.get(objId) ?? null : null,
      metric: null,
      team: null,
      evidenceRecs: fold.evidenceByAction.get(a.id) ?? [],
      relatedIntents: intentsByAction.get(a.id) ?? [],
      possibleDuplicateOf: fold.reviewRecs.filter((r) => r.candidateActionIds.includes(a.id)).map((r) => r.rec.id),
    }, now);
  });
  const ranked = rankWork(projected, own, DEFAULT_RANK_WEIGHTS, now);

  // ── "my position now" — real counts only ──────────────────────────────────
  const mineIds = new Set(ranked.filter((w) =>
    (w.accountableOwner && (w.accountableOwner === userRef || w.accountableOwner === memberId)) ||
    (w.operationalOwner && (w.operationalOwner === userRef || w.operationalOwner === memberId))).map((w) => w.id));
  const overdue = ranked.filter((w) => w.dueAt && Date.parse(w.dueAt) < now);
  const dueToday = ranked.filter((w) => w.dueAt && Date.parse(w.dueAt) >= now && Date.parse(w.dueAt) - now < 24 * 3.6e6);
  const waitingOnMe = ranked.filter((w) => mineIds.has(w.id) && (w.state === "waiting" || w.state === "blocked"));
  const blocked = ranked.filter((w) => w.state === "blocked");
  const activeAutomation = (intents as Row[]).filter((i) => ["pending", "claimed", "executing"].includes(i.status));
  const atRiskObjectives = [...healthByObj.values()].filter((h) => /risk|red|off|breach/i.test(h.status ?? "")).length;

  return json({
    ok: true,
    data: {
      generatedAt: new Date(now).toISOString(),
      weightsVersion: DEFAULT_RANK_WEIGHTS.version,
      readOnly,
      viewingAs,
      user: { userRef, memberId, displayName: resolved.user.displayName ?? null, role: effectiveRole ?? auth.ctx.role, formalRole: resolved.user.formalRole, isLeadership: own.isLeadership, authority: [...perms] },
      position: {
        urgent: overdue.length,
        dueToday: dueToday.length,
        waitingOnYou: waitingOnMe.length,
        handledAutomatically: 0, // real outcome-derived count wired when outcomes are surfaced; honest 0 until then
        automationActive: activeAutomation.length,
        blocked: blocked.length,
        objectivesAtRisk: atRiskObjectives,
      },
      doNext: ranked.slice(0, 7),
      all: ranked,
      consolidation: {
        recommendationsFoldedAsEvidence: [...fold.evidenceByAction.values()].reduce((n, a) => n + a.length, 0),
        standaloneRecommendations: fold.standaloneRecs.length,
        routedToReview: fold.reviewRecs.length,
      },
    },
  });
});
type Row = Record<string, unknown>;
