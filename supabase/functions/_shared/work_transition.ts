// decideWorkTransition — the PURE core of persistent work-item transitions.
//
// A "work item" is an intelligence_objects row of object_class='action'. Today the
// Command Centre mutates these only in local React state (acknowledge/dismiss/edit are
// LOCAL_ONLY and lost on refresh). This module is the deterministic decision the
// work-transition Edge Function persists to the append-only object_state_history ledger
// and the object row — no IO here (the caller loads rows and passes them in), so the
// transition matrix, authority gate and done_when gate are unit-provable.
//
// Universal: the legal state moves come from state_transitions DATA (the same reference
// Action lifecycle for ServiceOS and ProductOS). There is NO tenant/Drummond branch.
//
// Verb → effect:
//   acknowledge  proposed→ready            (a status move)
//   start        ready→in_progress
//   wait         in_progress→waiting       (needs waiting_on)
//   resume       waiting→in_progress
//   block        in_progress→blocked       (needs blocker)
//   unblock      blocked→in_progress
//   escalate     blocked→escalated
//   complete     in_progress→complete      (REQUIRES done_when + completion evidence, unless approved exception)
//   dismiss      <active>→cancelled        (needs reason)
//   accept       claim ownership (responsible=actor); if 'proposed', also →ready
//   assign       set responsible/accountable to a target member (needs work.assign / superadmin)
//   correct_owner    re-point accountable ref (needs ownership.confirm / superadmin); original preserved
//   correct_objective link/relink the served objective (needs ownership.confirm / superadmin); original preserved
//
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export type WorkVerb =
  | "acknowledge" | "start" | "wait" | "resume" | "block" | "unblock" | "escalate"
  | "complete" | "dismiss" | "accept" | "assign" | "correct_owner" | "correct_objective";

/** What the caller resolved about the actor (from resolveUserOwnership + the object's RACI). */
export interface ActorAuthority {
  userRef: string;          // stable actor ref recorded in history (email|userId|'service')
  isSuperadmin: boolean;    // holds tenant.superadmin (active grant)
  canAssign: boolean;       // work.assign
  canApprove: boolean;      // work.approve
  canConfirmOwnership: boolean; // ownership.confirm
  isAssignee: boolean;      // actor is responsible/accountable/waiting_on for THIS object
}

export interface TransitionInput {
  object: Row;                       // the intelligence_objects row (status, domain, object_type, attributes, *_ref)
  verb: WorkVerb;
  actor: ActorAuthority;
  legalTransitions: { from_state: string; to_state: string }[]; // state_transitions for (domain, object_type)
  reason?: string | null;            // required for dismiss / corrections
  evidence?: unknown;                // completion evidence, blocker note, waiting_on, etc.
  targetMemberRef?: string | null;   // assign / correct_owner target (team_members.id or role ref)
  targetObjectiveId?: string | null; // correct_objective target (objectives.id)
  approvedException?: boolean;        // complete without done_when — only with canApprove/superadmin
}

export interface HistoryWrite {
  from_state: string | null;
  to_state: string;
  actor: Record<string, unknown>;
  reason: string | null;
}
export interface TransitionDecision {
  ok: boolean;
  code?: string;              // stable error code when !ok
  message?: string;
  toStatus?: string;          // new intelligence_objects.status (may equal current for attribute corrections)
  statusChanged?: boolean;
  history?: HistoryWrite;     // append to object_state_history
  objectPatch?: Row;          // partial update to intelligence_objects (RACI hot cache, attributes)
  objectiveLink?: {           // upsert into objective_links (correct_objective)
    objectiveId: string; targetKind: "intelligence_object"; relation: string; rationale: string;
  };
}

const STATUS_VERB_TARGET: Partial<Record<WorkVerb, { to: string; requiresAssignee?: boolean }>> = {
  acknowledge: { to: "ready" },
  start: { to: "in_progress" },
  wait: { to: "waiting" },
  resume: { to: "in_progress" },
  block: { to: "blocked" },
  unblock: { to: "in_progress" },
  escalate: { to: "escalated" },
  complete: { to: "complete" },
  dismiss: { to: "cancelled" },
};

function legal(from: string, to: string, set: { from_state: string; to_state: string }[]): boolean {
  return set.some((t) => t.from_state === from && t.to_state === to);
}

const fail = (code: string, message: string): TransitionDecision => ({ ok: false, code, message });

export function decideWorkTransition(input: TransitionInput): TransitionDecision {
  const { object, verb, actor } = input;
  const current = String(object.status ?? "unknown");
  const actorStamp = { ref: actor.userRef, superadmin: actor.isSuperadmin };

  // ── attribute corrections & ownership claims (NOT status moves) ────────────
  if (verb === "accept") {
    // Claiming your queue is always allowed for a tenant member. If proposed, also advance.
    const patch: Row = { responsible_ref: { kind: "user", ref: actor.userRef } };
    let to = current, changed = false;
    if (current === "proposed" && legal("proposed", "ready", input.legalTransitions)) {
      to = "ready"; changed = true;
    }
    return {
      ok: true, toStatus: to, statusChanged: changed, objectPatch: patch,
      history: { from_state: current, to_state: to, actor: actorStamp, reason: input.reason ?? "accepted ownership" },
    };
  }

  if (verb === "assign") {
    if (!(actor.canAssign || actor.isSuperadmin)) {
      return fail("forbidden", "Assigning work to others requires work.assign authority");
    }
    if (!input.targetMemberRef) return fail("bad_request", "assign requires a target member");
    return {
      ok: true, toStatus: current, statusChanged: false,
      objectPatch: { responsible_ref: { kind: "member", ref: input.targetMemberRef } },
      history: { from_state: current, to_state: current, actor: actorStamp, reason: input.reason ?? `assigned to ${input.targetMemberRef}` },
    };
  }

  if (verb === "correct_owner") {
    if (!(actor.canConfirmOwnership || actor.isSuperadmin)) {
      return fail("forbidden", "Correcting ownership requires ownership.confirm authority");
    }
    if (!input.targetMemberRef) return fail("bad_request", "correct_owner requires a target member");
    if (!input.reason) return fail("bad_request", "correct_owner requires a reason (the original inference is preserved)");
    // Preserve the ORIGINAL inferred accountable in attributes for learning; re-point the hot cache.
    const originals = (object.attributes?.owner_corrections as unknown[]) ?? [];
    return {
      ok: true, toStatus: current, statusChanged: false,
      objectPatch: {
        accountable_ref: { kind: "member", ref: input.targetMemberRef },
        attributes: {
          ...(object.attributes ?? {}),
          owner_corrections: [...originals, { was: object.accountable_ref ?? null, by: actor.userRef, reason: input.reason }],
        },
      },
      history: { from_state: current, to_state: current, actor: actorStamp, reason: `owner corrected → ${input.targetMemberRef}: ${input.reason}` },
    };
  }

  if (verb === "correct_objective") {
    if (!(actor.canConfirmOwnership || actor.isSuperadmin)) {
      return fail("forbidden", "Correcting the served objective requires ownership.confirm authority");
    }
    if (!input.targetObjectiveId) return fail("bad_request", "correct_objective requires a target objective");
    if (!input.reason) return fail("bad_request", "correct_objective requires a reason (the original is preserved)");
    return {
      ok: true, toStatus: current, statusChanged: false,
      objectiveLink: {
        objectiveId: input.targetObjectiveId, targetKind: "intelligence_object",
        relation: "contributes_to", rationale: input.reason,
      },
      history: { from_state: current, to_state: current, actor: actorStamp, reason: `objective corrected → ${input.targetObjectiveId}: ${input.reason}` },
    };
  }

  // ── status moves — validated against the DATA-driven transition matrix ─────
  const target = STATUS_VERB_TARGET[verb];
  if (!target) return fail("unknown_verb", `Unsupported transition verb: ${verb}`);

  if (verb === "dismiss" && !input.reason) {
    return fail("bad_request", "dismiss requires a reason (source evidence is never erased)");
  }
  if (verb === "complete") {
    const doneWhen = (object.attributes?.done_when as string | undefined)?.trim();
    const hasEvidence = input.evidence != null && input.evidence !== "";
    if (!doneWhen && !(input.approvedException && (actor.canApprove || actor.isSuperadmin))) {
      return fail("done_when_required", "Completion requires a done_when definition, or an approved exception by a work.approve authority");
    }
    if (doneWhen && !hasEvidence) {
      return fail("evidence_required", "Completion requires evidence satisfying done_when");
    }
  }

  if (current === target.to) {
    return fail("noop", `Work item is already ${target.to}`);
  }
  if (!legal(current, target.to, input.legalTransitions)) {
    return fail("illegal_transition", `Cannot ${verb}: no legal move ${current} → ${target.to}`);
  }

  const patch: Row = {};
  if (verb === "block" && input.evidence) patch.attributes = { ...(object.attributes ?? {}), blocker: input.evidence };
  if (verb === "wait" && input.evidence) patch.waiting_on_ref = { kind: "note", ref: String(input.evidence) };
  if (verb === "complete" && input.evidence) {
    patch.attributes = { ...(object.attributes ?? {}), completion_evidence: input.evidence };
  }

  return {
    ok: true, toStatus: target.to, statusChanged: true,
    objectPatch: Object.keys(patch).length ? patch : undefined,
    history: { from_state: current, to_state: target.to, actor: actorStamp, reason: input.reason ?? null },
  };
}
