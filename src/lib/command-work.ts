/**
 * Command Centre work layer — the missing wire from the UI to the proven backend.
 *
 * Calls the `work-projection` (role-scoped, ranked single work list), `work-transition`
 * (persistent lifecycle actions), `user-ownership` (role/authority resolution) and
 * `view-as` Edge Functions. Reuses the repo's ApiResult + access-token convention; no
 * business logic is duplicated in React (ranking/folding/authority all live server-side).
 */
import { supabaseConfig, getAccessToken } from "./supabase";
import { apiFetch } from "./api";
import type { ApiResult } from "./types";

function fnUrl(name: string): string {
  return `${supabaseConfig.url}/functions/v1/${name}`;
}

/** Invoke an Edge Function that returns an `{ ok, data | error }` envelope, unwrapped to ApiResult<T>. */
async function invoke<T>(name: string, payload: unknown): Promise<ApiResult<T>> {
  if (!supabaseConfig.url || !supabaseConfig.anonKey) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const token = await getAccessToken();
  if (!token)
    return { ok: false, error: { code: "missing_auth", message: "You must be signed in" } };
  const res = await apiFetch<{ ok: boolean; data?: T; error?: { code: string; message: string } }>(
    fnUrl(name),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: supabaseConfig.anonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload ?? {}),
    },
  );
  if (!res.ok) return res;
  const body = res.data;
  if (!body?.ok)
    return { ok: false, error: body?.error ?? { code: "unknown", message: "request failed" } };
  return { ok: true, data: (body.data ?? (body as unknown as T)) as T };
}

// ── Types (frontend contract; mirrors the projection output) ────────────────
export interface RankExplanation {
  whyHere: string;
  whyYours: string;
  whyAboveNext: string | null;
  objective: string | null;
  kpi: string | null;
  consequenceOfDelay: string | null;
  recommends: string | null;
  aiCanHandle: string | null;
  humanJudgement: string | null;
  proofOfDone: string | null;
  missingOrStale: string[];
  factors: { factor: string; contribution: number }[];
}
export interface WorkItem {
  id: string;
  title: string;
  outcome: string | null;
  state: string;
  accountableOwner: string | null;
  operationalOwner: string | null;
  assignee: string | null;
  team: string | null;
  role: string | null;
  objectiveId: string | null;
  objectiveTitle: string | null;
  kpi: string | null;
  objectiveHealth: string | null;
  priority: string | null;
  urgency: string | null;
  dueAt: string | null;
  waitingOn: string | null;
  blocker: string | null;
  recommendedAction: string | null;
  consequenceOfDelay: string | null;
  doneWhen: string | null;
  completionEvidenceRequired: boolean;
  evidence: {
    kind: string;
    ref: string;
    detail: string | null;
    source: string | null;
    ageHours: number | null;
    confidence: number | null;
  }[];
  evidenceAgeHours: number | null;
  confidence: number | null;
  customerRef: string | null;
  jobRef: string | null;
  siteRef: string | null;
  relatedRecommendationIds: string[];
  possibleDuplicateOf: string[];
  agentActivity: { intentId: string; status: string; outcome: string | null }[];
  score: number;
  explanation: RankExplanation;
  capabilityStatus: string;
  unresolved: string[];
}
export interface CommandPosition {
  urgent: number;
  dueToday: number;
  waitingOnYou: number;
  handledAutomatically: number;
  automationActive: number;
  blocked: number;
  objectivesAtRisk: number;
}
export interface WorkProjection {
  generatedAt: string;
  weightsVersion: string;
  /** true when this projection is a read-only View-As of another subject. */
  readOnly?: boolean;
  viewingAs?: { kind: string; ref: string | null } | null;
  user: {
    userRef: string;
    memberId: string | null;
    displayName?: string | null;
    role: string;
    formalRole: string | null;
    isLeadership: boolean;
    authority: string[];
  };
  position: CommandPosition;
  doNext: WorkItem[];
  all: WorkItem[];
  consolidation: {
    recommendationsFoldedAsEvidence: number;
    standaloneRecommendations: number;
    routedToReview: number;
  };
  /** Tenant-Superadmin-only input→work pipeline oversight (null for other roles). */
  oversight?: Oversight | null;
}

export interface Oversight {
  period: string;
  inputs: { total: number; phone: number; email: number; other: number };
  identity: {
    peopleIdentified: number;
    companiesIdentified: number;
    unresolvedIdentity: number;
    jobsMatched: number;
    sitesMatched: number;
  };
  interpretation: { observations: number; recommendations: number; recommendationsOpen: number };
  work: {
    meaningfulActions: number;
    totalActionObjects: number;
    handledAutomatically: number;
    outcomes: number;
  };
  automation: { activeRuns: number; awaitingApproval: number; executions: number };
  exceptions: {
    fallbackNonActionable: { count: number; policy: string; policyState: string; note: string };
    awaitingIdentityResolution: number;
  };
}

export type WorkVerb =
  | "acknowledge"
  | "start"
  | "wait"
  | "resume"
  | "block"
  | "unblock"
  | "escalate"
  | "complete"
  | "dismiss"
  | "accept"
  | "assign"
  | "correct_owner"
  | "correct_objective";

export interface TransitionInput {
  objectId: string;
  verb: WorkVerb;
  reason?: string;
  evidence?: unknown;
  targetMemberRef?: string;
  targetObjectiveId?: string;
  approvedException?: boolean;
}

/** The role-scoped, ranked Command Centre work list + position counts. */
export function getWorkProjection(viewAsContextId?: string): Promise<ApiResult<WorkProjection>> {
  return invoke<WorkProjection>(
    "work-projection",
    viewAsContextId ? { view_as_context_id: viewAsContextId } : {},
  );
}

/** Persist a work transition (server-authoritative; survives refresh). */
export function transitionWork(
  input: TransitionInput,
): Promise<
  ApiResult<{ object_id: string; verb: string; from: string; to: string; status_changed: boolean }>
> {
  return invoke("work-transition", {
    object_id: input.objectId,
    verb: input.verb,
    reason: input.reason ?? null,
    evidence: input.evidence ?? null,
    target_member_ref: input.targetMemberRef ?? null,
    target_objective_id: input.targetObjectiveId ?? null,
    approved_exception: input.approvedException ?? false,
  });
}

/** The current user's resolved ownership/authority (role-specific Command Centre derives from this). */
export function getMyOwnership(): Promise<ApiResult<{ ownership: unknown }>> {
  return invoke("user-ownership", {});
}

// ── View-As (Tenant Superadmin only) ────────────────────────────────────────
export interface ViewAsContext {
  id: string;
  subject_kind: string;
  subject_ref: string | null;
  mode: string;
  read_only: boolean;
  expires_at: string;
}
export function openViewAs(
  subjectKind: string,
  subjectRef: string | null,
  reason?: string,
): Promise<
  ApiResult<{ context: ViewAsContext; banner: { readOnly: boolean; expiresAt: string } }>
> {
  return invoke("view-as", {
    action: "open",
    subject_kind: subjectKind,
    subject_ref: subjectRef,
    reason,
  });
}
export function resolveViewAs(contextId: string): Promise<
  ApiResult<{
    readOnly: boolean;
    actor: { userId: string; ref: string };
    viewingAs: { kind: string; ref: string | null; expiresAt: string };
    subject: unknown;
  }>
> {
  return invoke("view-as", { action: "resolve", context_id: contextId });
}
export function exitViewAs(contextId: string): Promise<ApiResult<{ exited: string }>> {
  return invoke("view-as", { action: "exit", context_id: contextId });
}
