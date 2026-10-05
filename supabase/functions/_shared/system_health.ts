// ServiceOS — System Health emission (shared, service-role).
//
// The single mechanism every pipeline stage uses to report its health into the unified
// system_health_checks rollup (via the serviceos_record_health_check RPC). Best-effort: a
// health-write failure NEVER fails the underlying work. Reused by the platform-worker choke
// point (one wiring point covers phone/email/intelligence/automation) and can be called
// directly from any Edge Function stage. No new architecture — just the emit seam.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type HealthComponent =
  | "auth"
  | "tenant_context"
  | "phone_ingestion"
  | "recording_extraction"
  | "transcription"
  | "email_sync"
  | "email_gmail"
  | "intelligence_processing"
  | "automation_execution"
  | "phone_intelligence";

export type HealthStatus = "healthy" | "degraded" | "failed" | "unknown";

/** job_type → the health component it exercises. One place; the worker maps every job. */
const JOB_COMPONENT: Record<string, HealthComponent> = {
  "phone.process_pending": "phone_ingestion",
  // Gmail personal-OAuth is a DISTINCT signal from Workspace: a Gmail reconnect
  // condition must never make the Workspace/email tile look healthy.
  "email.gmail_sync": "email_gmail",
  "email.workspace_sync": "email_sync",
  "email.workspace_backfill": "email_sync",
  "email.mailbox_discovery": "email_sync",
  "intelligence.observe": "intelligence_processing",
  "intelligence.ingest_interaction": "intelligence_processing",
  "intelligence.evaluate": "intelligence_processing",
  "automation.execute": "automation_execution",
};

export function healthComponentForJob(jobType: string): HealthComponent | null {
  return JOB_COMPONENT[jobType] ?? null;
}

/** Record a component's current health. Swallows its own errors — telemetry must never
 *  break the pipeline it observes. */
export async function recordHealthCheck(
  db: SupabaseClient,
  input: {
    tenantId: string;
    component: HealthComponent;
    status: HealthStatus;
    error?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await db.rpc("serviceos_record_health_check", {
      p_tenant: input.tenantId,
      p_component: input.component,
      p_status: input.status,
      p_error: input.error ? input.error.slice(0, 500) : null,
      p_metadata: input.metadata ?? {},
    });
  } catch {
    // best-effort
  }
}
