// ServiceOS — shared phone → canonical-interaction finaliser (Deno, service-role).
//
// The LAST step of the phone pipeline, and the ONLY place it touches the shared
// business layer. After a recording is downloaded/transcribed/analysed this:
//   1. back-fills phone_ai_insights.call_id (insights are written keyed only by
//      recording_id; the canonical projection joins AI by call_id — without this
//      the AI summary/sentiment never reaches the timeline),
//   2. upserts the ONE canonical `interactions` row for the call (same shape &
//      conflict key as interactions-sync, so the two are interchangeable),
//   3. marks it READY (never downgrading an already-ENRICHED row),
//   4. PUBLISHES `interaction.ready` on the bus.
//
// It does NOT know about identity resolution, customer cards, recommendations or
// any other engine — those are independent subscribers of interaction.ready. The
// phone pipeline therefore never grows a downstream dependency. Best-effort and
// failure-isolated: a failure here never fails the (already successful) analysis.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { publishEvent } from "./events.ts";

export interface FinalizeResult {
  ok: boolean;
  reason?: string; // when !ok: no_call | no_call_id | db_error
  callId: string | null;
  interactionId: string | null;
  eventPublished: boolean;
  alreadyEnriched: boolean;
}

const SOURCE_TABLE = "phone_calls";
const EVENT_TYPE = "interaction.ready";

function dirOf(raw: unknown): string {
  return raw === "IN" ? "inbound" : raw === "OUT" ? "outbound" : "unknown";
}

/** Later of two ISO timestamps (ignores nulls / unparseable). */
function maxIso(a: string | null, b: string | null): string | null {
  const ta = a && !Number.isNaN(Date.parse(a)) ? Date.parse(a) : null;
  const tb = b && !Number.isNaN(Date.parse(b)) ? Date.parse(b) : null;
  if (ta === null) return b ?? null;
  if (tb === null) return a ?? null;
  return ta >= tb ? a : b;
}

/**
 * Produce/refresh the canonical interaction for a just-analysed recording and
 * publish interaction.ready. Never throws — returns a structured result the
 * caller records in its run metadata.
 */
export async function finalizeInteractionForRecording(opts: {
  admin: SupabaseClient;
  tenantId: string;
  recordingId: string;
}): Promise<FinalizeResult> {
  const { admin, tenantId, recordingId } = opts;
  const base: FinalizeResult = {
    ok: false,
    callId: null,
    interactionId: null,
    eventPublished: false,
    alreadyEnriched: false,
  };

  try {
    // 1) Resolve the recording's owning call (recordings link by provider_call_id).
    const { data: rec, error: recErr } = await admin
      .from("phone_recordings")
      .select("id, provider, provider_call_id")
      .eq("tenant_id", tenantId)
      .eq("id", recordingId)
      .maybeSingle();
    if (recErr) return { ...base, reason: "db_error" };
    const providerCallId = (rec?.provider_call_id as string | null) ?? null;
    if (!providerCallId) return { ...base, reason: "no_call_id" };

    const { data: call, error: callErr } = await admin
      .from("phone_calls")
      .select(
        "id, provider_call_id, direction, from_number, to_number, started_at, duration_seconds, outcome, linked_id, created_at, updated_at",
      )
      .eq("tenant_id", tenantId)
      .eq("provider_call_id", providerCallId)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (callErr) return { ...base, reason: "db_error" };
    if (!call) return { ...base, reason: "no_call" };
    const callId = call.id as string;

    // 2) Back-fill the insight's call_id (only when unset — never overwrite).
    const { data: insight } = await admin
      .from("phone_ai_insights")
      .select("id, call_id, summary, sentiment, updated_at")
      .eq("tenant_id", tenantId)
      .eq("recording_id", recordingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (insight && (insight.call_id as string | null) === null) {
      await admin
        .from("phone_ai_insights")
        .update({ call_id: callId })
        .eq("tenant_id", tenantId)
        .eq("id", insight.id as string)
        .is("call_id", null);
    }
    const summary = (insight?.summary as string | null) ?? null;
    const sentiment = (insight?.sentiment as string | null) ?? null;

    // 3) Preserve an already-ENRICHED interaction — never downgrade its status.
    const { data: existing } = await admin
      .from("interactions")
      .select("id, processing_status")
      .eq("tenant_id", tenantId)
      .eq("source_table", SOURCE_TABLE)
      .eq("source_id", callId)
      .maybeSingle();
    const alreadyEnriched = (existing?.processing_status as string | null) === "enriched";
    const targetStatus = alreadyEnriched ? "enriched" : "ready";

    const direction = dirOf(call.direction);
    const duration = (call.duration_seconds as number | null) ?? null;
    const outcome = (call.outcome as string | null) ?? null;
    const fallback = `${direction} call${duration != null ? ` · ${duration}s` : ""}${
      outcome ? ` · ${outcome}` : ""
    }`;

    const row = {
      tenant_id: tenantId,
      source_connector_id: "simwood",
      source_type: "phone",
      source_table: SOURCE_TABLE,
      source_id: callId,
      source_external_id: (call.provider_call_id as string | null) ?? null,
      interaction_type: "phone_call",
      direction,
      occurred_at: (call.started_at as string | null) ?? (call.created_at as string),
      subject: null,
      summary,
      body_preview: summary ?? fallback,
      phone_from: (call.from_number as string | null) ?? null,
      phone_to: (call.to_number as string | null) ?? null,
      sentiment,
      related_thread_id: (call.linked_id as string | null) ?? null,
      // Incremental projection marker (max source timestamp at projection time) so
      // the scheduled projector never re-selects this row as "repair" — must match
      // interactions-sync's marker semantics.
      source_updated_at: maxIso(
        (call.updated_at as string | null) ?? null,
        (insight?.updated_at as string | null) ?? null,
      ),
      // Only these columns are written on upsert, so identity's related_person_id /
      // related_company_id on an existing enriched row are preserved untouched.
      processing_status: targetStatus,
      metadata: {
        duration_seconds: duration,
        outcome,
        has_ai_insight: Boolean(insight),
        recording_id: recordingId,
      },
    };

    const { data: upserted, error: upErr } = await admin
      .from("interactions")
      .upsert(row, { onConflict: "tenant_id,source_table,source_id" })
      .select("id")
      .single();
    if (upErr || !upserted) return { ...base, callId, reason: "db_error" };
    const interactionId = upserted.id as string;

    // 4) Publish interaction.ready (skip if already enriched — nothing new to fan out).
    let eventPublished = false;
    if (!alreadyEnriched) {
      const ev = await publishEvent(admin, {
        tenantId,
        eventType: EVENT_TYPE,
        subjectType: "interaction",
        subjectId: interactionId,
        source: "phone-process-pipeline",
        payload: { source_type: "phone", call_id: callId, recording_id: recordingId },
      });
      eventPublished = Boolean(ev.id) || ev.duplicate;
    }

    return { ok: true, callId, interactionId, eventPublished, alreadyEnriched };
  } catch {
    return { ...base, reason: "db_error" };
  }
}
