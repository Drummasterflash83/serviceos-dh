// ServiceOS — Response refinement orchestration (IMPURE).
//
// The DB seam for "human refinement before approval". It records the immutable original
// AI proposal, records append-only human revisions, stages the REVIEWED body onto the
// still-pending automation intent so approval executes the reviewed version only, and
// loads the full audit trail. It NEVER approves, executes, or transmits — approval stays
// the separate, already-verified Automation Engine gate. The pure model + validation live
// in response_proposal.ts; this module only persists and reads.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  buildResponseProposal,
  buildResponseRevision,
  canApprove,
  canRevise,
  resolveEffectiveResponse,
  type EffectiveResponse,
  type ProvenanceRef,
  type ResponseRevision,
} from "./response_proposal.ts";

type Db = SupabaseClient;

/**
 * Record the IMMUTABLE original AI proposal for a reply-draft intent. Idempotent: one
 * proposal per intent — a repeat call returns the existing id and never overwrites the
 * frozen original. Returns null (a no-op) when there is no body/source to record.
 */
export async function recordResponseProposal(
  db: Db,
  input: {
    tenantId: string;
    automationIntentId: string;
    actionObjectId: string | null;
    decisionId: string | null;
    channel?: string;
    sourceInteraction: string | null;
    body: string | null;
    provenance: ProvenanceRef[];
    draftVersion: string | null;
    generatedBy?: string | null;
    generatedAt: string;
  },
): Promise<string | null> {
  const built = buildResponseProposal({
    channel: input.channel,
    sourceInteraction: input.sourceInteraction,
    body: input.body,
    provenance: input.provenance,
    draftVersion: input.draftVersion,
    generatedBy: input.generatedBy,
    generatedAt: input.generatedAt,
  });
  if (!built.ok) return null;

  const { data, error } = await db
    .from("response_proposals")
    .insert({
      tenant_id: input.tenantId,
      automation_intent_id: input.automationIntentId,
      action_object_id: input.actionObjectId,
      decision_id: input.decisionId,
      channel: built.proposal.channel,
      source_interaction: built.proposal.source_interaction,
      draft_version: built.proposal.draft_version,
      proposal_version: built.proposal.proposal_version,
      original_body: built.proposal.original_body,
      provenance: built.proposal.provenance,
      generated_by: built.proposal.generated_by,
      generated_at: built.proposal.generated_at,
    })
    .select("id")
    .single();
  if (!error && data) return data.id as string;

  // Unique (automation_intent_id) violation ⇒ a proposal already exists — return it.
  const { data: existing } = await db
    .from("response_proposals")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("automation_intent_id", input.automationIntentId)
    .maybeSingle();
  return (existing?.id as string | undefined) ?? null;
}

interface ProposalRow {
  id: string;
  original_body: string;
  provenance: ProvenanceRef[];
  source_interaction: string | null;
  channel: string;
  draft_version: string | null;
}
interface RevisionRow {
  id: string;
  revision_number: number;
  revised_body: string;
  editor_ref: string;
  change_reason: string | null;
}

async function loadProposal(
  db: Db,
  tenantId: string,
  automationIntentId: string,
): Promise<{ proposal: ProposalRow; revisions: RevisionRow[] } | null> {
  const { data: proposal } = await db
    .from("response_proposals")
    .select("id, original_body, provenance, source_interaction, channel, draft_version")
    .eq("tenant_id", tenantId)
    .eq("automation_intent_id", automationIntentId)
    .maybeSingle();
  if (!proposal) return null;
  const { data: revs } = await db
    .from("response_revisions")
    .select("id, revision_number, revised_body, editor_ref, change_reason")
    .eq("tenant_id", tenantId)
    .eq("automation_intent_id", automationIntentId)
    .order("revision_number", { ascending: true });
  return { proposal: proposal as ProposalRow, revisions: (revs ?? []) as RevisionRow[] };
}

/** Overwrite ONLY the reviewed body + provenance on a still-pending intent, preserving
 *  every other parameter (source interaction, intent-type params). Allowed by the engine
 *  while the intent is `pending`; refused by the engine once it is not. */
async function stageReviewedBody(
  db: Db,
  tenantId: string,
  automationIntentId: string,
  effective: EffectiveResponse,
): Promise<void> {
  const { data: intent } = await db
    .from("automation_intents")
    .select("parameters")
    .eq("tenant_id", tenantId)
    .eq("id", automationIntentId)
    .maybeSingle();
  const params = ((intent?.parameters as Record<string, unknown> | null) ?? {}) as Record<
    string,
    unknown
  >;
  await db
    .from("automation_intents")
    .update({
      parameters: {
        ...params,
        body: effective.body,
        note: effective.body, // shared internal-note field the adapter also reads
        response_provenance: effective.provenance,
      },
    })
    .eq("tenant_id", tenantId)
    .eq("id", automationIntentId)
    .eq("status", "pending"); // never touch an intent that has left pending
}

export type ReviseResult =
  | { ok: true; revision: ResponseRevision; revisionId: string; effective: EffectiveResponse }
  | { ok: false; code: string; message: string; httpStatus: number };

/** Does an immutable approval snapshot already exist for this intent? It is the
 *  authoritative lock — an approved intent stays `pending` until the engine claims it, so
 *  status alone is not enough to know it is locked. */
async function hasApprovalSnapshot(
  db: Db,
  tenantId: string,
  automationIntentId: string,
): Promise<boolean> {
  const { data } = await db
    .from("response_approval_snapshots")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("automation_intent_id", automationIntentId)
    .maybeSingle();
  return !!data;
}

/**
 * Record ONE human refinement of the proposed response and stage it onto the pending
 * intent. The pure `canRevise` gate refuses when there is no proposal, when the intent has
 * already been approved (the snapshot lock — even though it is still `pending`), or when it
 * has otherwise left `pending`. Append-only: the original + prior revisions are never
 * mutated.
 */
export async function recordResponseRevision(
  db: Db,
  input: {
    tenantId: string;
    automationIntentId: string;
    editorRef: string;
    editorKind?: string | null;
    body: string;
    changeReason?: string | null;
    now: string;
  },
): Promise<ReviseResult> {
  const { data: intent } = await db
    .from("automation_intents")
    .select("id, tenant_id, status")
    .eq("id", input.automationIntentId)
    .maybeSingle();
  if (!intent || intent.tenant_id !== input.tenantId) {
    return {
      ok: false,
      code: "not_found",
      message: "automation intent not found",
      httpStatus: 404,
    };
  }

  const loaded = await loadProposal(db, input.tenantId, input.automationIntentId);
  const approved = await hasApprovalSnapshot(db, input.tenantId, input.automationIntentId);
  const gate = canRevise({
    hasProposal: !!loaded,
    intentStatus: intent.status as string,
    hasApprovalSnapshot: approved,
  });
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.message, httpStatus: gate.httpStatus };
  }
  // loaded is non-null here (canRevise rejects hasProposal=false).
  const prior = loaded!.revisions;
  const revisionNumber = (prior.length > 0 ? prior[prior.length - 1].revision_number : 0) + 1;
  const basedOnRef = prior.length > 0 ? prior[prior.length - 1].id : null;
  const built = buildResponseRevision({
    revisionNumber,
    body: input.body,
    editorRef: input.editorRef,
    editorKind: input.editorKind,
    changeReason: input.changeReason,
    basedOn: prior.length > 0 ? "revision" : "ai_proposal",
    basedOnRef,
    createdAt: input.now,
  });
  if (!built.ok) {
    return { ok: false, code: built.error, message: built.error, httpStatus: 400 };
  }

  const { data: rows, error } = await db.rpc("record_response_revision_atomic", {
    p_tenant_id: input.tenantId,
    p_intent_id: input.automationIntentId,
    p_editor_ref: built.revision.editor_ref,
    p_editor_kind: built.revision.editor_kind,
    p_body: built.revision.revised_body,
    p_change_reason: built.revision.change_reason,
    p_now: built.revision.created_at,
  });
  const inserted = (rows ?? [])[0] as
    { revision_id?: string; revision_number?: number } | undefined;
  if (error || !inserted?.revision_id) {
    return {
      ok: false,
      code: "revision_write_failed",
      message: (error as { message?: string } | null)?.message ?? "failed",
      httpStatus: 400,
    };
  }
  const revisionId = inserted.revision_id;
  const actualRevision = {
    ...built.revision,
    revision_number: inserted.revision_number ?? built.revision.revision_number,
  };

  const effective = resolveEffectiveResponse({
    proposal: loaded!.proposal,
    revisions: [...prior, { ...actualRevision, id: revisionId }],
  });
  return { ok: true, revision: actualRevision, revisionId, effective };
}

export type ApprovalSnapshotResult =
  | {
      kind: "ok";
      snapshotId: string;
      proposalId: string;
      approvedRevisionId: string | null;
      effective: EffectiveResponse;
      approvalId: string;
      approvedPayloadHash: string;
    }
  | { kind: "no_proposal" } // a non-response intent — approval proceeds unchanged
  | { kind: "already_approved" }; // a duplicate approval — reject

/**
 * The "approved final artifact" step: immediately BEFORE the engine approval is recorded,
 * capture the EXACT reviewed body as an IMMUTABLE snapshot and stage it onto the still-
 * pending intent so the Automation Engine executes the reviewed version only.
 *
 *  - Refuses a DUPLICATE approval via the pure `canApprove` gate + the snapshot's
 *    unique(automation_intent_id) constraint (the constraint also wins any race).
 *  - Returns `no_proposal` for a non-response intent (the caller approves as before).
 *
 * The snapshot is the durable, engine-independent record the audit trail and any later
 * dispute rely on; it is never mutated (append-only trigger).
 */
export async function recordApprovalSnapshot(
  db: Db,
  input: {
    tenantId: string;
    automationIntentId: string;
    approverRef: string;
    approverKind: string;
    authorityBasis?: string | null;
    evidence?: Record<string, unknown>;
    now: string;
  },
): Promise<ApprovalSnapshotResult> {
  const loaded = await loadProposal(db, input.tenantId, input.automationIntentId);
  if (!loaded) return { kind: "no_proposal" };

  const { data: intent } = await db
    .from("automation_intents")
    .select("status")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.automationIntentId)
    .maybeSingle();
  const approved = await hasApprovalSnapshot(db, input.tenantId, input.automationIntentId);
  const gate = canApprove({
    intentStatus: (intent?.status as string | undefined) ?? "unknown",
    hasApprovalSnapshot: approved,
  });
  if (!gate.ok) return { kind: "already_approved" };

  const effective = resolveEffectiveResponse({
    proposal: loaded.proposal,
    revisions: loaded.revisions,
  });
  const approvedRevisionId = effective.source === "revision" ? effective.source_ref : null;
  const { data: rows, error } = await db.rpc("approve_response_intent_atomic", {
    p_tenant_id: input.tenantId,
    p_intent_id: input.automationIntentId,
    p_approver_ref: input.approverRef,
    p_approver_kind: input.approverKind,
    p_authority_basis: input.authorityBasis ?? "tenant_operator_review",
    p_decision: "approved",
    p_evidence: input.evidence ?? {},
    p_now: input.now,
  });
  const row = (rows ?? [])[0] as
    { snapshot_id?: string; approval_id?: string; approved_payload_hash?: string } | undefined;
  if (error || !row?.snapshot_id || !row.approval_id || !row.approved_payload_hash) {
    return { kind: "already_approved" };
  }

  return {
    kind: "ok",
    snapshotId: row.snapshot_id,
    proposalId: loaded.proposal.id,
    approvedRevisionId,
    effective,
    approvalId: row.approval_id,
    approvedPayloadHash: row.approved_payload_hash,
  };
}

/** Load the full audit trail for an intent: proposal → revisions → approvals → attempt. */
export async function loadRefinementTrail(
  db: Db,
  tenantId: string,
  automationIntentId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await db
    .from("response_refinement_trail")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("automation_intent_id", automationIntentId)
    .maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}
