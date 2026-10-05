// ServiceOS — controlled Phone Intelligence backfill / proof tool (service-role).
//
// Reuses the SAME loader + compute + persist as the live edge function, so a dry-run
// shows exactly what live processing would write. Default DRY-RUN, hard batch cap,
// tenant-scoped, idempotent (persist upserts), redacted output (never prints full
// phone numbers or transcript content), never mutates the raw transcript.
//
// Usage (source ./.env.verify first):
//   node scripts/phone-intelligence-backfill.mjs [flags]
// Flags (env or --k=v):
//   TENANT=<uuid>            (default: the phone-calls tenant)
//   CALL_ID=<uuid>           process transcripts for one call
//   TRANSCRIPT_ID=<uuid>     process one transcript
//   FROM=<iso> TO=<iso>      transcript created_at window
//   LIMIT=<n>                max calls (hard-capped at 25)
//   UNRESOLVED_ONLY=1        skip calls that already have a participant row
//   MIN_QUALITY=<0..1>       skip low-quality transcripts
//   APPLY=1                  actually write (default: dry-run)
//   STOP_ON_ERROR=1

import { createClient } from "@supabase/supabase-js";
import { loadCallIntelligenceInput } from "../supabase/functions/_shared/phone_intelligence/loader.ts";
import {
  computeCallIntelligence,
  persistComputed,
} from "../supabase/functions/_shared/phone_intelligence/persist.ts";

const HARD_CAP = 25;
const arg = (k, d) => {
  const flag = process.argv.find((a) => a.startsWith(`--${k}=`));
  return flag ? flag.slice(k.length + 3) : (process.env[k] ?? d);
};
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const mask = (n) => (n ? `${n.slice(0, 3)}…${n.slice(-2)}` : "—");

const APPLY = arg("APPLY", "") === "1";
const UNRESOLVED_ONLY = arg("UNRESOLVED_ONLY", "") === "1";
const MIN_QUALITY = Number(arg("MIN_QUALITY", "0"));
const STOP_ON_ERROR = arg("STOP_ON_ERROR", "") === "1";
const LIMIT = Math.min(HARD_CAP, Number(arg("LIMIT", "1")) || 1);

let TENANT = arg("TENANT", "");
if (!TENANT) {
  const { data } = await db.from("phone_calls").select("tenant_id").limit(1).maybeSingle();
  TENANT = data?.tenant_id;
}

// Resolve the target transcript ids (tenant-scoped).
async function targetTranscriptIds() {
  const TRANSCRIPT_ID = arg("TRANSCRIPT_ID", "");
  if (TRANSCRIPT_ID) return [TRANSCRIPT_ID];
  const CALL_ID = arg("CALL_ID", "");
  if (CALL_ID) {
    const { data: call } = await db
      .from("phone_calls")
      .select("provider_call_id, linked_id")
      .eq("tenant_id", TENANT)
      .eq("id", CALL_ID)
      .maybeSingle();
    if (!call) return [];
    const { data: recs } = await db
      .from("phone_recordings")
      .select("id")
      .eq("tenant_id", TENANT)
      .in("provider_call_id", [call.provider_call_id, call.linked_id].filter(Boolean));
    const recIds = (recs ?? []).map((r) => r.id);
    if (!recIds.length) return [];
    const { data: trs } = await db
      .from("phone_transcripts")
      .select("id")
      .eq("tenant_id", TENANT)
      .in("recording_id", recIds);
    return (trs ?? []).map((t) => t.id);
  }
  // recalibrate all calls on one endpoint (after confirming its mapping)
  const ENDPOINT_REF = arg("ENDPOINT_REF", "");
  if (ENDPOINT_REF) {
    const { data: calls } = await db
      .from("phone_calls")
      .select("provider_call_id, linked_id")
      .eq("tenant_id", TENANT)
      .or(
        `raw_payload->>srcEndpoint.eq.${ENDPOINT_REF},raw_payload->>dstEndpoint.eq.${ENDPOINT_REF}`,
      );
    const pcids = (calls ?? []).flatMap((c) => [c.provider_call_id, c.linked_id]).filter(Boolean);
    if (!pcids.length) return [];
    const { data: recs } = await db
      .from("phone_recordings")
      .select("id")
      .eq("tenant_id", TENANT)
      .in("provider_call_id", pcids);
    const recIds = (recs ?? []).map((r) => r.id);
    if (!recIds.length) return [];
    const { data: trs } = await db
      .from("phone_transcripts")
      .select("id")
      .eq("tenant_id", TENANT)
      .in("recording_id", recIds);
    return (trs ?? []).map((t) => t.id);
  }

  // recent window
  let q = db
    .from("phone_transcripts")
    .select("id, created_at")
    .eq("tenant_id", TENANT)
    .not("transcript_text", "is", null)
    .order("created_at", { ascending: false })
    .limit(LIMIT * 3);
  const FROM = arg("FROM", ""),
    TO = arg("TO", "");
  if (FROM) q = q.gte("created_at", FROM);
  if (TO) q = q.lte("created_at", TO);
  const { data } = await q;
  return (data ?? []).map((t) => t.id);
}

console.log(
  `\n=== Phone Intelligence backfill  mode=${APPLY ? "APPLY" : "DRY-RUN"}  tenant=${TENANT}  limit=${LIMIT} ===`,
);
const ids = await targetTranscriptIds();
let processed = 0,
  applied = 0,
  skipped = 0,
  failed = 0;

for (const transcriptId of ids) {
  if (processed >= LIMIT) break;
  try {
    const loaded = await loadCallIntelligenceInput(db, { tenantId: TENANT, transcriptId });
    if (!loaded) {
      skipped++;
      continue;
    }
    const q = loaded.input.transcriptQuality ?? 0;
    if (MIN_QUALITY && q < MIN_QUALITY) {
      skipped++;
      continue;
    }
    if (UNRESOLVED_ONLY) {
      const { count } = await db
        .from("call_participants")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", TENANT)
        .eq("call_id", loaded.ids.callId);
      if ((count ?? 0) > 0) {
        skipped++;
        continue;
      }
    }
    processed++;
    const c = computeCallIntelligence(loaded.input);
    console.log(`\n• call ${loaded.ids.callId}  transcript ${transcriptId}`);
    console.log(
      `  direction=${c.direction.direction} (${c.direction.confidence.toFixed(2)})  external=${mask(c.canonical.externalNumber)}`,
    );
    console.log(
      `  internal=${c.internal.resolvedEntityId ? c.internal.displayName : "Unknown team member"} (${c.internal.confidence.toFixed(2)})  external=${c.external.resolvedEntityId ? c.external.displayName : "unresolved"}`,
    );
    const applied_corr = c.normalisation?.corrections.filter((x) => x.applied) ?? [];
    console.log(
      `  corrections=${applied_corr.length}${applied_corr.length ? " [" + applied_corr.map((x) => `${x.from}→${x.to}`).join(", ") + "]" : ""}  conflicts=${c.identity.hasConflict}`,
    );
    console.log(
      `  raw_preserved=${c.normalisation ? c.normalisation.raw === loaded.input.transcriptText : "n/a"}`,
    );
    if (APPLY) {
      const r = await persistComputed(db, loaded.ids, c);
      if (r.ok) {
        applied++;
        console.log(`  WROTE: ${r.wrote.join(", ")}`);
      } else {
        failed++;
        console.log(`  WRITE FAILED: ${r.error}`);
        if (STOP_ON_ERROR) break;
      }
    }
  } catch (e) {
    failed++;
    console.log(`  ERROR: ${e instanceof Error ? e.message : String(e)}`);
    if (STOP_ON_ERROR) break;
  }
}

// Emit the distinct phone_intelligence health signal (same component the live function
// uses) so observability reflects backfill processing too.
if (APPLY && (applied > 0 || failed > 0)) {
  await db
    .rpc("serviceos_record_health_check", {
      p_tenant: TENANT,
      p_component: "phone_intelligence",
      p_status: failed === 0 ? "healthy" : "degraded",
      p_error: failed ? `${failed} call(s) failed in backfill` : null,
      p_metadata: { source: "backfill", processed, applied, failed },
    })
    .then(
      () => {},
      () => {},
    );
}

console.log(
  `\n=== done: processed=${processed} applied=${applied} skipped=${skipped} failed=${failed} ===`,
);
process.exit(failed && STOP_ON_ERROR ? 1 : 0);
