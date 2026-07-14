// ServiceOS — Edge Function: objective-evaluation-scheduled-sync (repair scanner).
//
// Option C, part 2 — the REPAIR/BACKFILL path. Not every measurement arrives
// through application code that enqueues an evaluation (manual SQL inserts, imports,
// the first live slice). On a cron this scans ACTIVE objectives whose newest in-scope
// measurement is newer than their latest Objective Health snapshot (or that have a
// measurement but no snapshot yet) and enqueues an idempotent `objective.evaluate`
// per affected objective. The platform-worker then claims and runs it; the health
// input-hash idempotency means a redundant scan is a cheap no-op.
//
// It NEVER computes health here. It is cross-tenant infrastructure (like
// platform-worker), so it authenticates with a shared secret, NOT a user session.
//
// Auth: shared secret header `x-schedule-secret` must match OBJECTIVE_EVAL_SECRET.
// Runtime: Supabase Edge Functions (Deno). Deploy with verify_jwt=false.
//
// Scale note: v1 scans a bounded batch of active objectives with an N+1 freshness
// probe. At larger scale, replace the probe with a single set-based SQL RPC over the
// (tenant, metric, measured_at) and (tenant, objective, evaluated_at) indexes. The
// idempotent enqueue keeps that change safe and non-breaking.

import { createSupabaseAdmin } from "../_shared/simwood.ts";
import { enqueueObjectiveEvaluation } from "../_shared/objective_evaluation_enqueue.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-schedule-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_OBJECTIVES = 500; // bounded per invocation; the cron pages through over time

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
function fail(code: string, message: string, status: number): Response {
  return json({ success: false, error: { code, message } }, status);
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function t(v: unknown): number {
  const p = Date.parse(String(v ?? ""));
  return Number.isNaN(p) ? 0 : p;
}
function day(v: unknown): string {
  const d = new Date(String(v ?? ""));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const expected = Deno.env.get("OBJECTIVE_EVAL_SECRET");
  if (!expected) return fail("config_error", "OBJECTIVE_EVAL_SECRET is not configured", 500);
  const provided = req.headers.get("x-schedule-secret") ?? "";
  if (!safeEqual(provided, expected)) {
    return fail("forbidden", "Invalid or missing x-schedule-secret", 403);
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const db = createSupabaseAdmin();
  if (!serviceKey || !db)
    return fail("config_error", "Supabase admin client is not configured", 500);

  // Active objectives (bounded). Only strategy that is live can accrue health.
  const { data: objectives, error: objErr } = await db
    .from("objectives")
    .select("id, tenant_id")
    .eq("status", "active")
    .limit(MAX_OBJECTIVES);
  if (objErr) return fail("db_error", "Could not read objectives", 500);

  const today = new Date().toISOString().slice(0, 10); // UTC day for the daily time-drift gate
  let scanned = 0;
  let queued = 0;
  let duplicates = 0;
  let timeDrift = 0;

  for (const o of (objectives ?? []) as { id: string; tenant_id: string }[]) {
    scanned += 1;
    const objectiveId = o.id;
    const tenantId = o.tenant_id;

    // metric ids in scope (objective metrics + constraint metrics)
    const [{ data: om }, { data: oc }] = await Promise.all([
      db
        .from("objective_metrics")
        .select("metric_id")
        .eq("tenant_id", tenantId)
        .eq("objective_id", objectiveId),
      db
        .from("objective_constraints")
        .select("metric_id")
        .eq("tenant_id", tenantId)
        .eq("objective_id", objectiveId),
    ]);
    const metricIds = Array.from(
      new Set([
        ...((om ?? []) as { metric_id: string }[]).map((r) => r.metric_id),
        ...((oc ?? []) as { metric_id: string | null }[])
          .map((r) => r.metric_id)
          .filter((x): x is string => !!x),
      ]),
    );
    if (metricIds.length === 0) continue; // nothing measurable yet

    // newest in-scope measurement vs newest health snapshot
    const [{ data: m }, { data: h }] = await Promise.all([
      db
        .from("measurements")
        .select("measured_at")
        .eq("tenant_id", tenantId)
        .in("metric_id", metricIds)
        .order("measured_at", { ascending: false })
        .limit(1),
      db
        .from("objective_health")
        .select("evaluated_at")
        .eq("tenant_id", tenantId)
        .eq("objective_id", objectiveId)
        .order("evaluated_at", { ascending: false })
        .limit(1),
    ]);
    const newestMeasurement = t((m ?? [])[0]?.measured_at);
    if (newestMeasurement === 0) continue; // no measurement to evaluate
    const newestHealthAt = (h ?? [])[0]?.evaluated_at as string | undefined;
    const newestHealth = t(newestHealthAt);

    // Enqueue when EITHER a new measurement arrived since the last evaluation (or
    // there is none yet) OR the objective has not been evaluated yet TODAY. The
    // latter is the bounded, at-most-DAILY time-drift path: it lets stale/overdue/
    // target-date conditions change without a new measurement, while re-running every
    // few minutes is a no-op (once today's snapshot exists, its day == today). The
    // unique input hash is the final race guard against duplicate logical snapshots.
    const measurementDriven = newestHealth === 0 || newestMeasurement > newestHealth;
    const notEvaluatedToday = newestHealth > 0 && day(newestHealthAt) < today;
    if (measurementDriven || notEvaluatedToday) {
      const r = await enqueueObjectiveEvaluation(db, {
        tenantId,
        objectiveId,
        triggeredBy:
          newestHealth === 0 ? "backfill" : measurementDriven ? "measurement" : "backfill",
      });
      if (r.duplicate) duplicates += 1;
      else if (r.id) queued += 1;
      if (!measurementDriven) timeDrift += 1;
    }
  }

  return json({ success: true, scanned, queued, duplicates, timeDrift });
});
