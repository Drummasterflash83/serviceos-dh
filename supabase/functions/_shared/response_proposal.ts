// ServiceOS — Response Proposal + Human Refinement (PURE model).
//
// The layer that lets a reviewer inspect and modify a proposed customer response BEFORE
// approving the automation intent. Three deterministic concerns, no DB / no network:
//
//   1. buildResponseProposal — the IMMUTABLE original AI draft artifact (body + provenance
//      + generated_at/version). Once built it is never edited; a human change is a new
//      revision, never a mutation of the proposal.
//   2. buildResponseRevision — a single human edit (edited body + editor identity +
//      timestamp + change reason), validated. Each edit is its own append-only fact.
//   3. resolveEffectiveResponse — the ONE body approval must execute: the latest human
//      revision if any, else the original AI draft. It preserves the original provenance
//      and records that a human refined it (a human_revision marker). This is what makes
//      "approve the reviewed version only" a pure, testable guarantee.
//
// A future model-based drafter or a richer edit UI can sit on top without changing this
// contract — same inputs, same {body, provenance, source} outputs.

export const RESPONSE_PROPOSAL_VERSION = "response-proposal/1";
export const MAX_BODY = 4000;
export const MAX_REASON = 500;

/** A pointer to the piece of context (or the human edit) that informed the body. */
export interface ProvenanceRef {
  kind: string; // customer_card | interaction | human_revision | …
  ref: string;
  note?: string;
}

// ── 1) The immutable original AI proposal ────────────────────────────────────

export interface ResponseProposal {
  channel: string;
  source_interaction: string;
  /** The original AI-drafted body — frozen at generation time. */
  original_body: string;
  /** Which business context informed the AI draft (carried through, never dropped). */
  provenance: ProvenanceRef[];
  /** The drafter version (e.g. response-draft/1) and this artifact's schema version. */
  draft_version: string;
  proposal_version: string;
  generated_by: string;
  generated_at: string;
}

export type BuildProposalResult =
  { ok: true; proposal: ResponseProposal } | { ok: false; error: string };

/**
 * Build the immutable original-proposal artifact. Refuses an empty body or a missing
 * source interaction (an unaddressed proposal is never recorded). Bounds the body so the
 * artifact never carries unbounded content. Deterministic.
 */
export function buildResponseProposal(input: {
  channel?: string;
  sourceInteraction: string | null | undefined;
  body: string | null | undefined;
  provenance?: ProvenanceRef[];
  draftVersion: string | null | undefined;
  generatedBy?: string | null;
  generatedAt: string;
}): BuildProposalResult {
  if (!input.body || !input.body.trim()) return { ok: false, error: "empty_body" };
  if (!input.sourceInteraction) return { ok: false, error: "no_source_interaction" };
  return {
    ok: true,
    proposal: {
      channel: input.channel ?? "email",
      source_interaction: input.sourceInteraction,
      original_body: input.body.slice(0, MAX_BODY),
      provenance: Array.isArray(input.provenance) ? input.provenance : [],
      draft_version: input.draftVersion ?? "unknown",
      proposal_version: RESPONSE_PROPOSAL_VERSION,
      generated_by: input.generatedBy ?? "response-assistant",
      generated_at: input.generatedAt,
    },
  };
}

// ── 2) A single human refinement (append-only) ───────────────────────────────

export interface ResponseRevision {
  revision_number: number;
  revised_body: string;
  editor_ref: string;
  editor_kind: string;
  change_reason: string | null;
  /** Lineage: what this edit was based on (the AI proposal or a prior revision). */
  based_on: "ai_proposal" | "revision";
  based_on_ref: string | null;
  created_at: string;
}

export type BuildRevisionResult =
  { ok: true; revision: ResponseRevision } | { ok: false; error: string };

/**
 * Validate + normalise one human edit. Refuses an empty body (a reviewer cannot approve
 * an empty reply) or a missing editor identity (every change is attributable). The body
 * and reason are bounded; the revision number + lineage make the edit an ordered,
 * append-only fact. Deterministic.
 */
export function buildResponseRevision(input: {
  revisionNumber: number;
  body: string | null | undefined;
  editorRef: string | null | undefined;
  editorKind?: string | null;
  changeReason?: string | null;
  basedOn: "ai_proposal" | "revision";
  basedOnRef: string | null;
  createdAt: string;
}): BuildRevisionResult {
  if (!input.body || !input.body.trim()) return { ok: false, error: "empty_body" };
  if (!input.editorRef || !input.editorRef.trim()) return { ok: false, error: "no_editor" };
  if (!Number.isInteger(input.revisionNumber) || input.revisionNumber < 1) {
    return { ok: false, error: "invalid_revision_number" };
  }
  const reason = typeof input.changeReason === "string" ? input.changeReason.trim() : "";
  return {
    ok: true,
    revision: {
      revision_number: input.revisionNumber,
      revised_body: input.body.slice(0, MAX_BODY),
      editor_ref: input.editorRef,
      editor_kind: input.editorKind ?? "tenant_operator",
      change_reason: reason ? reason.slice(0, MAX_REASON) : null,
      based_on: input.basedOn,
      based_on_ref: input.basedOnRef,
      created_at: input.createdAt,
    },
  };
}

// ── 3) The effective (reviewed) response approval must execute ────────────────

export interface EffectiveResponse {
  body: string;
  /** Where the executed body came from: the AI proposal, or a human revision. */
  source: "ai_proposal" | "revision";
  source_ref: string | null;
  revision_number: number | null;
  edited: boolean;
  /** Original provenance, PLUS a human_revision marker when a human edited it. */
  provenance: ProvenanceRef[];
}

/** A stored revision as seen when resolving the effective body (id assigned by the store). */
export interface StoredRevision {
  id?: string | null;
  revision_number: number;
  revised_body: string;
  editor_ref: string;
  change_reason?: string | null;
}

/**
 * Resolve the single body approval executes: the HIGHEST-numbered human revision if any,
 * otherwise the original AI draft. Preserves the proposal's provenance and, when a human
 * edited it, appends a human_revision marker so the executed artifact still declares both
 * the business context AND the human refinement. Deterministic: same inputs → same body.
 */
export function resolveEffectiveResponse(input: {
  proposal: Pick<ResponseProposal, "original_body" | "provenance">;
  revisions: StoredRevision[];
}): EffectiveResponse {
  const revisions = [...(input.revisions ?? [])].sort(
    (a, b) => a.revision_number - b.revision_number,
  );
  const latest = revisions.length > 0 ? revisions[revisions.length - 1] : null;
  const baseProvenance = Array.isArray(input.proposal.provenance) ? input.proposal.provenance : [];
  if (!latest) {
    return {
      body: input.proposal.original_body,
      source: "ai_proposal",
      source_ref: null,
      revision_number: null,
      edited: false,
      provenance: baseProvenance,
    };
  }
  const marker: ProvenanceRef = {
    kind: "human_revision",
    ref: latest.id ?? `revision-${latest.revision_number}`,
    note: `edited by ${latest.editor_ref}${latest.change_reason ? `: ${latest.change_reason}` : ""}`,
  };
  return {
    body: latest.revised_body,
    source: "revision",
    source_ref: latest.id ?? `revision-${latest.revision_number}`,
    revision_number: latest.revision_number,
    edited: true,
    provenance: [...baseProvenance, marker],
  };
}

// ── 4) Lifecycle gates — PURE decisions the impure shell enforces ─────────────
//
// The refinement layer's locking rules, decided from facts only. Critical: an approved
// intent stays `pending` until the Automation Engine claims it, so "still pending" is NOT
// enough to allow an edit or a re-approval — the presence of an immutable approval
// snapshot is the authoritative lock. These are pure so the rules are unit-testable and
// cannot drift between the revise and approve paths.

export interface RefinementGateState {
  hasProposal: boolean;
  intentStatus: string; // the automation_intent lifecycle state
  hasApprovalSnapshot: boolean; // an immutable approval snapshot already exists
}

export type GateResult =
  { ok: true } | { ok: false; code: string; message: string; httpStatus: number };

/** May a human revision be recorded now? Only for a drafted response, only while the
 *  intent is pending, and NEVER once it has been approved (the snapshot is the lock). */
export function canRevise(s: RefinementGateState): GateResult {
  if (!s.hasProposal) {
    return {
      ok: false,
      code: "no_proposal",
      message: "no response proposal to refine for this intent",
      httpStatus: 409,
    };
  }
  if (s.hasApprovalSnapshot) {
    return {
      ok: false,
      code: "already_approved",
      message: "the response is already approved and can no longer be refined",
      httpStatus: 409,
    };
  }
  if (s.intentStatus !== "pending") {
    return {
      ok: false,
      code: "not_pending",
      message: "the response can only be refined while the intent is pending approval",
      httpStatus: 409,
    };
  }
  return { ok: true };
}

/** May an approval be recorded now? Never twice — an existing snapshot rejects a duplicate
 *  approval even though the intent is still pending until the engine claims it. */
export function canApprove(s: { intentStatus: string; hasApprovalSnapshot: boolean }): GateResult {
  if (s.hasApprovalSnapshot) {
    return {
      ok: false,
      code: "already_approved",
      message: "this response has already been approved",
      httpStatus: 409,
    };
  }
  if (s.intentStatus !== "pending") {
    return {
      ok: false,
      code: "not_pending",
      message: "the intent is not pending approval",
      httpStatus: 409,
    };
  }
  return { ok: true };
}
