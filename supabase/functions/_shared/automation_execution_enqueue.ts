// ServiceOS — shared enqueue helper for Automation execution (Deno, service-role).
//
// The application-owned path: when an Automation Intent becomes executable (created
// authorised, approval completed, a retry is due, or a repair scan finds it), this
// enqueues an idempotent `automation.execute` job. It NEVER executes here and NEVER
// blocks the writing transaction; the platform-worker claims and runs it. Best-effort
// and tenant-bound. One active job per intent (the job key de-dups).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { enqueueJob, type EnqueueResult } from "./platform_queue.ts";

export type AutomationExecutionTrigger =
  "intent_created" | "approval_completed" | "retry" | "repair" | "manual";

export interface EnqueueAutomationExecutionInput {
  tenantId: string;
  automationIntentId: string;
  triggeredBy: AutomationExecutionTrigger;
  correlationId?: string | null;
  forceGuardRecheck?: boolean;
  availableAt?: string | null;
}

/**
 * Idempotent enqueue of `automation.execute`. All triggers share the job key
 * `automation.execute:{tenant}:{intent}`, so a pending execution is never stacked
 * (a retry, an approval-release and a repair scan collapse to one active job). The
 * intent lifecycle + idempotency key remain the authoritative execution guards.
 */
export async function enqueueAutomationExecution(
  client: SupabaseClient,
  input: EnqueueAutomationExecutionInput,
): Promise<EnqueueResult> {
  if (!input.tenantId || !input.automationIntentId) return { id: null, duplicate: false };
  return enqueueJob(client, {
    tenantId: input.tenantId,
    jobType: "automation.execute",
    jobKey: `automation.execute:${input.tenantId}:${input.automationIntentId}`,
    connectorId: "openfolk-core",
    moduleId: "core.automation",
    availableAt: input.availableAt ?? null,
    payload: {
      automation_intent_id: input.automationIntentId,
      triggered_by: input.triggeredBy,
      ...(input.correlationId ? { correlation_id: input.correlationId } : {}),
      ...(input.forceGuardRecheck ? { force_guard_recheck: true } : {}),
    },
  });
}
