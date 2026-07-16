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

/** The registered execution contract for a capability: what outcome it must record + the
 *  adapter version the envelope binds. No contract ⇒ the capability is NOT executable. */
interface CapabilityContract {
  outcomeType: string;
  outcomeLayer: string;
  adapterVersion: string;
}
async function resolveCapabilityContract(
  db: WorkerHandlerContext["supabaseAdmin"],
  capabilityKey: string | null,
): Promise<CapabilityContract | null> {
  if (!capabilityKey) return null;
  const { data } = await db
    .from("automation_capability_contracts")
    .select("outcome_type, outcome_layer, adapter_version, enabled")
    .eq("capability_key", capabilityKey)
    .maybeSingle();
  if (!data || data.enabled === false) return null;
  return {
    outcomeType: data.outcome_type as string,
    outcomeLayer: data.outcome_layer as string,
    adapterVersion: data.adapter_version as string,
  };
}

/** The exact immutable envelope the claim RPC returns; the adapter executes ONLY this. */
interface ClaimedEnvelope {
  attempt_id: string;
  attempt_number: number;
  envelope_parameters: Record<string, unknown> | null;
  capability_key: string | null;
  connector_id: string | null;
  intent_type: string | null;
  action_object_id: string | null;
  decision_id: string | null;
  schema_version: string | null;
  adapter_version: string | null;
  envelope_hash: string | null;
}

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
  if (intent.status === "executing") {
    const leaseExpired =
      typeof intent.lease_expires_at === "string" &&
      new Date(intent.lease_expires_at as string).getTime() < Date.now();
    if (!leaseExpired) {
      return ok(intentId, "waiting", { reason_codes: ["lease_active"] });
    }
    const { data: recovered, error: recoveryError } = await db.rpc(
      "automation_recover_expired_execution",
      { p_tenant_id: tenantId, p_intent_id: intentId, p_job_id: jobId },
    );
    if (recoveryError) return err("execution_recovery_failed", recoveryError.message, true);
    return ok(intentId, recovered ? "unknown" : "waiting", {
      reason_codes: recovered ? ["execution_lease_expired"] : ["lease_active"],
    });
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

  // P0-4: the capability's registered outcome contract (its presence gates execution).
  const contract = await resolveCapabilityContract(db, capabilityKey);

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
      contract,
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
    outcomeContractPresent: !!contract,
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
      // Distinct per-attempt retry key: never collides with (and vanishes behind) the
      // currently-running base job under the active-job unique index.
      await enqueueAutomationExecution(db, {
        tenantId,
        automationIntentId: intentId,
        triggeredBy: "retry",
        correlationId,
        availableAt: guard.retryAt,
        retryToken: (intent.attempts as number) ?? 0,
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
  const claimed = (claimRows ?? [])[0] as ClaimedEnvelope | undefined;
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

  // 7) resolve adapter + execute the EXACT CLAIMED ENVELOPE ───────────────────
  // P0-1: the adapter runs the envelope the claim RPC locked + hashed (returned above) —
  // NOT a fresh read of the intent. This closes the read-vs-hash gap: the executed payload
  // is provably identical to the hashed, approved one.
  const adapter = getAdapterForIntentType(claimed.intent_type ?? (intent.intent_type as string));
  const operationInput: ConnectorExecutionInput = {
    tenantId,
    intentId: intent.id as string,
    intentType: claimed.intent_type ?? (intent.intent_type as string),
    capabilityKey: claimed.capability_key ?? capabilityKey ?? "",
    operationType: claimed.intent_type ?? (intent.intent_type as string),
    parameters: (claimed.envelope_parameters as Record<string, unknown>) ?? {},
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
  } else if (adapter.adapterVersion !== claimed.adapter_version) {
    // The running adapter code must match the contract version bound into the envelope.
    result = {
      outcome: "failed_permanent",
      errorCode: "adapter_version_mismatch",
      errorMessage: `adapter ${adapter.adapterVersion} != contract ${claimed.adapter_version}`,
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

  // 8) plan lifecycle, then atomically commit terminal attempt + intent state + outcome +
  // event (+ retry job when needed). The external call cannot share a DB transaction; this
  // RPC is the single local commit point for its result.
  const plan = planPostExecution(result, nextAttempt, (intent.max_attempts as number) ?? 5, now);
  const outcomeType = plan.toState === "succeeded" ? (contract?.outcomeType ?? null) : null;
  const finalArgs = {
    p_tenant_id: tenantId,
    p_intent_id: intentId,
    p_inflight_attempt_id: inFlightAttemptId,
    p_worker: worker,
    p_to_state: plan.toState,
    p_result: result.result ?? {},
    p_error_code: result.errorCode ?? null,
    p_attempt_status: attemptStatus(result.outcome),
    p_retryable: !!result.retryable,
    p_retry_at: plan.enqueueRetry ? plan.retryAt : null,
    p_external_reference: result.externalReference ?? null,
    p_response_class: result.outcome,
    p_outcome_type: outcomeType,
    p_outcome_layer: contract?.outcomeLayer ?? "operational",
    p_correlation_id: correlationId,
    p_job_id: jobId,
  };
  // One immediate retry is safe: the RPC is atomic and the intent row remains executing
  // when it fails, so there can be no partially committed duplicate.
  let finalised = await db.rpc("automation_finalize_execution", finalArgs);
  if (finalised.error) finalised = await db.rpc("automation_finalize_execution", finalArgs);
  if (finalised.error) {
    return err("finalisation_failed", finalised.error.message, true);
  }
  const finalRow = (finalised.data ?? [])[0] as
    { execution_attempt_id?: string; outcome_id?: string | null } | undefined;
  const attemptId = finalRow?.execution_attempt_id ?? null;
  const outcomeId = finalRow?.outcome_id ?? null;

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
 * Reconcile an `unknown` (lost-response) intent WITHOUT a blind retry. It performs only the
 * (external) status lookup here; the LOCAL commit — superseding attempt + lifecycle transition
 * + outcome, or routing to human review when still unknown — goes through ONE atomic RPC
 * (automation_resolve_unknown_execution), the same single-transaction mechanism finalise and
 * recover use. Never rewrites history; never blindly retries.
 */
async function resolveUnknownIntent(
  db: WorkerHandlerContext["supabaseAdmin"],
  args: {
    tenantId: string;
    intentId: string;
    intent: Record<string, unknown>;
    supportsStatusLookup: boolean;
    contract: CapabilityContract | null;
    correlationId: string | null;
    jobId: string | null;
    now: string;
  },
): Promise<WorkerHandlerResult> {
  const { tenantId, intentId, intent, supportsStatusLookup, contract, correlationId, jobId, now } =
    args;
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

  // Default resolution: still unknown ⇒ route to review (p_to_state 'unknown').
  let statusResult: ConnectorExecutionResult | null = null;
  let toState: "succeeded" | "failed" | "unknown" = "unknown";
  if (plan.path === "status_check") {
    const adapter = getAdapterForIntentType(intent.intent_type as string);
    if (adapter?.getStatus && extRef) {
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
      if (post.toState === "succeeded" || post.toState === "failed") toState = post.toState;
    }
  }

  const outcomeType = toState === "succeeded" ? (contract?.outcomeType ?? null) : null;
  const { data: rows, error } = await db.rpc("automation_resolve_unknown_execution", {
    p_tenant_id: tenantId,
    p_intent_id: intentId,
    p_to_state: toState,
    p_result: statusResult?.result ?? {},
    p_error_code: statusResult?.errorCode ?? null,
    p_attempt_status: statusResult ? attemptStatus(statusResult.outcome) : "unknown",
    p_external_reference: statusResult?.externalReference ?? extRef,
    p_response_class: statusResult?.outcome ?? "unknown",
    p_outcome_type: outcomeType,
    p_outcome_layer: contract?.outcomeLayer ?? "operational",
    p_correlation_id: correlationId,
    p_job_id: jobId,
  });
  if (error) return err("unknown_resolution_failed", error.message, true);
  const row = (rows ?? [])[0] as
    { resolution?: string; execution_attempt_id?: string; outcome_id?: string | null } | undefined;
  const resolution = row?.resolution ?? "routed_to_review";
  if (resolution === "routed_to_review") {
    return ok(intentId, "unknown_routed_to_review", { reason_codes: ["external_result_unknown"] });
  }
  return ok(intentId, resolution, {
    resolved_from: "unknown",
    execution_attempt_id: row?.execution_attempt_id ?? null,
    outcome_id: row?.outcome_id ?? null,
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
