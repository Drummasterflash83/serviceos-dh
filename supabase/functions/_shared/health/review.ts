// ServiceOS — Customer Health: Chris-only shadow surface read + governed review.
//
// Impure (service-role). Reads the shadow surface for the Tenant-Superadmin and applies
// review decisions as APPEND-ONLY history. Correction-class decisions also append a
// canonical `corrections` row (fed to existing learning), linked from the decision.
// NOTE: `corrections` is readable by any authenticated tenant user (its existing RLS),
// so correction content is NOT Chris-only — a documented, deliberate learning feed.
// It never deletes evidence, never creates canonical Actions/Outcomes/notifications.
//
// EVERY write checks its error. Writes are ordered so a later failure cannot leave a
// silently-misleading current state: corrections append FIRST (pure learning, safe to
// orphan), then the proposal update, then the decision row, then any reassessment.
// A failure after the proposal update returns a typed partial-failure ({partial:true})
// rather than a false success — atomic execution is deliberately out of scope here.
//
// UNDO (Option B, documented choice): a resolution confirmation can NOT be undone.
// Undoing `confirm_resolution` would leave the appended 'recovering' assessment
// falsely describing Customer Health; a truthful reversal needs a governed
// correction/reopen operation (Track B). All other latest decisions can be undone.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { assertShadowSafe } from "./shadow_safety.ts";
import { reassessAggregate } from "./aggregate.ts";

// The review path's COMPLETE write surface, asserted against the shadow allowlist at
// module load — the same checkable invariant the candidate store enforces per write.
// Any future write to a new table must be added here (and pass the allowlist) first.
const REVIEW_WRITE_TABLES = [
  "health_commitment_proposals",
  "health_proposal_decisions",
  "health_assessments",
  "corrections",
] as const;
{
  const safety = assertShadowSafe(REVIEW_WRITE_TABLES);
  if (!safety.safe) {
    throw new Error(`review write surface violates shadow safety: ${safety.offending.join(", ")}`);
  }
}

export type ReviewDecision =
  | "confirm"
  | "reject"
  | "correct"
  | "correct_responsibility"
  | "correct_due"
  | "attach"
  | "needs_context"
  | "defer"
  | "confirm_resolution"
  | "undo";

const DECISION_TO_STATE: Record<Exclude<ReviewDecision, "undo">, string> = {
  confirm: "confirmed",
  reject: "rejected",
  correct: "corrected",
  correct_responsibility: "corrected",
  correct_due: "corrected",
  attach: "attached",
  needs_context: "needs_context",
  defer: "deferred",
  confirm_resolution: "resolved_shadow",
};

// Which decisions also emit a canonical `corrections` learning row.
const CORRECTION_CLASS = new Set<ReviewDecision>([
  "reject",
  "correct",
  "correct_responsibility",
  "correct_due",
]);

// ── Surface read. ───────────────────────────────────────────────────────────
export async function loadShadowSurface(db: SupabaseClient, tenantId: string): Promise<unknown> {
  const { data: objects } = await db
    .from("health_objects")
    .select("id, subject_type, subject_id, active_policy_version_id, accountable_ref, updated_at")
    .eq("tenant_id", tenantId)
    .eq("health_type", "customer_health")
    .order("updated_at", { ascending: false })
    .limit(200);

  const objIds = (objects ?? []).map((o) => o.id as string);
  if (objIds.length === 0) return { objects: [] };

  const [{ data: assessments }, { data: proposals }] = await Promise.all([
    db
      .from("health_assessments")
      .select(
        "id, health_object_id, state, trend, drivers, risks, opportunities, confidence, freshness, evidence, changed, evaluated_at, supersedes_id",
      )
      .in("health_object_id", objIds)
      .order("evaluated_at", { ascending: false }),
    db
      .from("health_commitment_proposals")
      .select(
        "id, health_object_id, commitment_type, proposed_title, proposed_outcome, proposed_done_when, proposed_due_at, proposed_accountable_ref, state, confidence, ambiguity, group_key, resolution_state, created_at, updated_at",
      )
      .in("health_object_id", objIds)
      .order("updated_at", { ascending: false }),
  ]);

  const propIds = (proposals ?? []).map((p) => p.id as string);
  const [{ data: sources }, { data: decisions }] = await Promise.all([
    propIds.length
      ? db
          .from("health_proposal_sources")
          .select(
            "id, proposal_id, source_kind, source_ref, role, excerpt, confidence, observed_at",
          )
          .in("proposal_id", propIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    propIds.length
      ? db
          .from("health_proposal_decisions")
          .select(
            "id, proposal_id, decision, actor, from_state, to_state, reason, created_at, supersedes_id",
          )
          .in("proposal_id", propIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const latestByObj = new Map<string, Record<string, unknown>>();
  const historyByObj = new Map<string, Record<string, unknown>[]>();
  for (const a of assessments ?? []) {
    const k = a.health_object_id as string;
    if (!latestByObj.has(k)) latestByObj.set(k, a);
    (historyByObj.get(k) ?? historyByObj.set(k, []).get(k)!).push(a);
  }
  const sourcesByProp = new Map<string, Record<string, unknown>[]>();
  for (const s of sources ?? [])
    (
      sourcesByProp.get(s.proposal_id as string) ??
      sourcesByProp.set(s.proposal_id as string, []).get(s.proposal_id as string)!
    ).push(s);
  const decisionsByProp = new Map<string, Record<string, unknown>[]>();
  for (const d of decisions ?? [])
    (
      decisionsByProp.get(d.proposal_id as string) ??
      decisionsByProp.set(d.proposal_id as string, []).get(d.proposal_id as string)!
    ).push(d);
  const propsByObj = new Map<string, Record<string, unknown>[]>();
  for (const p of proposals ?? []) {
    (
      propsByObj.get(p.health_object_id as string) ??
      propsByObj.set(p.health_object_id as string, []).get(p.health_object_id as string)!
    ).push({
      ...p,
      sources: sourcesByProp.get(p.id as string) ?? [],
      decisions: decisionsByProp.get(p.id as string) ?? [],
    });
  }

  return {
    objects: (objects ?? []).map((o) => ({
      ...o,
      latestAssessment: latestByObj.get(o.id as string) ?? null,
      assessmentHistory: historyByObj.get(o.id as string) ?? [],
      proposals: propsByObj.get(o.id as string) ?? [],
    })),
  };
}

// ── Governed review decision (append-only). ─────────────────────────────────
export interface ReviewInput {
  proposalId: string;
  decision: ReviewDecision;
  actor: string;
  actorMemberId?: string | null;
  reason?: string | null;
  // correction payloads
  correctedTitle?: string | null;
  correctedOutcome?: string | null;
  correctedResponsibility?: Record<string, unknown> | null;
  correctedDueAt?: string | null;
  attachToProposalId?: string | null;
  /** Injected clock (defaults to Date.now()); keeps the resolution reassessment testable. */
  nowMs?: number;
}

// Proposal states from which a shadow resolution confirmation is valid. Terminal
// rejected/superseded proposals cannot be "resolved"; an already-resolved proposal is
// handled idempotently (no duplicate decision, no duplicate assessment).
const RESOLUTION_ELIGIBLE_STATES = new Set([
  "proposed",
  "confirmed",
  "corrected",
  "attached",
  "needs_context",
  "deferred",
  "resolution_possible",
]);

export type ReviewResult =
  | { ok: true; decisionId: string; toState: string; idempotent?: boolean }
  | { ok: false; error: string; partial?: boolean };

export async function applyReviewDecision(
  db: SupabaseClient,
  tenantId: string,
  input: ReviewInput,
): Promise<ReviewResult> {
  const nowMs = input.nowMs ?? Date.now();
  // ── Validate the decision verb and its payload BEFORE any write. ──────────
  const isUndo = input.decision === "undo";
  if (!isUndo && !Object.prototype.hasOwnProperty.call(DECISION_TO_STATE, input.decision)) {
    return { ok: false, error: `unknown decision '${String(input.decision)}'` };
  }
  // Normalise payloads first: blank/whitespace strings and empty objects are MISSING,
  // not values — an empty correction must never reach the learning table.
  const trimOrNull = (v: string | null | undefined) =>
    typeof v === "string" && v.trim().length > 0 ? v : null;
  const correctedTitle = trimOrNull(input.correctedTitle);
  const correctedOutcome = trimOrNull(input.correctedOutcome);
  const correctedDueAt = trimOrNull(input.correctedDueAt);
  const attachToProposalId = trimOrNull(input.attachToProposalId);
  const correctedResponsibility =
    input.correctedResponsibility && Object.keys(input.correctedResponsibility).length > 0
      ? input.correctedResponsibility
      : null;

  // Correction-class decisions REQUIRE their payload.
  if (input.decision === "correct" && correctedTitle == null && correctedOutcome == null) {
    return { ok: false, error: "correct requires corrected_title and/or corrected_outcome" };
  }
  if (input.decision === "correct_responsibility" && correctedResponsibility == null) {
    return { ok: false, error: "correct_responsibility requires corrected_responsibility" };
  }
  if (input.decision === "correct_due" && correctedDueAt == null) {
    return { ok: false, error: "correct_due requires corrected_due_at" };
  }
  if (input.decision === "attach" && !attachToProposalId) {
    return { ok: false, error: "attach requires attach_to_proposal_id" };
  }

  const { data: prop, error: propErr } = await db
    .from("health_commitment_proposals")
    .select(
      "id, health_object_id, state, proposed_title, proposed_outcome, proposed_accountable_ref, proposed_due_at, resolution_state, attributes, policy_version_id",
    )
    .eq("id", input.proposalId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (propErr) return { ok: false, error: `proposal lookup failed: ${propErr.message}` };
  if (!prop) return { ok: false, error: "proposal not found in tenant" };

  const before: Record<string, unknown> = {
    state: prop.state,
    proposed_title: prop.proposed_title,
    proposed_outcome: prop.proposed_outcome,
    proposed_accountable_ref: prop.proposed_accountable_ref,
    proposed_due_at: prop.proposed_due_at,
    resolution_state: prop.resolution_state,
    attributes: prop.attributes,
  };

  // ── Undo: supersede the latest decision and revert the proposal. ──────────
  if (isUndo) {
    const { data: last, error: lastErr } = await db
      .from("health_proposal_decisions")
      .select("id, before, decision")
      .eq("proposal_id", input.proposalId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastErr) return { ok: false, error: `decision lookup failed: ${lastErr.message}` };
    if (!last) return { ok: false, error: "no decision to undo" };
    // Option B: resolution confirmation is NOT undoable — the appended 'recovering'
    // assessment would be left falsely describing Customer Health. A governed
    // correction/reopen operation (Track B) is the truthful path.
    if (last.decision === "confirm_resolution") {
      return {
        ok: false,
        error:
          "a resolution confirmation cannot be undone — reopening a resolved obligation requires a governed correction (not part of Track A)",
      };
    }
    const revertTo = (last.before as Record<string, unknown>) ?? {};
    const updates: Record<string, unknown> = {};
    for (const k of [
      "state",
      "proposed_title",
      "proposed_outcome",
      "proposed_accountable_ref",
      "proposed_due_at",
      "resolution_state",
      "attributes",
    ]) {
      if (k in revertTo) updates[k] = revertTo[k];
    }
    if (Object.keys(updates).length) {
      const { error: updErr } = await db
        .from("health_commitment_proposals")
        .update(updates)
        .eq("id", input.proposalId);
      if (updErr) return { ok: false, error: `undo revert failed: ${updErr.message}` };
    }
    const { data: dec, error } = await db
      .from("health_proposal_decisions")
      .insert({
        tenant_id: tenantId,
        proposal_id: input.proposalId,
        health_object_id: prop.health_object_id,
        decision: "undo",
        actor: input.actor,
        actor_member_id: input.actorMemberId ?? null,
        from_state: prop.state,
        to_state: (updates.state as string) ?? prop.state,
        before,
        after: updates,
        reason: input.reason ?? "Undo latest decision",
        supersedes_id: last.id,
      })
      .select("id")
      .single();
    if (error) {
      // The revert already applied; the missing history row is a PARTIAL failure.
      return {
        ok: false,
        partial: true,
        error: `undo applied but history append failed: ${error.message}`,
      };
    }
    return {
      ok: true,
      decisionId: dec!.id as string,
      toState: (updates.state as string) ?? (prop.state as string),
    };
  }

  // ── confirm_resolution governance. ────────────────────────────────────────
  if (input.decision === "confirm_resolution") {
    // Idempotent repeat: already verified+resolved ⇒ succeed while REPAIRING any
    // missing artefact from an earlier partial failure. A prior run may have updated
    // the proposal but failed on the decision insert or the recovering assessment —
    // an early return here would strand that state forever, so the repeat
    // idempotently re-ensures both (the assessment insert is hash-deduped; the
    // decision insert only runs when no confirm_resolution row exists yet).
    if (prop.state === "resolved_shadow" && prop.resolution_state === "verified") {
      const { data: existing, error: exErr } = await db
        .from("health_proposal_decisions")
        .select("id")
        .eq("proposal_id", input.proposalId)
        .eq("decision", "confirm_resolution")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (exErr) return { ok: false, error: `decision lookup failed: ${exErr.message}` };
      let decisionId = (existing?.id as string | undefined) ?? null;
      if (!decisionId) {
        const { data: dec, error: decErr } = await db
          .from("health_proposal_decisions")
          .insert({
            tenant_id: tenantId,
            proposal_id: input.proposalId,
            health_object_id: prop.health_object_id,
            decision: "confirm_resolution",
            actor: input.actor,
            actor_member_id: input.actorMemberId ?? null,
            from_state: prop.state,
            to_state: "resolved_shadow",
            before,
            after: before,
            reason:
              input.reason ?? "Idempotent repair — history row was missing after a partial failure",
            correction_id: null,
          })
          .select("id")
          .single();
        if (decErr) return { ok: false, error: `repair decision append failed: ${decErr.message}` };
        decisionId = dec!.id as string;
      }
      const assessErrMsg = await reassessAfterResolution(db, tenantId, prop, input.actor, nowMs);
      if (assessErrMsg) {
        return { ok: false, partial: true, error: assessErrMsg };
      }
      return { ok: true, decisionId, toState: "resolved_shadow", idempotent: true };
    }
    if (!RESOLUTION_ELIGIBLE_STATES.has(prop.state as string)) {
      return {
        ok: false,
        error: `proposal in state '${prop.state}' is not eligible for resolution confirmation`,
      };
    }
  }

  const toState = DECISION_TO_STATE[input.decision];

  // Build proposal updates for correction-class + resolution decisions.
  const updates: Record<string, unknown> = { state: toState };
  if (input.decision === "correct") {
    if (correctedTitle != null) updates.proposed_title = correctedTitle;
    if (correctedOutcome != null) updates.proposed_outcome = correctedOutcome;
  }
  if (input.decision === "correct_responsibility") {
    updates.proposed_accountable_ref = correctedResponsibility;
  }
  if (input.decision === "correct_due") {
    updates.proposed_due_at = correctedDueAt;
  }
  if (input.decision === "attach") {
    // Attach target must be a real proposal in the SAME tenant (and not itself).
    if (attachToProposalId === input.proposalId) {
      return { ok: false, error: "a proposal cannot be attached to itself" };
    }
    const { data: target, error: targetErr } = await db
      .from("health_commitment_proposals")
      .select("id")
      .eq("id", attachToProposalId!)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (targetErr) return { ok: false, error: `attach target lookup failed: ${targetErr.message}` };
    if (!target) return { ok: false, error: "attach target proposal not found in tenant" };
    const attrs = (prop.attributes as Record<string, unknown> | null) ?? {};
    updates.attributes = { ...attrs, attached_to: attachToProposalId };
  }
  if (input.decision === "confirm_resolution") {
    updates.resolution_state = "verified";
  }

  const after: Record<string, unknown> = { ...before, ...updates };

  // ── Ordered writes, every error checked. ──────────────────────────────────
  // 1) Correction-class → append the canonical corrections row FIRST (append-only
  //    learning; safe if later steps fail — it references only the health object).
  let correctionId: string | null = null;
  if (CORRECTION_CLASS.has(input.decision)) {
    const { data: corr, error: corrErr } = await db
      .from("corrections")
      .insert({
        tenant_id: tenantId,
        object_id: prop.health_object_id, // soft ref to the Health Object
        before,
        after,
        correction_kind: "engine_mistake",
        scope_hint: `customer_health.callback.${input.decision}`,
        actor: input.actor,
        review_level: "tenant_superadmin",
      })
      .select("id")
      .maybeSingle();
    if (corrErr) return { ok: false, error: `correction append failed: ${corrErr.message}` };
    correctionId = (corr?.id as string | undefined) ?? null;
  }

  // 2) Proposal current-state update.
  const { error: updErr } = await db
    .from("health_commitment_proposals")
    .update(updates)
    .eq("id", input.proposalId);
  if (updErr) return { ok: false, error: `proposal update failed: ${updErr.message}` };

  // 3) Append-only decision history.
  const { data: dec, error } = await db
    .from("health_proposal_decisions")
    .insert({
      tenant_id: tenantId,
      proposal_id: input.proposalId,
      health_object_id: prop.health_object_id,
      decision: input.decision,
      actor: input.actor,
      actor_member_id: input.actorMemberId ?? null,
      from_state: prop.state,
      to_state: toState,
      before,
      after,
      reason: input.reason ?? null,
      correction_id: correctionId,
    })
    .select("id")
    .single();
  if (error) {
    return {
      ok: false,
      partial: true,
      error: `proposal updated but decision append failed — history is incomplete: ${error.message}`,
    };
  }

  // 4) Reassessment follows a verified shadow resolution — the AGGREGATE Customer
  //    Health, so a customer with another callback still open is NOT shown recovering.
  if (input.decision === "confirm_resolution") {
    const assessErrMsg = await reassessAfterResolution(db, tenantId, prop, input.actor, nowMs);
    if (assessErrMsg) {
      return { ok: false, partial: true, error: assessErrMsg };
    }
  }

  return { ok: true, decisionId: dec!.id as string, toState };
}

/**
 * Reassess whole-customer Health after a shadow resolution. Delegates to the aggregate
 * evaluator (all live obligations), so resolving one callback while another remains
 * open keeps the customer on the remaining risk — recovering only when all are cleared.
 * Hash-idempotent (retries collapse). Returns an error message, or null on success.
 */
async function reassessAfterResolution(
  db: SupabaseClient,
  tenantId: string,
  prop: { id: string; health_object_id: string; policy_version_id?: string | null },
  actor: string,
  nowMs: number,
): Promise<string | null> {
  const res = await reassessAggregate(db, tenantId, prop.health_object_id, {
    policyVersionId: prop.policy_version_id ?? null,
    nowMs,
    triggeredBy: "resolution",
    extraEvidence: [
      {
        source: "review",
        detail: `Callback confirmed by ${actor} via shadow review — reviewer-verified, not a source-verified outcome.`,
      },
    ],
  });
  return res.ok ? null : `resolution recorded but health reassessment failed: ${res.error}`;
}
