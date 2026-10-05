// ServiceOS — shared enqueue helper for Objective Health evaluation (Deno, service-role).
//
// The application-owned path (Option C, part 1): any code that appends a
// measurement/outcome — or the scheduled repair scanner (part 2) — calls this to
// ask the platform-worker to (re-)evaluate an objective's health ASYNCHRONOUSLY.
// It NEVER computes health here and NEVER blocks the writing transaction; it just
// enqueues an idempotent `objective.evaluate` job. Best-effort and tenant-bound.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { enqueueJob, type EnqueueResult } from "./platform_queue.ts";

export type ObjectiveEvaluationTrigger =
  "measurement" | "outcome" | "constraint_change" | "dependency_change" | "manual" | "backfill";

export interface EnqueueObjectiveEvaluationInput {
  tenantId: string;
  objectiveId: string;
  triggeredBy: ObjectiveEvaluationTrigger;
  measurementIds?: string[];
  outcomeIds?: string[];
  correlationId?: string | null;
  /** Force a fresh evaluation (audit re-run). Adds a nonce so it is NOT de-duped
   *  against a pending eval and the resulting snapshot gets a distinct identity. */
  force?: boolean;
  /** Deterministic nonce for a forced run (e.g. correlation id). Required when
   *  force is true and you want replay stability; falls back to correlationId. */
  nonce?: string | null;
}

/**
 * Idempotent enqueue of `objective.evaluate`. Normal runs share the job key
 * `objective.evaluate:{tenant}:{objective}`, so a pending evaluation is never
 * stacked (the scanner, a measurement writer and a parent trigger all collapse to
 * one active job). Forced runs append a nonce to the key so they are distinct.
 */
export async function enqueueObjectiveEvaluation(
  client: SupabaseClient,
  input: EnqueueObjectiveEvaluationInput,
): Promise<EnqueueResult> {
  if (!input.tenantId || !input.objectiveId) return { id: null, duplicate: false };
  const nonce = input.force ? (input.nonce ?? input.correlationId ?? "force") : null;
  const jobKey = nonce
    ? `objective.evaluate:${input.tenantId}:${input.objectiveId}:${nonce}`
    : `objective.evaluate:${input.tenantId}:${input.objectiveId}`;

  return enqueueJob(client, {
    tenantId: input.tenantId,
    jobType: "objective.evaluate",
    jobKey,
    connectorId: "openfolk-core",
    moduleId: "core.objectives",
    payload: {
      objective_id: input.objectiveId,
      triggered_by: input.triggeredBy,
      ...(input.measurementIds?.length ? { measurement_ids: input.measurementIds } : {}),
      ...(input.outcomeIds?.length ? { outcome_ids: input.outcomeIds } : {}),
      ...(input.correlationId ? { correlation_id: input.correlationId } : {}),
      ...(input.force ? { force: true, nonce } : {}),
    },
  });
}
