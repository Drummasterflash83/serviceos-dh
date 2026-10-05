// ServiceOS — Worker handler: objective.evaluate
//
// The impure SHELL around the pure Objective Health / Contribution evaluators.
// Given an objective (chosen by a measurement writer, the repair scanner, a parent
// trigger or a manual replay) it: loads the objective's version, metrics, metric
// definitions, constraints, dependency health and in-scope measurements; normalises
// them; derives a DETERMINISTIC evaluation identity; calls the pure evaluator;
// APPENDS one immutable objective_health snapshot (idempotent on the identity);
// records honest contribution assessments where evidence exists; publishes factual
// events; and enqueues a bounded parent re-evaluation on a status change.
//
// It computes NO health formula (that lives only in evaluateObjectiveHealth), never
// mutates a prior snapshot, never creates an Action/Automation Intent, never claims a
// confirmed contribution without immutable outcome evidence, and never changes the
// objective's strategic lifecycle. Tenant identity comes from the job context; the
// objective/metrics/measurements must all belong to it or the job is rejected
// cross-tenant. Domain-agnostic: ServiceOS and ProductOS share this path.

import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";
import {
  OBJECTIVE_EVALUATOR_VERSION,
  buildObjectiveInputHash,
  diffObjectiveHealth,
  evaluateNormalized,
  normalizeEvaluationInput,
  planContributions,
  planObjectiveEvents,
  shouldEnqueueParent,
  utcDayBucket,
  type ContributionCandidate,
  type LoadedConstraint,
  type LoadedDependency,
  type LoadedMeasurementRow,
  type LoadedMetricDef,
  type LoadedObjectiveMetric,
  type LoadedObjectiveRow,
  type NormalizedEvaluationInput,
  type OutcomeEvidenceRef,
  type PriorHealth,
} from "../intelligence/objective_evaluation.ts";
import { stableHash } from "../intelligence/policy.ts";
import { enqueueObjectiveEvaluation } from "../objective_evaluation_enqueue.ts";

const TRIGGERS = new Set([
  "measurement",
  "outcome",
  "constraint_change",
  "dependency_change",
  "manual",
  "backfill",
]);

const MEASUREMENT_SCAN_LIMIT = 500; // bounded window; the evaluator picks the latest per metric

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}
function isIso(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

export async function handleObjectiveEvaluate(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin: db, tenantId, payload, jobId } = ctx;

  // 1) validate the narrow payload (tenant is NEVER trusted from payload) ──────
  const objectiveId = payload?.objective_id;
  if (!isUuid(objectiveId)) {
    return err("invalid_input", "payload.objective_id must be a uuid", false);
  }
  const triggeredBy =
    typeof payload?.triggered_by === "string" && TRIGGERS.has(payload.triggered_by)
      ? (payload.triggered_by as string)
      : "manual";
  const force = payload?.force === true;
  const correlationId = isUuid(payload?.correlation_id) ? (payload.correlation_id as string) : null;
  const now = isIso(payload?.evaluated_at)
    ? (payload.evaluated_at as string)
    : new Date().toISOString();
  const timeBucket = utcDayBucket(now);

  // 2) load the objective + verify tenant ownership (service role bypasses RLS) ─
  const { data: obj, error: objErr } = await db
    .from("objectives")
    .select(
      "id, tenant_id, objective_type, title, status, parent_objective_id, starts_at, target_at, stale_after_hours, version_id",
    )
    .eq("id", objectiveId)
    .maybeSingle();
  if (objErr) return err("objective_read_failed", objErr.message, true);
  if (!obj) return err("not_found", "objective does not exist", false);
  if (obj.tenant_id !== tenantId) {
    return err("cross_tenant_mismatch", "objective belongs to another tenant", false);
  }
  const objectiveRow: LoadedObjectiveRow = {
    id: obj.id as string,
    objective_type: obj.objective_type as string,
    title: obj.title as string,
    status: obj.status as string,
    parent_objective_id: (obj.parent_objective_id as string | null) ?? null,
    starts_at: (obj.starts_at as string | null) ?? null,
    target_at: (obj.target_at as string | null) ?? null,
    stale_after_hours: (obj.stale_after_hours as number | null) ?? null,
    version_id: obj.version_id as string,
  };

  // 3) load metrics, constraints, metric definitions ──────────────────────────
  const [{ data: omRows, error: omErr }, { data: conRows, error: conErr }] = await Promise.all([
    db
      .from("objective_metrics")
      .select(
        "metric_id, role, direction, baseline_value, baseline_unit, baseline_currency, target_value, target_unit, target_currency, target_range_min, target_range_max, weight",
      )
      .eq("tenant_id", tenantId)
      .eq("objective_id", objectiveId),
    db
      .from("objective_constraints")
      .select("key, kind, description, metric_id, direction, threshold, unit, version_id")
      .eq("tenant_id", tenantId)
      .eq("objective_id", objectiveId),
  ]);
  if (omErr) return err("objective_metrics_read_failed", omErr.message, true);
  if (conErr) return err("objective_constraints_read_failed", conErr.message, true);
  const objectiveMetrics = (omRows ?? []) as LoadedObjectiveMetric[];
  const constraints = (conRows ?? []) as LoadedConstraint[];

  const metricIds = Array.from(
    new Set([
      ...objectiveMetrics.map((m) => m.metric_id),
      ...constraints.map((c) => c.metric_id).filter((x): x is string => !!x),
    ]),
  );

  let metricDefs: LoadedMetricDef[] = [];
  if (metricIds.length > 0) {
    const { data: defRows, error: defErr } = await db
      .from("metric_definitions")
      .select("id, tenant_id, key, unit, currency, direction")
      .in("id", metricIds);
    if (defErr) return err("metric_definitions_read_failed", defErr.message, true);
    // SECURITY: a referenced metric owned by another tenant is a cross-tenant leak.
    for (const d of defRows ?? []) {
      if ((d as { tenant_id: string }).tenant_id !== tenantId) {
        return err("cross_tenant_mismatch", "metric belongs to another tenant", false);
      }
    }
    metricDefs = (defRows ?? []).map((d) => ({
      id: (d as { id: string }).id,
      key: (d as { key: string }).key,
      unit: (d as { unit: string | null }).unit,
      currency: (d as { currency: string | null }).currency,
      direction: (d as { direction: string | null }).direction,
    }));
  }

  // 4) dependency health (explicit depends_on links → each dependency's latest) ─
  const dependencies = await loadDependencies(db, tenantId, objectiveId);

  // 5) in-scope measurements (bounded window; tenant + metric scoped) ──────────
  let measurements: LoadedMeasurementRow[] = [];
  if (metricIds.length > 0) {
    const { data: mRows, error: mErr } = await db
      .from("measurements")
      .select(
        "id, metric_id, value, unit, currency, measured_at, source, confidence, freshness, milestone_reached",
      )
      .eq("tenant_id", tenantId)
      .in("metric_id", metricIds)
      .order("measured_at", { ascending: false })
      .limit(MEASUREMENT_SCAN_LIMIT);
    if (mErr) return err("measurements_read_failed", mErr.message, true);
    measurements = (mRows ?? []) as LoadedMeasurementRow[];
  }

  // 6) normalise + derive the deterministic evaluation identity ────────────────
  const input = normalizeEvaluationInput({
    objective: objectiveRow,
    objectiveMetrics,
    metricDefs,
    constraints,
    dependencies,
    measurements,
  });
  const nonce = force ? (asStr(payload?.nonce) ?? correlationId ?? jobId ?? "force") : null;
  const inputHash = buildObjectiveInputHash({
    tenantId,
    objectiveId,
    objectiveVersionId: input.objectiveVersionId,
    objectiveMetrics,
    constraints,
    selected: input.selected,
    dependencies,
    timeBucket,
    nonce,
  });

  // 7) idempotency: a snapshot with this identity already exists → no-op reuse ─
  const { data: existing } = await db
    .from("objective_health")
    .select("id, status, progress, confidence")
    .eq("tenant_id", tenantId)
    .eq("objective_id", objectiveId)
    .eq("input_hash", inputHash)
    .maybeSingle();
  if (existing) {
    return {
      success: true,
      recordsProcessed: 0,
      result: {
        objective_id: objectiveId,
        health_snapshot_id: existing.id,
        status: existing.status,
        idempotent: true,
        status_changed: false,
        contributions_assessed: 0,
        parent_jobs_enqueued: 0,
      },
    };
  }

  // 8) prior snapshot (for diff + lineage) — read-only, never mutated ──────────
  const { data: prevRows } = await db
    .from("objective_health")
    .select("id, status, progress, confidence, stale_measurements, blockers")
    .eq("tenant_id", tenantId)
    .eq("objective_id", objectiveId)
    .order("evaluated_at", { ascending: false })
    .limit(1);
  const prev = (prevRows ?? [])[0] ?? null;

  // 9) PURE evaluation (single formula site) ──────────────────────────────────
  const health = evaluateNormalized(input, now);

  // 10) append the immutable snapshot (evidence = normalized input + refs only) ─
  const snapshotEvidence = {
    objective: input.objective,
    selected: input.selected,
    triggered_by: triggeredBy,
    evaluator_version: OBJECTIVE_EVALUATOR_VERSION,
    time_bucket: timeBucket,
  };
  const { data: ins, error: insErr } = await db
    .from("objective_health")
    .insert({
      tenant_id: tenantId,
      objective_id: objectiveId,
      status: health.status,
      progress: health.progress,
      confidence: health.confidence,
      reasons: health.reasons,
      blockers: health.blockers,
      stale_measurements: health.staleMeasurements,
      evaluated_at: now,
      objective_version_id: input.objectiveVersionId,
      evaluator_version: OBJECTIVE_EVALUATOR_VERSION,
      input_hash: inputHash,
      triggered_by: triggeredBy,
      snapshot: snapshotEvidence,
      job_id: jobId,
      correlation_id: correlationId,
      supersedes: prev?.id ?? null,
    })
    .select("id")
    .single();

  // A concurrent worker may have inserted the same identity first (unique index):
  // treat as an idempotent success and DO NOT re-emit events.
  if (insErr) {
    if ((insErr as { code?: string }).code === "23505") {
      const { data: raced } = await db
        .from("objective_health")
        .select("id, status")
        .eq("tenant_id", tenantId)
        .eq("objective_id", objectiveId)
        .eq("input_hash", inputHash)
        .maybeSingle();
      return {
        success: true,
        recordsProcessed: 0,
        result: {
          objective_id: objectiveId,
          health_snapshot_id: raced?.id ?? null,
          status: raced?.status ?? health.status,
          idempotent: true,
          status_changed: false,
          contributions_assessed: 0,
          parent_jobs_enqueued: 0,
        },
      };
    }
    return err("health_insert_failed", insErr.message, true);
  }
  const snapshotId = ins!.id as string;

  // 11) diff + factual events (state-change events only on a real change) ──────
  const prior: PriorHealth | null = prev
    ? {
        status: prev.status as string,
        progress: (prev.progress as number | null) ?? null,
        confidence: (prev.confidence as number | null) ?? null,
        staleMeasurements: (prev.stale_measurements as string[] | null) ?? [],
        blockers: (prev.blockers as string[] | null) ?? [],
      }
    : null;
  const change = diffObjectiveHealth(prior, health);
  const planned = planObjectiveEvents({ objectiveId, snapshotId, health, change });
  for (const ev of planned) {
    await emitEvent(db, {
      tenantId,
      type: ev.type,
      subjectType: ev.subjectType,
      subjectId: ev.subjectId,
      occurredAt: now,
      correlationId,
      jobId,
      payload: ev.payload,
    });
  }

  // 12) honest contribution assessment (only where verified links + evidence) ──
  const contributionsAssessed = await assessContributions(db, {
    tenantId,
    objectiveId,
    input,
    now,
    correlationId,
    jobId,
  });

  // 13) bounded parent propagation (cycle-safe via schema trigger + change gate) ─
  let parentJobsEnqueued = 0;
  if (shouldEnqueueParent(change, objectiveRow.parent_objective_id)) {
    const r = await enqueueObjectiveEvaluation(db, {
      tenantId,
      objectiveId: objectiveRow.parent_objective_id as string,
      triggeredBy: "dependency_change",
      correlationId,
    });
    if (r.id && !r.duplicate) parentJobsEnqueued = 1;
  }

  return {
    success: true,
    recordsProcessed: 1,
    result: {
      objective_id: objectiveId,
      health_snapshot_id: snapshotId,
      status: health.status,
      progress: health.progress,
      confidence: health.confidence,
      previous_status: change.previousStatus,
      status_changed: change.statusChanged,
      input_hash: inputHash,
      triggered_by: triggeredBy,
      contributions_assessed: contributionsAssessed,
      parent_jobs_enqueued: parentJobsEnqueued,
    },
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function err(code: string, message: string, retryable: boolean): WorkerHandlerResult {
  return { success: false, error: { code, message: message.slice(0, 500), retryable } };
}
function asStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Load the objective's dependencies (explicit depends_on links) with each one's
 *  latest health status. Tenant-scoped, so cross-tenant dependencies are excluded. */
async function loadDependencies(
  db: WorkerHandlerContext["supabaseAdmin"],
  tenantId: string,
  objectiveId: string,
): Promise<LoadedDependency[]> {
  const { data: links } = await db
    .from("objective_links")
    .select("target_ref")
    .eq("tenant_id", tenantId)
    .eq("objective_id", objectiveId)
    .eq("relation", "depends_on")
    .eq("target_kind", "objective");
  const depIds = Array.from(
    new Set(((links ?? []) as { target_ref: string }[]).map((l) => l.target_ref).filter(isUuid)),
  );
  const deps: LoadedDependency[] = [];
  for (const depId of depIds) {
    const { data: h } = await db
      .from("objective_health")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("objective_id", depId)
      .order("evaluated_at", { ascending: false })
      .limit(1);
    deps.push({ id: depId, healthStatus: ((h ?? [])[0]?.status as string) ?? "unknown" });
  }
  return deps;
}

/**
 * Honest v1 contribution. An approved + VERIFIED objective link establishes an
 * EXPECTED contribution — it is NOT evidence that an outcome occurred, so it is
 * never turned into a completed outcome here. Attribution requires IMMUTABLE outcome
 * evidence of a supported type; ServiceOS has no first-class Outcomes layer yet, so
 * `loadImmutableOutcomeEvidence` returns none and a confirmed contribution is
 * structurally impossible (the pure `planContributions` boundary guarantees it, even
 * if a future bug supplied outcomes). A verified expected link therefore records
 * `expected`; a would-be confirmation without evidence collapses to `inconclusive`.
 * Assessments are append-only and idempotent by input hash. Returns the count
 * persisted this run.
 */
async function assessContributions(
  db: WorkerHandlerContext["supabaseAdmin"],
  args: {
    tenantId: string;
    objectiveId: string;
    input: NormalizedEvaluationInput;
    now: string;
    correlationId: string | null;
    jobId: string | null;
  },
): Promise<number> {
  const { tenantId, objectiveId, input, correlationId, jobId } = args;
  if (!input.primaryMetricKey) return 0; // nothing to attribute against

  // Approved + verified links establish EXPECTED contribution (not observed outcomes).
  const { data: links } = await db
    .from("objective_links")
    .select("id, relation, expected_contribution, verification_state, approved")
    .eq("tenant_id", tenantId)
    .eq("objective_id", objectiveId)
    .eq("approved", true)
    .in("relation", ["contributes_to", "supports"])
    .in("verification_state", ["verified_published", "approved_link"]);
  if (!links || links.length === 0) return 0;

  // v1 has NO supported immutable outcome-evidence source → confirmation impossible.
  const evidence: OutcomeEvidenceRef[] = await loadImmutableOutcomeEvidence();

  const candidates: ContributionCandidate[] = (links as Array<Record<string, unknown>>).map(
    (link) => ({
      linkId: String(link.id),
      expected: {
        objectiveId,
        metricKey: input.primaryMetricKey,
        expectedDirection: input.objective.direction,
        verified: true, // gated above by approved + verified_published/approved_link
      },
    }),
  );
  const measurements = input.measurements.filter((m) => m.metricKey === input.primaryMetricKey);
  const planned = planContributions(candidates, evidence, measurements);

  let persisted = 0;
  for (const p of planned) {
    // Idempotent per (link, supported-evidence set). Independent of measurements while
    // there is no outcome evidence, so an `expected` assessment is recorded once.
    const contribHash = stableHash({
      v: OBJECTIVE_EVALUATOR_VERSION,
      link: p.linkId,
      metricKey: input.primaryMetricKey,
      state: p.assessment.state,
      evidence: evidence.map((e) => `${e.type}:${e.ref}`).sort(),
    });

    const { data: existing } = await db
      .from("objective_contribution_assessments")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("objective_id", objectiveId)
      .eq("objective_link_id", p.linkId)
      .eq("input_hash", contribHash)
      .maybeSingle();
    if (existing) continue; // idempotent — already recorded this evidence

    const { data: ins, error: insErr } = await db
      .from("objective_contribution_assessments")
      .insert({
        tenant_id: tenantId,
        objective_id: objectiveId,
        objective_link_id: p.linkId,
        metric_id: null,
        state: p.assessment.state,
        confidence: p.assessment.confidence,
        observed_movement: p.assessment.observedMovement,
        rationale: p.assessment.rationale,
        evidence: evidence,
        input_hash: contribHash,
        evaluator_version: OBJECTIVE_EVALUATOR_VERSION,
        job_id: jobId,
        correlation_id: correlationId,
      })
      .select("id")
      .single();
    if (insErr || !ins) continue; // best-effort; a race on the unique index is fine
    persisted += 1;

    await emitEvent(db, {
      tenantId,
      type: "objective.contribution.assessed",
      subjectType: "objective_contribution_assessment",
      subjectId: ins.id as string,
      occurredAt: args.now,
      correlationId,
      jobId,
      payload: { objective_id: objectiveId, link_id: p.linkId, state: p.assessment.state },
    });
  }
  return persisted;
}

/**
 * Load immutable observed-outcome evidence for attribution. v1 has NO first-class
 * Outcomes layer, so there is no supported immutable evidence type and this returns
 * none — making confirmed contribution impossible by construction. When the Outcomes
 * layer lands, this resolves verified immutable outcome records (and only those).
 */
async function loadImmutableOutcomeEvidence(): Promise<OutcomeEvidenceRef[]> {
  return [];
}

/** Publish one factual event with the hardened envelope. A collision on the
 *  one-pending-per-subject unique index means it is already announced — swallow it. */
async function emitEvent(
  db: WorkerHandlerContext["supabaseAdmin"],
  ev: {
    tenantId: string;
    type: string;
    subjectType: string;
    subjectId: string;
    occurredAt: string;
    correlationId: string | null;
    jobId: string | null;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  // Best-effort: a 23505 means "already announced" (one-pending-per-subject index),
  // and any other bus hiccup must never fail the evaluation — so we do not surface it.
  await db.from("platform_events").insert({
    tenant_id: ev.tenantId,
    event_type: ev.type,
    subject_type: ev.subjectType,
    subject_id: ev.subjectId,
    source: "objective.evaluate",
    domain: "core",
    status: "pending",
    actor: { kind: "automation", ref: "objective.evaluate" },
    occurred_at: ev.occurredAt,
    correlation_id: ev.correlationId,
    payload: ev.payload,
    metadata: { job_id: ev.jobId },
  });
}
