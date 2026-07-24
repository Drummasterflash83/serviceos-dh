/**
 * Operator preview projection — the ServiceOS experience generated for a canonical team member,
 * WITHOUT a profile_id or login account.
 *
 * This is deliberately NOT the profile-based View-As mechanism. The preview subject is a
 * canonical `tenant_id + team_member_id` — never a profile_id, email, display name, extension or
 * Slack account. An authenticated operator inspects the projection *generated for* the actor; the
 * operator's own session is never mutated to impersonate them, and nothing here is attributed to
 * the actor.
 *
 * The experience is derived ONLY from CONFIRMED canonical mappings (verified identities, ownership).
 * Unconfirmed identity candidates must never silently contribute — where evidence is incomplete the
 * preview shows honest gaps (an empty work list is preferable to fabricated activity).
 *
 * Pure + deterministic (pass `now` in) so it is unit-testable without a backend.
 */
import type { CpMember, CpIdentity, CpOwnership } from "./openfolk";
import type { WorkProjection } from "./command-work";

export interface PreviewSubject {
  tenantId: string;
  teamMemberId: string;
}

/** What each canonical source contributes to the generated experience (honest, incl. gaps). */
export interface PreviewCoverage {
  source: "email" | "telephony" | "slack" | "commusoft" | "ownership";
  status: "confirmed" | "pending" | "not_connected";
  detail: string;
}

export interface PreviewResult {
  ok: boolean;
  error?: string;
  actor: { id: string; name: string; kind: string } | null;
  coverage: PreviewCoverage[];
  /** Non-fabricated: empty work lists where confirmed evidence does not yet exist. */
  projection: WorkProjection | null;
  /** Sources that are confirmed and therefore genuinely feed the experience. */
  confirmedSources: string[];
}

export interface PreviewEvidence {
  /** Tenant-scoped canonical members (the caller supplies tenant-scoped data). */
  members: CpMember[];
  /** member_integration_identities rows — ONLY verification_state==='verified' contribute. */
  identities: CpIdentity[];
  ownership: CpOwnership[];
  // NOTE: candidate/suggestion lists are intentionally NOT accepted here — unconfirmed evidence
  // cannot contribute to a generated experience.
}

const EXTENSION_RE = /^\d{2,6}$/;

/**
 * Build the read-only preview projection for a canonical team member. Returns ok:false for an
 * unknown or cross-tenant member (the member list is already tenant-scoped by the caller, so a
 * foreign id simply is not present). Never throws.
 */
export function buildTeamMemberPreview(
  subject: PreviewSubject,
  evidence: PreviewEvidence,
  now: string,
): PreviewResult {
  const member = (evidence.members ?? []).find((m) => m.id === subject.teamMemberId);
  if (!subject.tenantId || !subject.teamMemberId || !member) {
    return {
      ok: false,
      error: "team member not found in this tenant",
      actor: null,
      coverage: [],
      projection: null,
      confirmedSources: [],
    };
  }

  // CONFIRMED links only — unverified rows never contribute.
  const confirmed = (evidence.identities ?? []).filter(
    (i) => i.team_member_id === member.id && i.verification_state === "verified",
  );
  const hasEmail = confirmed.some(
    (i) => i.provider === "google_workspace" || i.provider === "microsoft365",
  );
  const hasTelephony = confirmed.some((i) => EXTENSION_RE.test(i.external_ref));
  const hasSlack = confirmed.some((i) => i.provider === "slack");
  const myOwnership = (evidence.ownership ?? []).filter(
    (o) => o.owner_member_id === member.id && !o.effective_to,
  );

  const coverage: PreviewCoverage[] = [
    {
      source: "email",
      status: hasEmail ? "confirmed" : "pending",
      detail: hasEmail ? "confirmed mailbox contributes" : "no confirmed mailbox — excluded",
    },
    {
      source: "telephony",
      status: hasTelephony ? "confirmed" : "pending",
      detail: hasTelephony
        ? "confirmed extension contributes"
        : "no confirmed extension — excluded",
    },
    {
      source: "slack",
      status: hasSlack ? "confirmed" : "not_connected",
      detail: hasSlack ? "confirmed Slack user contributes" : "not connected",
    },
    { source: "commusoft", status: "not_connected", detail: "operational import not yet ingested" },
    {
      source: "ownership",
      status: myOwnership.length ? "confirmed" : "pending",
      detail: myOwnership.length
        ? `${myOwnership.length} operational responsibility(ies)`
        : "no ownership assigned",
    },
  ];
  const confirmedSources = coverage.filter((c) => c.status === "confirmed").map((c) => c.source);

  const role = member.formal_role?.trim() || "Team member";
  const projection: WorkProjection = {
    generatedAt: now,
    weightsVersion: "preview",
    readOnly: true,
    // The subject is the CANONICAL actor — a team_member, never a profile/user id.
    viewingAs: { kind: "team_member_preview", ref: member.id },
    user: {
      // A preview-scoped ref that is NOT the actor's login/profile — attribution can never leak.
      userRef: `team_member_preview:${member.id}`,
      memberId: member.id,
      displayName: member.display_name,
      role,
      formalRole: member.formal_role,
      isLeadership: false,
      authority: [],
    },
    position: {
      urgent: 0,
      dueToday: 0,
      waitingOnYou: 0,
      handledAutomatically: 0,
      automationActive: 0,
      blocked: 0,
      objectivesAtRisk: 0,
    },
    // Honest gaps: no confirmed live work/Health yet, so the lists are empty — never fabricated.
    doNext: [],
    all: [],
    consolidation: {
      recommendationsFoldedAsEvidence: 0,
      standaloneRecommendations: 0,
      routedToReview: 0,
    },
    oversight: null,
  };

  return {
    ok: true,
    actor: { id: member.id, name: member.display_name, kind: "team_member" },
    coverage,
    projection,
    confirmedSources,
  };
}
