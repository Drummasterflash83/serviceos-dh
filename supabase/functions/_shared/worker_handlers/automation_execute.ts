// ServiceOS — Worker handler: automation.execute
//
// The Universal Automation Engine's impure shell. Given a previously AUTHORISED
// Automation Intent it: resolves every execution fact, runs the PURE execution-guard
// evaluator (which re-checks Operational Mode via the same resolver the Decision
// Engine used), and — only if allowed — atomically claims a lease, invokes the
// connector ADAPTER, appends an IMMUTABLE execution attempt, transitions the intent
// lifecycle through legal states only, appends an immutable OPERATIONAL Outcome, and
// publishes factual events. It NEVER re-decides the business action, changes the
// action/recipients/scope/expenditure, creates a Decision or Action, writes Objective
// Health, or lets an adapter touch lifecycle/events. Tenant comes from job context;
// every reference is tenant-checked. Domain-agnostic: ServiceOS and ProductOS share it.

import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";
import {
  AUTOMATION_EXECUTOR_VERSION,
  buildIdempotencyKey,
  evaluateExecutionGuards,
  isLegalTransition,
  planPostExecution,
  planUnknownResolution,
  type ConnectorExecutionResult,
  type ExecutionGuardInput,
} from "../intelligence/automation_guards.ts";
import { resolveEffectiveProfile } from "../intelligence/profile.ts";
import type { DecisionPackage, EffectiveProfile, ProfileEntry } from "../intelligence/types.ts";
import { getAdapterForIntentType, type ConnectorExecutionInput } from "../connectors/index.ts";
import { enqueueAutomationExecution } from "../automation_execution_enqueue.ts";

const TRIGGERS = new Set(["intent_created", "approval_completed", "retry", "repair", "manual"]);
const LEASE_SECONDS = 300;
const OUTCOME_TYPE_FOR_CAPABILITY: Record<string, string> = {
  "internal.record_execution": "controlled_execution_recorded",
  "internal.create_note": "internal_note_recorded",
};

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}
function err(code: string, message: string, retryable: boolean): WorkerHandlerResult {
  return { success: false, error: { code, message: message.slice(0, 500), retryable } };
}

export async function handleAutomationExecute(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin: db, tenantId, payload, jobId } = ctx;
  const worker = `automation.execute:${jobId ?? "manual"}`;

  // 1) payload (tenant is NEVER trusted from payload) ─────────────────────────
  const intentId = payload?.automation_intent_id;
  if (!isUuid(intentId)) return err("invalid_input", "automation_intent_id must be a uuid", false);
  const triggeredBy =
    typeof payload?.triggered_by === "string" && TRIGGERS.has(payload.triggered_by)
      ? (payload.triggered_by as string)
      : "manual";
  const correlationId = isUuid(payload?.correlation_id) ? (payload.correlation_id as string) : null;
  const now = new Date().toISOString();

  // 2) load intent + tenant ownership ─────────────────────────────────────────
  const { data: intent, error: iErr } = await db
    .from("automation_intents")
    .select(
      "id, tenant_id, action_object_id, intent_type, parameters, status, attempts, max_attempts, expires_at, lease_expires_at, connector_id, capability_key, decision_id, idempotency_key",
    )
    .eq("id", intentId)
    .maybeSingle();
  if (iErr) return err("intent_read_failed", iErr.message, true);
  if (!intent) return err("not_found", "automation intent does not exist", false);
  if (intent.tenant_id !== tenantId) {
    return err("cross_tenant_mismatch", "intent belongs to another tenant", false);
  }

  // 3) resolve facts (all fully resolved BEFORE the pure guard) ────────────────
  const { data: intentTypeRow } = await db
    .from("automation_intent_types")
    .select(
      "intent_type, connector_capability, risk_category, external_side_effect, supports_idempotency, supports_status_lookup, requires_approval, enabled, schema_version",
    )
    .eq("intent_type", intent.intent_type)
    .maybeSingle();

  const capabilityKey =
    (intent.capability_key as string | null) ??
    (intentTypeRow?.connector_capability as string | null) ??
    null;
  const connectorId = (intent.connector_id as string | null) ?? null;

  // Action object (same-tenant + its decision + domain for the profile).
  const { data: action } = await db
    .from("intelligence_objects")
    .select("id, tenant_id, domain, decision_id")
    .eq("id", intent.action_object_id)
    .maybeSingle();
  const decisionId =
    (intent.decision_id as string | null) ?? (action?.decision_id as string | null) ?? null;

  // Decision package (immutable) + supersession.
  let decisionPackage: DecisionPackage | null = null;
  let decisionDestination: string | null = null;
  let decisionTenantId: string | null = null;
  let decisionSuperseded = false;
  if (decisionId) {
    const { data: dec } = await db
      .from("decision_log")
      .select("id, tenant_id, decision, decision_package")
      .eq("id", decisionId)
      .maybeSingle();
    if (dec) {
      decisionTenantId = dec.tenant_id as string;
      decisionDestination = dec.decision as string | null;
      decisionPackage = (dec.decision_package as DecisionPackage | null) ?? null;
      const { data: superseders } = await db
        .from("decision_log")
        .select("id")
        .eq("supersedes", decisionId)
        .limit(1);
      decisionSuperseded = (superseders ?? []).length > 0;
    }
  }

  // Version/authority validity (a REVALIDATION, never a re-evaluation).
  const policyVersionsValid = await checkVersionsValid(db, decisionPackage);
  const authorityValid = decisionPackage?.authority?.withinDelegatedAuthority !== false;

  // Effective profile for the Operational Mode re-check.
  const profile = await resolveProfile(db, tenantId, (action?.domain as string | null) ?? "core");

  // Approval (approver kind is authoritative; required kind derived from routing).
  const requiredApproverKind = requiredApprover(decisionPackage);
  const { data: appr } = await db
    .from("automation_approvals")
    .select("approver_kind, decision, expires_at")
    .eq("tenant_id", tenantId)
    .eq("automation_intent_id", intentId)
    .eq("decision", "approved")
    .order("granted_at", { ascending: false })
    .limit(1);
  const approvalRow = (appr ?? [])[0] ?? null;

  // Connector + capability enablement.
  const connector = await resolveConnector(db, tenantId, connectorId, capabilityKey);

  // Idempotency key (deterministic) + prior success lookup.
  const idempotencyKey =
    (intent.idempotency_key as string | null) ??
    buildIdempotencyKey({
      tenantId,
      intentId: intent.id as string,
      actionObjectId: (intent.action_object_id as string | null) ?? null,
      decisionId,
      connectorId,
      capabilityKey,
      operationType: intent.intent_type as string,
      parameters: (intent.parameters as Record<string, unknown>) ?? {},
    });
  const { data: prior } = await db
    .from("automation_execution_attempts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("idempotency_key", idempotencyKey)
    .eq("status", "succeeded")
    .limit(1);
  const priorSucceededExecutionId = (prior ?? [])[0]?.id as string | undefined;

  // 3b) UNKNOWN-result recovery — a lost-response intent is NEVER blindly retried by
  // the normal path. It is reconciled by a status lookup (if supported) or routed to a
  // human review owner; resolution APPENDS a superseding attempt/outcome.
  if (intent.status === "unknown") {
    return await resolveUnknownIntent(db, {
      tenantId,
      intentId,
      intent: intent as Record<string, unknown>,
      supportsStatusLookup: !!intentTypeRow?.supports_status_lookup,
      capabilityKey,
      correlationId,
      jobId,
      now,
    });
  }

  // 4) PURE guard evaluation ─────────────────────────────────────────────────
  const guardInput: ExecutionGuardInput = {
    now,
    tenantId,
    intent: {
      id: intent.id as string,
      tenantId: intent.tenant_id as string,
      status: intent.status as string,
      intentType: intent.intent_type as string,
      capabilityKey,
      connectorId,
      actionObjectId: (intent.action_object_id as string | null) ?? null,
      decisionId,
      expiresAt: (intent.expires_at as string | null) ?? null,
      attempts: (intent.attempts as number) ?? 0,
      maxAttempts: (intent.max_attempts as number) ?? 5,
      leaseExpiresAt: (intent.lease_expires_at as string | null) ?? null,
    },
    action: action
      ? { exists: true, tenantId: action.tenant_id as string }
      : { exists: false, tenantId: null },
    intentType: intentTypeRow
      ? {
          intentType: intentTypeRow.intent_type as string,
          enabled: !!intentTypeRow.enabled,
          requiresApproval: !!intentTypeRow.requires_approval,
          externalSideEffect: !!intentTypeRow.external_side_effect,
          supportsIdempotency: !!intentTypeRow.supports_idempotency,
          supportsStatusLookup: !!intentTypeRow.supports_status_lookup,
          riskCategory: (intentTypeRow.risk_category as string | null) ?? null,
          schemaVersion: (intentTypeRow.schema_version as string | null) ?? null,
        }
      : null,
    decisionPackage,
    decisionDestination,
    decisionTenantId,
    decisionSuperseded,
    policyVersionsValid,
    authorityValid,
    profile,
    approval: approvalRow
      ? {
          present: true,
          approverKind: approvalRow.approver_kind as string,
          requiredApproverKind,
          expiresAt: (approvalRow.expires_at as string | null) ?? null,
          decision: approvalRow.decision as string,
        }
      : {
          present: false,
          approverKind: null,
          requiredApproverKind,
          expiresAt: null,
          decision: null,
        },
    connector,
    dependenciesMet: true, // v1: no dependency graph wired; guard path exists for the future
    priorSucceededExecutionId: priorSucceededExecutionId ?? null,
    leaseActiveByOtherWorker: false,
  };
  const guard = evaluateExecutionGuards(guardInput);

  // Append the immutable guard-decision audit.
  await db.from("automation_execution_guard_decisions").insert({
    tenant_id: tenantId,
    automation_intent_id: intentId,
    outcome: guard.outcome,
    reason_codes: guard.reasonCodes,
    evaluated_at: now,
    correlation_id: correlationId,
    job_id: jobId,
  });

  // 5) act on the guard outcome ──────────────────────────────────────────────
  if (guard.outcome === "ALREADY_COMPLETED") {
    return ok(intentId, "already_completed", {
      idempotent: true,
      prior_execution_id: priorSucceededExecutionId ?? null,
    });
  }
  if (guard.outcome === "EXPIRED") {
    await transition(db, tenantId, intentId, intent.status as string, "expired", now);
    await emit(db, {
      tenantId,
      type: "automation.intent.expired",
      subjectId: intentId,
      now,
      correlationId,
      jobId,
      payload: {},
    });
    return ok(intentId, "expired", { reason_codes: guard.reasonCodes });
  }
  if (guard.outcome === "APPROVAL_REQUIRED") {
    await emit(db, {
      tenantId,
      type: "automation.execution.waiting",
      subjectId: intentId,
      now,
      correlationId,
      jobId,
      payload: { reason_codes: guard.reasonCodes },
    });
    return ok(intentId, "approval_required", { reason_codes: guard.reasonCodes });
  }
  if (guard.outcome === "WAIT") {
    await emit(db, {
      tenantId,
      type: "automation.execution.waiting",
      subjectId: intentId,
      now,
      correlationId,
      jobId,
      payload: { reason_codes: guard.reasonCodes },
    });
    if (guard.retryAt) {
      await enqueueAutomationExecution(db, {
        tenantId,
        automationIntentId: intentId,
        triggeredBy: "retry",
        correlationId,
        availableAt: guard.retryAt,
      });
    }
    return ok(intentId, "waiting", {
      reason_codes: guard.reasonCodes,
      retry_at: guard.retryAt ?? null,
    });
  }
  if (guard.outcome === "BLOCKED") {
    await emit(db, {
      tenantId,
      type: "automation.execution.blocked",
      subjectId: intentId,
      now,
      correlationId,
      jobId,
      payload: { reason_codes: guard.reasonCodes },
    });
    return ok(intentId, "blocked", { reason_codes: guard.reasonCodes });
  }

  // 6) EXECUTION_ALLOWED — ATOMIC claim + durable in-flight attempt in ONE txn.
  // The RPC validates state + lease + budget, claims pending/failed → executing,
  // increments attempts exactly once, and inserts the immutable in-flight attempt.
  // If it returns nothing, THIS worker did not win the claim (or it is no longer
  // eligible) — treat as an idempotent wait, never a duplicate execution.
  const { data: claimRows, error: claimErr } = await db.rpc("automation_claim_and_start", {
    p_intent_id: intentId,
    p_tenant_id: tenantId,
    p_worker: worker,
    p_lease_seconds: LEASE_SECONDS,
    p_idempotency_key: idempotencyKey,
    p_correlation_id: correlationId,
    p_engine_version: AUTOMATION_EXECUTOR_VERSION,
  });
  if (claimErr) return err("claim_failed", claimErr.message, true);
  const claimed = (claimRows ?? [])[0] as
    { attempt_id: string; attempt_number: number } | undefined;
  if (!claimed) return ok(intentId, "waiting", { reason_codes: ["lease_active"] });
  const inFlightAttemptId = claimed.attempt_id;
  const nextAttempt = claimed.attempt_number;

  await emit(db, {
    tenantId,
    type: "automation.intent.claimed",
    subjectId: intentId,
    now,
    correlationId,
    jobId,
    payload: { attempt: nextAttempt },
  });
  await emit(db, {
    tenantId,
    type: "automation.execution.started",
    subjectId: intentId,
    now,
    correlationId,
    jobId,
    payload: { attempt: nextAttempt, in_flight_attempt_id: inFlightAttemptId },
  });

  // 7) resolve adapter + execute ─────────────────────────────────────────────
  const adapter = getAdapterForIntentType(intent.intent_type as string);
  const operationInput: ConnectorExecutionInput = {
    tenantId,
    intentId: intent.id as string,
    intentType: intent.intent_type as string,
    capabilityKey: capabilityKey ?? "",
    operationType: intent.intent_type as string,
    parameters: (intent.parameters as Record<string, unknown>) ?? {},
    idempotencyKey,
    correlationId,
  };

  let result: ConnectorExecutionResult;
  if (!adapter) {
    result = {
      outcome: "failed_permanent",
      errorCode: "no_adapter",
      errorMessage: "no adapter for intent type",
      retryable: false,
    };
  } else {
    const valid = adapter.validate(operationInput);
    if (!valid.ok) {
      result = {
        outcome: "failed_permanent",
        errorCode: valid.errorCode ?? "payload_invalid",
        errorMessage: valid.errorMessage ?? "invalid",
        retryable: false,
      };
    } else {
      try {
        result = await adapter.execute(operationInput, {
          supabaseAdmin: db,
          now,
          signal: ctx.signal,
        });
      } catch (e) {
        // A thrown adapter error is treated as UNKNOWN (the request may have landed
        // remotely) — never blindly retried.
        result = {
          outcome: "unknown",
          errorCode: "adapter_threw",
          errorMessage: e instanceof Error ? e.message.slice(0, 200) : "error",
          retryable: false,
        };
      }
    }
  }

  // 8) plan lifecycle + APPEND the immutable TERMINAL attempt (supersedes in-flight).
  const plan = planPostExecution(result, nextAttempt, (intent.max_attempts as number) ?? 5, now);
  const { data: attemptRow } = await db
    .from("automation_execution_attempts")
    .insert({
      tenant_id: tenantId,
      automation_intent_id: intentId,
      action_object_id: (intent.action_object_id as string | null) ?? null,
      connector_id: connectorId,
      capability_key: capabilityKey,
      operation_type: intent.intent_type as string,
      idempotency_key: idempotencyKey,
      attempt_number: nextAttempt,
      worker,
      started_at: now,
      completed_at: new Date().toISOString(),
      status: attemptStatus(result.outcome),
      request_fingerprint: idempotencyKey,
      request_snapshot: sanitizeParams((intent.parameters as Record<string, unknown>) ?? {}),
      external_reference: result.externalReference ?? null,
      response_class: result.outcome,
      result: result.result ?? null,
      error_code: result.errorCode ?? null,
      error_class: result.outcome.startsWith("failed") ? result.outcome : null,
      retryable: !!result.retryable,
      retry_at: plan.retryAt,
      correlation_id: correlationId,
      previous_attempt_id: inFlightAttemptId, // lineage to the durable in-flight row
      execution_engine_version: AUTOMATION_EXECUTOR_VERSION,
    })
    .select("id")
    .single();
  const attemptId = (attemptRow?.id as string | undefined) ?? inFlightAttemptId;

  // 9) transition intent + outcome + events ──────────────────────────────────
  await transition(db, tenantId, intentId, "executing", plan.toState, now, {
    last_error: result.errorCode ?? null,
    result: result.result ?? null,
    lease_expires_at: null,
  });

  let outcomeId: string | null = null;
  if (plan.toState === "succeeded") {
    outcomeId = await appendOperationalOutcome(db, {
      tenantId,
      intent,
      capabilityKey,
      attemptId,
      result,
      now,
      correlationId,
      jobId,
    });
    await emit(db, {
      tenantId,
      type: "automation.execution.succeeded",
      subjectId: intentId,
      now,
      correlationId,
      jobId,
      payload: { attempt: nextAttempt, external_reference: result.externalReference ?? null },
    });
  } else if (plan.toState === "unknown") {
    await emit(db, {
      tenantId,
      type: "automation.execution.unknown",
      subjectId: intentId,
      now,
      correlationId,
      jobId,
      payload: { attempt: nextAttempt },
    });
  } else {
    await emit(db, {
      tenantId,
      type: "automation.execution.failed",
      subjectId: intentId,
      now,
      correlationId,
      jobId,
      payload: { attempt: nextAttempt, reason_code: plan.reasonCode },
    });
    if (plan.enqueueRetry) {
      await enqueueAutomationExecution(db, {
        tenantId,
        automationIntentId: intentId,
        triggeredBy: "retry",
        correlationId,
        availableAt: plan.retryAt,
      });
      await emit(db, {
        tenantId,
        type: "automation.retry.scheduled",
        subjectId: intentId,
        now,
        correlationId,
        jobId,
        payload: { retry_at: plan.retryAt },
      });
    }
  }

  return ok(intentId, plan.toState, {
    execution_attempt_id: attemptId ?? null,
    outcome_id: outcomeId,
    attempt: nextAttempt,
    idempotency_key: idempotencyKey,
    retry_scheduled: plan.enqueueRetry,
    reason_code: plan.reasonCode,
  });
}

// ── helpers ─────────────────────────────────────────────────────────────────

function ok(intentId: string, status: string, extra: Record<string, unknown>): WorkerHandlerResult {
  return {
    success: true,
    recordsProcessed: 1,
    result: { automation_intent_id: intentId, status, ...extra },
  };
}
function attemptStatus(o: ConnectorExecutionResult["outcome"]): string {
  return o === "succeeded" ? "succeeded" : o === "unknown" ? "unknown" : o;
}
function sanitizeParams(p: Record<string, unknown>): Record<string, unknown> {
  // Drop anything that could carry a secret; keep bounded business parameters.
  const banned = /token|secret|password|credential|authorization|apikey|api_key/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (banned.test(k)) continue;
    out[k] = typeof v === "string" ? v.slice(0, 2000) : v;
  }
  return out;
}
function requiredApprover(pkg: DecisionPackage | null): string | null {
  const r = pkg?.routing;
  if (!r) return null;
  if (r.customerApprovalRequired) return "customer";
  if (r.tenantReviewRequired) return "tenant_senior";
  if (r.openfolkRequired) return "openfolk";
  return null;
}

async function checkVersionsValid(
  db: WorkerHandlerContext["supabaseAdmin"],
  pkg: DecisionPackage | null,
): Promise<boolean> {
  const v = pkg?.versions;
  if (!v) return true; // nothing versioned to revoke
  const ids = [
    ...(v.policyVersionIds ?? []),
    ...(v.learningVersionIds ?? []),
    ...(v.operatingProfileVersion ? [v.operatingProfileVersion] : []),
  ].filter((x): x is string => typeof x === "string");
  if (ids.length === 0) return true;
  const { data } = await db.from("config_versions").select("id, status").in("id", ids);
  // A referenced version that is no longer published (archived/superseded) revokes it.
  return (data ?? []).every((r) => (r as { status: string }).status === "published");
}

async function resolveProfile(
  db: WorkerHandlerContext["supabaseAdmin"],
  tenantId: string,
  domain: string,
): Promise<EffectiveProfile> {
  const { data: tenantRow } = await db
    .from("tenants")
    .select("industry")
    .eq("id", tenantId)
    .maybeSingle();
  const industry = (tenantRow?.industry as string | null) ?? null;
  const { data: entryRows } = await db
    .from("operating_profile_entries")
    .select("scope_kind, scope_ref, domain, namespace, key, value")
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
  return resolveEffectiveProfile((entryRows ?? []) as ProfileEntry[], {
    tenantId,
    industry,
    domain,
  });
}

async function resolveConnector(
  db: WorkerHandlerContext["supabaseAdmin"],
  tenantId: string,
  connectorId: string | null,
  capabilityKey: string | null,
): Promise<ExecutionGuardInput["connector"]> {
  if (!connectorId)
    return { exists: false, enabled: false, healthStatus: "unknown", capabilityEnabled: false };
  const { data: c } = await db
    .from("tenant_connectors")
    .select("enabled, status, health_status")
    .eq("tenant_id", tenantId)
    .eq("connector_id", connectorId)
    .maybeSingle();
  if (!c)
    return { exists: false, enabled: false, healthStatus: "unknown", capabilityEnabled: false };
  let capabilityEnabled = false;
  if (capabilityKey) {
    const { data: cap } = await db
      .from("tenant_connector_capabilities")
      .select("enabled")
      .eq("tenant_id", tenantId)
      .eq("connector_id", connectorId)
      .eq("capability_key", capabilityKey)
      .maybeSingle();
    capabilityEnabled = !!cap?.enabled;
  }
  return {
    exists: true,
    enabled: !!c.enabled,
    healthStatus: (c.health_status as string) ?? "unknown",
    capabilityEnabled,
  };
}

/**
 * Append the immutable OPERATIONAL outcome for a successful execution. Provenance is
 * explicit (layer, type, source kind + record id, attempt/action/intent ids, evidence,
 * verification state) and it is `system_observed` — never a business outcome. Deduped:
 * at most one non-superseded operational outcome per intent (so unknown-result
 * resolution cannot double-record); a correction would append a superseding outcome.
 */
async function appendOperationalOutcome(
  db: WorkerHandlerContext["supabaseAdmin"],
  args: {
    tenantId: string;
    intent: Record<string, unknown>;
    capabilityKey: string | null;
    attemptId: string | null;
    result: ConnectorExecutionResult;
    now: string;
    correlationId: string | null;
    jobId: string | null;
  },
): Promise<string | null> {
  const { tenantId, intent, capabilityKey, attemptId, result, now, correlationId, jobId } = args;
  const outcomeType = OUTCOME_TYPE_FOR_CAPABILITY[capabilityKey ?? ""] ?? null;
  if (!outcomeType) return null;
  const intentId = intent.id as string;
  const { data: existing } = await db
    .from("outcomes")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("automation_intent_id", intentId)
    .eq("outcome_type", outcomeType)
    .is("supersedes", null)
    .limit(1);
  if ((existing ?? []).length > 0) return (existing ?? [])[0].id as string;

  const { data: oc } = await db
    .from("outcomes")
    .insert({
      tenant_id: tenantId,
      action_object_id: (intent.action_object_id as string | null) ?? null,
      automation_intent_id: intentId,
      execution_attempt_id: attemptId,
      outcome_type: outcomeType,
      outcome_layer: "operational", // NEVER business — controlled adapters observe only
      status: "observed",
      verification_state: "system_observed",
      source_kind: "automation_execution",
      source_record_id: attemptId,
      observed_at: now,
      evidence: result.evidenceRefs ?? [],
      confidence: null,
      source: "automation.execute",
      external_reference: result.externalReference ?? null,
      correlation_id: correlationId,
    })
    .select("id")
    .single();
  const id = (oc?.id as string | undefined) ?? null;
  if (id) {
    await emit(db, {
      tenantId,
      type: "automation.outcome.recorded",
      subjectType: "outcome",
      subjectId: id,
      now,
      correlationId,
      jobId,
      payload: { intent_id: intentId, outcome_type: outcomeType },
    });
  }
  return id;
}

/**
 * Reconcile an `unknown` (lost-response) intent WITHOUT a blind retry. If the connector
 * supports status lookup and an external reference exists, resolve via getStatus and
 * append a superseding attempt (and outcome, if now succeeded); otherwise route to the
 * correct human review owner. Never rewrites history.
 */
async function resolveUnknownIntent(
  db: WorkerHandlerContext["supabaseAdmin"],
  args: {
    tenantId: string;
    intentId: string;
    intent: Record<string, unknown>;
    supportsStatusLookup: boolean;
    capabilityKey: string | null;
    correlationId: string | null;
    jobId: string | null;
    now: string;
  },
): Promise<WorkerHandlerResult> {
  const {
    tenantId,
    intentId,
    intent,
    supportsStatusLookup,
    capabilityKey,
    correlationId,
    jobId,
    now,
  } = args;
  const { data: attempts } = await db
    .from("automation_execution_attempts")
    .select("id, external_reference")
    .eq("tenant_id", tenantId)
    .eq("automation_intent_id", intentId)
    .order("started_at", { ascending: false })
    .limit(1);
  const last = (attempts ?? [])[0];
  const extRef = (last?.external_reference as string | null) ?? null;
  const plan = planUnknownResolution({ supportsStatusLookup, hasExternalReference: !!extRef });

  if (plan.path === "status_check") {
    const adapter = getAdapterForIntentType(intent.intent_type as string);
    if (adapter?.getStatus && extRef) {
      let statusResult: ConnectorExecutionResult;
      try {
        statusResult = await adapter.getStatus(extRef, { supabaseAdmin: db, now });
      } catch {
        statusResult = { outcome: "unknown", retryable: false };
      }
      const post = planPostExecution(
        statusResult,
        (intent.attempts as number) ?? 1,
        (intent.max_attempts as number) ?? 5,
        now,
      );
      const { data: resAttempt } = await db
        .from("automation_execution_attempts")
        .insert({
          tenant_id: tenantId,
          automation_intent_id: intentId,
          action_object_id: (intent.action_object_id as string | null) ?? null,
          connector_id: (intent.connector_id as string | null) ?? null,
          capability_key: capabilityKey,
          operation_type: intent.intent_type as string,
          idempotency_key: (intent.idempotency_key as string | null) ?? "",
          attempt_number: (intent.attempts as number) ?? 1,
          worker: `status_check:${jobId ?? "manual"}`,
          started_at: now,
          completed_at: new Date().toISOString(),
          status: attemptStatus(statusResult.outcome),
          response_class: statusResult.outcome,
          external_reference: statusResult.externalReference ?? extRef,
          result: statusResult.result ?? null,
          error_code: statusResult.errorCode ?? null,
          retryable: false,
          correlation_id: correlationId,
          previous_attempt_id: (last?.id as string | undefined) ?? null,
          execution_engine_version: AUTOMATION_EXECUTOR_VERSION,
        })
        .select("id")
        .single();
      const resAttemptId = (resAttempt?.id as string | undefined) ?? null;

      if (post.toState === "succeeded") {
        await transition(db, tenantId, intentId, "unknown", "succeeded", now, {
          lease_expires_at: null,
        });
        const outcomeId = await appendOperationalOutcome(db, {
          tenantId,
          intent,
          capabilityKey,
          attemptId: resAttemptId,
          result: statusResult,
          now,
          correlationId,
          jobId,
        });
        await emit(db, {
          tenantId,
          type: "automation.execution.succeeded",
          subjectId: intentId,
          now,
          correlationId,
          jobId,
          payload: { resolved_from: "unknown" },
        });
        return ok(intentId, "succeeded", { resolved_from: "unknown", outcome_id: outcomeId });
      }
      if (post.toState === "failed") {
        await transition(db, tenantId, intentId, "unknown", "failed", now, {
          lease_expires_at: null,
        });
        await emit(db, {
          tenantId,
          type: "automation.execution.failed",
          subjectId: intentId,
          now,
          correlationId,
          jobId,
          payload: { resolved_from: "unknown" },
        });
        return ok(intentId, "failed", { resolved_from: "unknown" });
      }
      // still unknown → fall through to review
    }
  }

  await routeUnknownToReview(db, { tenantId, intentId, intent, correlationId });
  return ok(intentId, "unknown_routed_to_review", { reason_codes: ["external_result_unknown"] });
}

/** Route an unresolved unknown intent to a human review owner (idempotent — never
 *  stacks duplicate pending review tasks for the same object). */
async function routeUnknownToReview(
  db: WorkerHandlerContext["supabaseAdmin"],
  args: {
    tenantId: string;
    intentId: string;
    intent: Record<string, unknown>;
    correlationId: string | null;
  },
): Promise<void> {
  const objectId = (args.intent.action_object_id as string | null) ?? null;
  if (!objectId) return;
  const { data: existing } = await db
    .from("review_tasks")
    .select("id")
    .eq("tenant_id", args.tenantId)
    .eq("object_id", objectId)
    .eq("route", "openfolk")
    .eq("status", "pending")
    .limit(1);
  if ((existing ?? []).length > 0) return;
  await db.from("review_tasks").insert({
    tenant_id: args.tenantId,
    object_id: objectId,
    route: "openfolk",
    reason: "automation execution result unknown — reconcile before any retry",
    decision_id: (args.intent.decision_id as string | null) ?? null,
  });
}

/** Legal, tenant-scoped lifecycle transition (the DB trigger also enforces legality). */
async function transition(
  db: WorkerHandlerContext["supabaseAdmin"],
  tenantId: string,
  intentId: string,
  from: string,
  to: string,
  now: string,
  set: Record<string, unknown> = {},
): Promise<void> {
  if (!isLegalTransition(from, to)) return; // defensive; the trigger is the hard guard
  await db
    .from("automation_intents")
    .update({ status: to, decided_at: now, ...set })
    .eq("id", intentId)
    .eq("tenant_id", tenantId)
    .eq("status", from);
}

async function emit(
  db: WorkerHandlerContext["supabaseAdmin"],
  ev: {
    tenantId: string;
    type: string;
    subjectType?: string;
    subjectId: string;
    now: string;
    correlationId: string | null;
    jobId: string | null;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  // Best-effort; a 23505 on the one-pending-per-subject index = already announced.
  await db.from("platform_events").insert({
    tenant_id: ev.tenantId,
    event_type: ev.type,
    subject_type: ev.subjectType ?? "automation_intent",
    subject_id: ev.subjectId,
    source: "automation.execute",
    domain: "core",
    status: "pending",
    actor: { kind: "automation", ref: "automation.execute" },
    occurred_at: ev.now,
    correlation_id: ev.correlationId,
    payload: ev.payload,
    metadata: { job_id: ev.jobId },
  });
}
