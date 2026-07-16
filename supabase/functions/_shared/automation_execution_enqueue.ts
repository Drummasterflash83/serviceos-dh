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
  /** A per-attempt token that makes a RETRY key distinct from the running base job, so a
   *  reschedule enqueued while the current job is still `running` can never collide-and-
   *  vanish under the active-job unique index. Pass the current attempt count. */
  retryToken?: string | number | null;
}

/**
 * Idempotent enqueue of `automation.execute`. Non-retry triggers share the job key
 * `automation.execute:{tenant}:{intent}`, so a fresh execution is never stacked (an
 * approval-release and a repair scan collapse to one active job). A RETRY passes a
 * `retryToken` so its key is `…:{intent}:retry:{token}` — distinct from the running base
 * job, so the reschedule survives. The intent lifecycle + claim RPC remain the
 * authoritative single-execution guards regardless of how many jobs point at the intent.
 */
export async function enqueueAutomationExecution(
  client: SupabaseClient,
  input: EnqueueAutomationExecutionInput,
): Promise<EnqueueResult> {
  if (!input.tenantId || !input.automationIntentId) return { id: null, duplicate: false };
  const baseKey = `automation.execute:${input.tenantId}:${input.automationIntentId}`;
  const jobKey = input.retryToken != null ? `${baseKey}:retry:${input.retryToken}` : baseKey;
  return enqueueJob(client, {
    tenantId: input.tenantId,
    jobType: "automation.execute",
    jobKey,
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
