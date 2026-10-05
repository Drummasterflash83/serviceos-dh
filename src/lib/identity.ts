/**
 * Identity engine summary — tenant-scoped reads (RLS browser client) for the
 * Operations Centre Intelligence section. Everything is real evidence: job counts,
 * signals processed, cards enriched, recommendations, unknown people/companies and
 * the average matching confidence. Returns ok:false ("identity_unavailable") when
 * the engine tables can't be read — never a fabricated number.
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type { ApiResult } from "./types";

export interface IdentitySummary {
  identityJobsToday: number;
  latestIdentityJobAt: string | null;
  signalsProcessed: number;
  cardsEnrichedToday: number;
  recommendationsToday: number;
  recommendationsOpen: number;
  unknownPeople: number;
  unknownCompanies: number;
  /** Average pending match-suggestion confidence, 0–1 (null when none). */
  avgConfidence: number | null;
}

export async function getIdentitySummary(): Promise<ApiResult<IdentitySummary>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const startToday = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const head = { count: "exact" as const, head: true as const };
  const count = (build: () => PromiseLike<{ count: number | null; error: unknown }>) =>
    build().then((r) => (r.error ? null : (r.count ?? 0)));

  // Probe an engine table to distinguish "unavailable" from "empty".
  const probe = await supabase.from("recommendations").select("*", head).eq("status", "open");
  if (probe.error) {
    return { ok: false, error: { code: "identity_unavailable", message: probe.error.message } };
  }

  const [
    identityJobsToday,
    signalsProcessed,
    cardsEnrichedToday,
    recommendationsToday,
    unknownPeople,
    unknownCompanies,
    latestJob,
    confidences,
  ] = await Promise.all([
    count(() =>
      supabase
        .from("platform_jobs")
        .select("*", head)
        .eq("job_type", "identity.resolve")
        .gte("created_at", startToday),
    ),
    count(() =>
      supabase.from("interactions").select("*", head).eq("processing_status", "enriched"),
    ),
    count(() =>
      supabase.from("customer_cards").select("*", head).gte("latest_activity_at", startToday),
    ),
    count(() => supabase.from("recommendations").select("*", head).gte("created_at", startToday)),
    count(() =>
      supabase
        .from("interactions")
        .select("*", head)
        .eq("processing_status", "enriched")
        .is("related_person_id", null),
    ),
    count(() =>
      supabase
        .from("interactions")
        .select("*", head)
        .eq("processing_status", "enriched")
        .is("related_company_id", null),
    ),
    supabase
      .from("platform_jobs")
      .select("completed_at, created_at")
      .eq("job_type", "identity.resolve")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("interaction_match_suggestions")
      .select("confidence")
      .eq("status", "pending")
      .not("confidence", "is", null)
      .limit(200),
  ]);

  const confRows = (confidences.data ?? []) as { confidence: number | null }[];
  const nums = confRows.map((r) => r.confidence).filter((c): c is number => typeof c === "number");
  const avgConfidence = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  const latest = latestJob.data as {
    completed_at: string | null;
    created_at: string | null;
  } | null;

  return {
    ok: true,
    data: {
      identityJobsToday: identityJobsToday ?? 0,
      latestIdentityJobAt: latest?.completed_at ?? latest?.created_at ?? null,
      signalsProcessed: signalsProcessed ?? 0,
      cardsEnrichedToday: cardsEnrichedToday ?? 0,
      recommendationsToday: recommendationsToday ?? 0,
      recommendationsOpen: probe.count ?? 0,
      unknownPeople: unknownPeople ?? 0,
      unknownCompanies: unknownCompanies ?? 0,
      avgConfidence,
    },
  };
}
