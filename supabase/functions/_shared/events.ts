// ServiceOS — shared Platform Events helper (Deno, service-role).
//
// The one place Edge Functions publish/consume durable `platform_events` rows —
// the event-bus seed (see migration 20260709150000_platform_events.sql). Like the
// platform_jobs helper it is deliberately BEST-EFFORT and failure-isolated:
// publishing an event must NEVER break or block the producing pipeline. Every
// function swallows its own errors and returns a safe value.
//
// Security: always requires an explicit tenant_id; never logs secrets; callers
// must keep credentials out of payload/metadata. Uses the caller's service-role
// Supabase client (writes bypass RLS).
//
// No new dependencies — the SupabaseClient type comes from the same supabase-js
// module already used across these functions.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export interface PublishEventInput {
  tenantId: string;
  eventType: string; // e.g. "interaction.ready"
  subjectType: string; // e.g. "interaction"
  subjectId: string; // e.g. interactions.id
  source?: string | null; // publisher, e.g. "phone-process-pipeline"
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** Result of publishEvent. `duplicate` = an unconsumed event already existed. */
export interface PublishEventResult {
  id: string | null;
  duplicate: boolean;
}

/**
 * Publish an event to the bus. Idempotent: a partial unique index allows at most
 * one PENDING event per (tenant, event_type, subject), so re-running an
 * idempotent producer no-ops instead of stacking duplicates (returns
 * { duplicate: true }). Returns { id: null } only if the write truly failed —
 * never throws.
 */
export async function publishEvent(
  client: SupabaseClient,
  input: PublishEventInput,
): Promise<PublishEventResult> {
  if (!input.tenantId || !input.eventType || !input.subjectId) {
    return { id: null, duplicate: false };
  }
  try {
    const row = {
      tenant_id: input.tenantId,
      event_type: input.eventType,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      source: input.source ?? null,
      status: "pending",
      payload: input.payload ?? {},
      metadata: input.metadata ?? {},
    };
    const { data, error } = await client.from("platform_events").insert(row).select("id").single();
    if (!error && data) return { id: data.id as string, duplicate: false };
    // Unique violation on the pending-subject index → an unconsumed event exists.
    if (error && (error as { code?: string }).code === "23505") {
      return { id: null, duplicate: true };
    }
    return { id: null, duplicate: false };
  } catch {
    return { id: null, duplicate: false };
  }
}

/**
 * Mark all PENDING events for a subject+type as consumed (a subscriber finished
 * its work for that subject). Best-effort; a bus-table hiccup never fails the
 * subscriber's real work.
 */
export async function markEventsConsumed(
  client: SupabaseClient,
  input: { tenantId: string; eventType: string; subjectId: string },
): Promise<void> {
  if (!input.tenantId || !input.eventType || !input.subjectId) return;
  try {
    await client
      .from("platform_events")
      .update({ status: "consumed", consumed_at: new Date().toISOString() })
      .eq("tenant_id", input.tenantId)
      .eq("event_type", input.eventType)
      .eq("subject_id", input.subjectId)
      .eq("status", "pending");
  } catch {
    // swallow — event bookkeeping must never break the subscriber
  }
}
