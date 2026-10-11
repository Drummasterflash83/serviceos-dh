// Canonical phone handoff uses one tenant/run-bound transaction. No direct source,
// interaction or event writes; a lost acknowledgement is inspected, not replayed.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export interface PhoneHandoffReceipt {
  version: "learn-phone-handoff/1";
  state: "committed";
  tenantId: string;
  runId: string;
  recordingId: string;
  transcriptId: string;
  insightId: string;
  callId: string;
  interactionId: string;
  eventId: string | null;
  sourceFingerprint: string;
  eventPublished: boolean;
  alreadyEnriched: boolean;
}
export interface FinalizeResult {
  ok: boolean;
  reason?: string;
  callId: string | null;
  interactionId: string | null;
  eventPublished: boolean;
  alreadyEnriched: boolean;
  receipt?: PhoneHandoffReceipt;
}
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const safeReasons = new Set([
  "phone_handoff_source_unverified", "phone_handoff_source_changed", "phone_handoff_call_changed",
  "phone_handoff_run_changed", "phone_handoff_conflict", "phone_handoff_superseded", "learn_capture_paused",
]);
export async function finalizeInteractionForRecording(opts: {
  admin: SupabaseClient;
  tenantId: string;
  runId: string;
  recordingId: string;
  transcriptId: string | null;
  insightId: string | null;
}): Promise<FinalizeResult> {
  const base: FinalizeResult = { ok: false, callId: null, interactionId: null, eventPublished: false, alreadyEnriched: false };
  const values = [opts.tenantId, opts.runId, opts.recordingId, opts.transcriptId, opts.insightId];
  if (!values.every(uuid)) return { ...base, reason: "phone_handoff_input_invalid" };
  const [tenantId, runId, recordingId, transcriptId, insightId] = (values as string[]).map(v => v.toLowerCase());
  const args = { p_tenant: tenantId, p_run: runId, p_recording: recordingId, p_transcript: transcriptId, p_insight: insightId };
  function receipt(value: any): PhoneHandoffReceipt | null {
    if (!value || value.version !== "learn-phone-handoff/1" || value.state !== "committed" ||
      value.tenantId !== tenantId || value.runId !== runId || value.recordingId !== recordingId ||
      value.transcriptId !== transcriptId || value.insightId !== insightId ||
      !uuid(value.callId) || !uuid(value.interactionId) ||
      typeof value.sourceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint) ||
      typeof value.eventPublished !== "boolean" || typeof value.alreadyEnriched !== "boolean" ||
      (value.alreadyEnriched ? value.eventPublished || value.eventId !== null : !value.eventPublished || !uuid(value.eventId))) return null;
    return value;
  }
  let reason = "phone_handoff_unconfirmed";
  for (const phase of ["publish", "inspect"] as const) {
    try {
      const { data, error } = await opts.admin.rpc("learn_phone_handoff", { ...args, p_phase: phase });
      const confirmed = !error ? receipt(data) : null;
      if (confirmed) return { ok: true, callId: confirmed.callId, interactionId: confirmed.interactionId,
        eventPublished: confirmed.eventPublished, alreadyEnriched: confirmed.alreadyEnriched, receipt: confirmed };
      if (phase === "publish" && typeof error?.message === "string" && safeReasons.has(error.message)) reason = error.message;
    } catch { /* Inspect once after transport uncertainty. Never republish. */ }
  }
  return { ...base, reason };
}
