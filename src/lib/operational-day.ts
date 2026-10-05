/**
 * Mary's First Day — a complete read-only ServiceOS operational day for a canonical member,
 * generated from CONFIRMED evidence only.
 *
 * The point is to prove the platform, not to expand it: given a member's confirmed identity
 * mappings + existing confirmed evidence (ownership, confirmed commitments, waiting relationships,
 * published Health findings), derive the seven operational focus areas. Where confirmed evidence
 * does not exist the day shows an HONEST GAP — never fabricated activity. Unconfirmed candidates,
 * draft/shadow Health and unpublished signals never contribute.
 *
 * Pure + deterministic (pass `now` in) so it is unit-testable without a backend.
 */
export type DayConfidence = "high" | "medium" | "low" | "unresolved";

/** A confirmed commitment / obligation attributable to the member. */
export interface DayCommitment {
  id: string;
  title: string;
  dueAt: string | null;
  state: "open" | "due_soon" | "overdue" | "waiting" | "resolved";
  waitingOn?: string | null; // who/what it is blocked on
  customerRef?: string | null;
  jobRef?: string | null;
  confidence: DayConfidence;
  provenance: string;
}

export interface WaitingItem {
  id: string;
  title: string;
  counterparty: string; // the other person/party
  sinceAt: string | null;
  confidence: DayConfidence;
  provenance: string;
}

/** A published/confirmed Health finding the member owns or contributes to. */
export interface DayHealthFinding {
  id: string;
  subject: string; // masked ref (e.g. "Customer ••••", "JOB ••••")
  subjectKind: "customer" | "job";
  state: "watch" | "at_risk" | "critical" | "recovering";
  driver: string;
  evidence: string;
  owner: string | null;
  waitingOn?: string | null;
  intervention: string | null;
  confidence: DayConfidence;
  provenance: string;
}

export interface DayOwnershipRole {
  id: string;
  assignment_role: string; // accountable | primary_handler | cover | escalation
  endpoint_label: string;
  endpoint_id: string;
  review_state: string; // confirmed | ...
}

export interface DayEvidence {
  member: { id: string; display_name: string; formal_role: string | null };
  /** Verified identity links only (email/telephony/slack). Unverified never contribute. */
  confirmedIdentities: { provider: string; external_ref: string }[];
  /** Active, confirmed ownership assignments for this member. */
  ownership: DayOwnershipRole[];
  /** Confirmed operational evidence — omit/empty ⇒ honest gaps (nothing fabricated). */
  commitments?: DayCommitment[];
  waiting?: { onMe?: WaitingItem[]; iAwait?: WaitingItem[] };
  customerHealth?: DayHealthFinding[];
  jobHealth?: DayHealthFinding[];
}

export interface DayItem {
  id: string;
  title: string;
  why: string;
  dueAt?: string | null;
  refs?: string;
  confidence: DayConfidence;
  provenance: string;
}
export interface OwnershipSignal {
  kind: "held" | "no_accountable" | "concentration" | "unconfirmed";
  detail: string;
  severity: "info" | "attention" | "risk";
}
export interface Intervention {
  title: string;
  reason: string;
  area: string;
  confidence: DayConfidence;
}
export interface DayGap {
  area: string;
  reason: string;
}

export interface OperationalDay {
  actor: { id: string; name: string; role: string | null };
  confirmedSources: string[];
  needsMeNow: DayItem[];
  waitingOnMe: DayItem[];
  iAmWaitingOn: DayItem[];
  customerHealth: DayHealthFinding[];
  jobHealth: DayHealthFinding[];
  ownershipHealth: OwnershipSignal[];
  interventions: Intervention[];
  gaps: DayGap[];
  /** True by construction — this projection reads only confirmed evidence. */
  usesConfirmedEvidenceOnly: true;
}

const OWNERSHIP_ROLES = ["accountable", "primary_handler", "cover", "escalation"];

function confirmedSourceLabels(ids: DayEvidence["confirmedIdentities"]): string[] {
  const out = new Set<string>();
  for (const i of ids) {
    if (i.provider === "google_workspace" || i.provider === "microsoft365") out.add("email");
    else if (i.provider === "slack") out.add("slack");
    else if (/^\d{2,6}$/.test(i.external_ref)) out.add("telephony");
    else out.add(i.provider);
  }
  return [...out];
}

/**
 * Build the day. Derives each focus area from confirmed evidence; anything without confirmed
 * evidence becomes an explicit gap. Ownership Health is derivable now from confirmed ownership
 * config; comms/Health-derived areas depend on evidence that only exists once bounded evaluation
 * and Health are activated — until then they are honest gaps, not zeros dressed as activity.
 */
export function buildOperationalDay(evidence: DayEvidence, now: string): OperationalDay {
  const gaps: DayGap[] = [];
  const interventions: Intervention[] = [];
  const commitments = evidence.commitments ?? [];
  const waitingOnMe = evidence.waiting?.onMe ?? [];
  const iAwait = evidence.waiting?.iAwait ?? [];
  const customerHealth = evidence.customerHealth ?? [];
  const jobHealth = evidence.jobHealth ?? [];

  // ── Needs me now: confirmed commitments that are due-soon / overdue. ──
  const needsMeNow: DayItem[] = commitments
    .filter((c) => c.state === "due_soon" || c.state === "overdue")
    .map((c) => ({
      id: c.id,
      title: c.title,
      why: c.state === "overdue" ? "overdue commitment" : "commitment due soon",
      dueAt: c.dueAt,
      refs: [c.customerRef, c.jobRef].filter(Boolean).join(" · ") || undefined,
      confidence: c.confidence,
      provenance: c.provenance,
    }));
  if (commitments.length === 0)
    gaps.push({
      area: "Needs me now / Commitments",
      reason: "no confirmed commitments — requires bounded evaluation of a confirmed source",
    });

  // ── Waiting (two explicit directions). ──
  const waitingOnMeItems: DayItem[] = waitingOnMe.map((w) => ({
    id: w.id,
    title: w.title,
    why: `${w.counterparty} is waiting on this`,
    confidence: w.confidence,
    provenance: w.provenance,
  }));
  const iAmWaitingOn: DayItem[] = iAwait.map((w) => ({
    id: w.id,
    title: w.title,
    why: `waiting on ${w.counterparty}`,
    confidence: w.confidence,
    provenance: w.provenance,
  }));
  if (waitingOnMe.length === 0 && iAwait.length === 0)
    gaps.push({
      area: "Waiting relationships",
      reason:
        "no confirmed waiting evidence — derived from confirmed comms/handoffs once evaluated",
    });

  // ── Customer & Job Health: published/confirmed findings only. ──
  for (const h of [...customerHealth, ...jobHealth])
    if (h.intervention)
      interventions.push({
        title: h.intervention,
        reason: `${h.subjectKind} health: ${h.driver}`,
        area: h.subjectKind === "customer" ? "Customer Health" : "Job Health",
        confidence: h.confidence,
      });
  if (customerHealth.length === 0)
    gaps.push({
      area: "Customer Health",
      reason: "no published Customer Health findings — Health evaluation not activated",
    });
  if (jobHealth.length === 0)
    gaps.push({
      area: "Job Health",
      reason: "no Job Health findings — Commusoft not ingested / Job Health not activated",
    });

  // ── Ownership Health: derivable NOW from confirmed ownership config. ──
  const ownershipHealth: OwnershipSignal[] = [];
  const active = evidence.ownership.filter((o) => o.review_state === "confirmed");
  if (active.length === 0) {
    ownershipHealth.push({
      kind: "no_accountable",
      detail:
        "holds no confirmed operational ownership — no endpoint is accountable to this member",
      severity: "attention",
    });
    interventions.push({
      title: "Assign an accountable owner role",
      reason: "member holds no confirmed ownership",
      area: "Ownership Health",
      confidence: "high",
    });
  } else {
    // concentration: 3+ roles on one endpoint
    const perEp = new Map<string, number>();
    for (const o of active) perEp.set(o.endpoint_id, (perEp.get(o.endpoint_id) ?? 0) + 1);
    for (const [epId, n] of perEp)
      if (n >= 3) {
        const label = active.find((o) => o.endpoint_id === epId)?.endpoint_label ?? epId;
        ownershipHealth.push({
          kind: "concentration",
          detail: `holds ${n} roles on ${label} (concentration risk)`,
          severity: "risk",
        });
      }
    for (const role of OWNERSHIP_ROLES) {
      const held = active.filter((o) => o.assignment_role === role);
      if (held.length)
        ownershipHealth.push({
          kind: "held",
          detail: `${role.replace("_", " ")}: ${held.map((h) => h.endpoint_label).join(", ")}`,
          severity: "info",
        });
    }
  }
  // Unconfirmed (proposed/conflicted) ownership → surface, never counted as confirmed.
  const unconfirmed = evidence.ownership.filter((o) => o.review_state !== "confirmed");
  if (unconfirmed.length)
    ownershipHealth.push({
      kind: "unconfirmed",
      detail: `${unconfirmed.length} proposed/unconfirmed ownership assignment(s) awaiting review`,
      severity: "attention",
    });

  return {
    actor: {
      id: evidence.member.id,
      name: evidence.member.display_name,
      role: evidence.member.formal_role,
    },
    confirmedSources: confirmedSourceLabels(evidence.confirmedIdentities),
    needsMeNow,
    waitingOnMe: waitingOnMeItems,
    iAmWaitingOn,
    customerHealth,
    jobHealth,
    ownershipHealth,
    interventions,
    gaps,
    usesConfirmedEvidenceOnly: true,
  };
}
