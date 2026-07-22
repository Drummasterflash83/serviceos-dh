// ServiceOS — Customer Health (callback) shared types.
//
// Universal and tenant-agnostic: no Drummonds UUID, DDI, extension or staff name
// appears in this module. All tenant specifics arrive as configuration (loaded from
// operating_profile_entries) and are passed in. These types are shared by the pure
// engines (classifier, ownership, evaluator, pipeline) and the impure worker handler.

// ── Canonical internal Health vocabulary (stable for v1). ───────────────────
export type HealthState = "unknown" | "healthy" | "watch" | "at_risk" | "critical" | "recovering";
export type HealthTrend = "unknown" | "improving" | "stable" | "worsening";

export type ClassifierRoute = "candidate" | "exclude" | "uncertain";

export interface EvidenceItem {
  source: string;
  detail: string;
}

/** A small, safe driver record for an assessment. code ∈ health_driver_codes. */
export interface Driver {
  code: string;
  detail: string;
}

// ── Canonical communication input (a projected interaction + optional signals). ─
// The classifier reads only what is passed here; the caller is responsible for not
// passing raw transcripts (it passes a short summary/body preview instead).
export interface CommunicationInput {
  interactionId: string;
  interactionType: string | null; // phone_call | email_message | ...
  direction: string | null; // inbound | outbound | internal | unknown
  occurredAt: string | null; // ISO
  fromName: string | null;
  fromAddress: string | null; // email address, when known
  phoneFrom: string | null; // caller number
  phoneTo: string | null; // the DDI that was called
  subject: string | null;
  summary: string | null; // short, safe summary (never a transcript)
  bodyPreview: string | null; // bounded preview
  // Optional precomputed signals (from upstream analysis); all hints, never trusted blindly.
  intent?: string | null; // e.g. 'callback_request' | 'spam' | 'sales' | ...
  sentiment?: string | null;
  disposition?: string | null; // answered | missed | voicemail | no_message | resolved_on_transfer | ...
  callerKind?: string | null; // customer | supplier | internal | unknown
  queue?: string | null; // queue/team the call entered, if any
  extension?: string | null; // extension reached, if any
  requestedName?: string | null; // an explicitly requested person, if upstream extracted it
  relatedPersonId?: string | null;
  relatedCompanyId?: string | null;
  metadata?: Record<string, unknown>;
}

// ── Tenant callback policy config (loaded from operating_profile_entries). ──
export interface CallbackPolicyConfig {
  requiresExplicitRequest: boolean;
  telephoneBased: boolean;
  includeIntents: string[];
  excludeIntents: string[];
  includeSuppliers: boolean;
  // due / escalation
  defaultDueHours: number;
  dueSoonWithinHours: number;
  priorityDueHours: number;
  criticalOnRepeatCount: number;
  staleAfterHours: number;
  // privacy
  redactExcerpts: boolean;
  maxExcerptChars: number;
  exposeTranscript: boolean;
}

/** Safe defaults so a missing config never crashes and never over-exposes. */
export const DEFAULT_CALLBACK_POLICY: CallbackPolicyConfig = {
  requiresExplicitRequest: true,
  telephoneBased: true,
  includeIntents: [],
  excludeIntents: [],
  includeSuppliers: false,
  defaultDueHours: 4,
  dueSoonWithinHours: 4,
  priorityDueHours: 2,
  criticalOnRepeatCount: 2,
  staleAfterHours: 168,
  redactExcerpts: true,
  maxExcerptChars: 120,
  exposeTranscript: false,
};

// ── Classifier output. ──────────────────────────────────────────────────────
export interface OwnershipHint {
  ddi: string | null;
  extension: string | null;
  queue: string | null;
  requestedName: string | null;
}

export interface CallbackClassification {
  route: ClassifierRoute; // candidate | exclude | uncertain
  candidate: boolean; // convenience: route === 'candidate'
  reason: string; // human-readable
  reasonCode: string; // machine-readable
  requestedOutcome: string | null; // extracted requested outcome
  supportingExcerpt: string | null; // bounded / redacted excerpt (or null)
  supportingRef: string; // interactionId
  confidence: number; // 0..1
  ambiguity: number; // 0..1
  suggestedDueHours: number | null;
  ownershipHint: OwnershipHint;
  classifierVersion: string;
}

// ── Ownership resolution. ───────────────────────────────────────────────────
export interface OwnershipEntry {
  responsibility: string; // e.g. 'team:scheduling' | 'role:coordinator' | 'member:<ref>'
  label?: string;
}
export interface OwnershipMaps {
  ddi: Record<string, OwnershipEntry>;
  extension: Record<string, OwnershipEntry>;
  queue: Record<string, OwnershipEntry>;
  named_recipient: Record<string, OwnershipEntry>; // keyed by lower-cased name
  shared_responsibility: Record<string, OwnershipEntry>;
  fallback_role: OwnershipEntry | null;
}
export type OwnershipSourceKind =
  | "ddi"
  | "extension"
  | "queue"
  | "named_recipient"
  | "shared_responsibility"
  | "fallback_role"
  | "needs_context";

export interface OwnershipResolution {
  responsibility: string | null;
  source: OwnershipSourceKind;
  label: string | null;
  explanation: string; // "Call entered the scheduling queue." etc.
  confidence: number;
}

// ── Subject resolution. ─────────────────────────────────────────────────────
export type SubjectType = "company" | "person";
export interface SubjectResolution {
  resolved: boolean;
  subjectType: SubjectType | null;
  subjectId: string | null;
  reason: string; // why this subject (or why none)
}

// ── Obligation + Health evaluation. ─────────────────────────────────────────
export interface ObligationState {
  hasOpenCallback: boolean;
  candidateAt: string | null; // ISO — when the obligation was raised
  dueAt: string | null; // ISO
  repeatContactCount: number; // number of contacts about the SAME obligation
  resolution: "none" | "possible" | "verified";
  newestEvidenceAt: string | null; // ISO — age basis for freshness
  ambiguity: number; // 0..1 carried from the classifier
}

export interface HealthReading {
  state: HealthState;
  trend: HealthTrend;
  drivers: Driver[];
  risks: string[];
  opportunities: string[];
  confidence: number;
  freshness: "fresh" | "aging" | "stale" | "unknown";
  evidence: EvidenceItem[];
  changed: Record<string, unknown>; // what changed vs the prior reading
}

// ── Resolution-evidence matching. ───────────────────────────────────────────
export type ResolutionVerdict = "none" | "possible" | "verified";
export interface ResolutionMatch {
  verdict: ResolutionVerdict;
  reasons: string[];
  matchedOn: string[]; // e.g. ['same_endpoint','within_window','outbound']
}
