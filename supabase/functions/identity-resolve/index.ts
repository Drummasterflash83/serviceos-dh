// ServiceOS — Edge Function: identity-resolve (Identity Resolution Engine v1)
//
// Runs the evidence engine over a batch of PENDING interactions. For each it:
//   1. resolves identity (who/company — evidence only, no fabrication),
//   2. writes explainable match suggestions for exact matches,
//   3. links or provisionally CREATES the person/company (reversible; never
//      overwrites existing/locked data),
//   4. upserts the customer card, recomputes its live priority score,
//   5. generates real recommendations,
//   6. links the interaction and marks it enriched.
// The whole run is one observable, retryable platform job.
//
// Auth: user session (owner/admin/ops) OR the internal service path (scheduler).
// Tenant is bound server-side; the browser can never spoof it. No secrets logged.
//
// Runtime: Supabase Edge Functions (Deno). No new dependencies.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  corsHeaders,
  createSupabaseAdmin,
  failResponse,
  jsonResponse,
} from "../_shared/simwood.ts";
import { requireTenantUser } from "../_shared/authz.ts";
import {
  completePlatformJob,
  createPlatformJob,
  failPlatformJob,
  startPlatformJob,
} from "../_shared/platform_jobs.ts";
import { markEventsConsumed } from "../_shared/events.ts";
import {
  matchLevelOf,
  resolveIdentity,
  type IdentityResolution,
  type ResolvableInteraction,
} from "../_shared/identity.ts";

type Admin = SupabaseClient;

const DEFAULT_BATCH = 20;
const MAX_BATCH = 50;

function clampBatch(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : DEFAULT_BATCH;
  return Math.max(1, Math.min(MAX_BATCH, n));
}

interface Interaction extends ResolvableInteraction {
  occurred_at: string;
  sentiment: string | null;
  related_person_id: string | null;
}

const INTERACTION_COLUMNS =
  "id, interaction_type, direction, from_address, from_name, to_addresses, phone_from, phone_to, occurred_at, sentiment, related_person_id";

/** Write an explainable suggestion for an exact-match candidate (idempotent). */
async function writeSuggestion(
  admin: Admin,
  tenantId: string,
  interactionId: string,
  targetType: "person" | "company",
  res: IdentityResolution,
) {
  const cand = targetType === "person" ? res.person : res.company;
  if (!cand.id) return; // only suggest concrete existing matches (create → recommendation)
  await admin.from("interaction_match_suggestions").upsert(
    {
      tenant_id: tenantId,
      interaction_id: interactionId,
      target_type: targetType,
      target_id: cand.id,
      match_level: matchLevelOf(cand.confidence),
      confidence: cand.score,
      evidence: cand.evidence,
      explanation: cand.evidence.map((e) => e.detail).join("; "),
      recommended_action: res.actions[0] ?? null,
      status: "pending",
      created_by: "system",
    },
    { onConflict: "tenant_id,interaction_id,target_type,target_id" },
  );
}

/** Ensure an open recommendation of a type exists for a card (idempotent). */
async function ensureRecommendation(
  admin: Admin,
  tenantId: string,
  cardId: string,
  rec: {
    type: string;
    title: string;
    detail: string;
    severity: string;
    action: string;
    evidence: unknown[];
    personId: string | null;
    companyId: string | null;
    interactionId: string;
  },
): Promise<boolean> {
  const { data: existing } = await admin
    .from("recommendations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("card_id", cardId)
    .eq("type", rec.type)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();
  if (existing) return false;
  await admin.from("recommendations").insert({
    tenant_id: tenantId,
    type: rec.type,
    title: rec.title,
    detail: rec.detail,
    severity: rec.severity,
    status: "open",
    card_id: cardId,
    interaction_id: rec.interactionId,
    person_id: rec.personId,
    company_id: rec.companyId,
    evidence: rec.evidence,
    recommended_action: rec.action,
    created_by: "system",
  });
  return true;
}

/**
 * Live priority score (0–100) from REAL inputs. Documented weighting:
 *   base 20 · +5 per interaction (cap 30) · +severity-weighted open recs
 *   · +20 negative sentiment · +15 contacted-again-today.
 */
function computePriority(inputs: {
  interactionCount: number;
  openRecScore: number;
  negativeSentiment: boolean;
  repeatToday: boolean;
}): { score: number; bucket: string } {
  let score = 20;
  score += Math.min(30, inputs.interactionCount * 5);
  score += inputs.openRecScore;
  if (inputs.negativeSentiment) score += 20;
  if (inputs.repeatToday) score += 15;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const bucket = score >= 75 ? "critical" : score >= 50 ? "high" : score >= 25 ? "medium" : "low";
  return { score, bucket };
}

async function enrichOne(
  admin: Admin,
  tenantId: string,
  i: Interaction,
  startTodayIso: string,
): Promise<{
  personCreated: boolean;
  companyCreated: boolean;
  cardEnriched: boolean;
  recs: number;
  unknown: boolean;
}> {
  const res = await resolveIdentity(admin, tenantId, i);

  // 1) Suggestions for concrete matches.
  await writeSuggestion(admin, tenantId, i.id, "person", res);
  await writeSuggestion(admin, tenantId, i.id, "company", res);

  // 2) Company: matched, else provision from a business email domain.
  let companyId = res.company.id;
  let companyCreated = false;
  if (!companyId && res.contactDomain && res.company.confidence === "POSSIBLE") {
    const { data } = await admin
      .from("companies")
      .insert({
        tenant_id: tenantId,
        name: res.contactDomain,
        domain: res.contactDomain,
        verified: false,
        created_source: "interaction",
      })
      .select("id")
      .single();
    companyId = (data?.id as string | undefined) ?? null;
    companyCreated = Boolean(companyId);
  }

  // 3) Person: matched, else provision from a real email/phone contact.
  let personId = res.person.id;
  let personCreated = false;
  if (!personId && (res.contactEmail || res.contactPhone)) {
    const { data } = await admin
      .from("people")
      .insert({
        tenant_id: tenantId,
        primary_email: res.contactEmail,
        primary_phone: res.contactPhone,
        display_name: res.contactName,
        company_id: companyId,
        verified: false,
        created_source: "interaction",
        metadata: { origin_interaction: i.id },
      })
      .select("id")
      .single();
    personId = (data?.id as string | undefined) ?? null;
    personCreated = Boolean(personId);
  } else if (personId && companyId) {
    // Link an existing person to the company only when they have none (no overwrite).
    await admin
      .from("people")
      .update({ company_id: companyId })
      .eq("tenant_id", tenantId)
      .eq("id", personId)
      .is("company_id", null);
  }

  // 4) Link the interaction to the resolved identity (reversible) + mark enriched.
  await admin
    .from("interactions")
    .update({
      related_person_id: personId,
      related_company_id: companyId,
      processing_status: "enriched",
    })
    .eq("tenant_id", tenantId)
    .eq("id", i.id);

  if (!personId) {
    return { personCreated, companyCreated, cardEnriched: false, recs: 0, unknown: true };
  }

  // 5) Real inputs for recommendations + priority.
  const { count: interactionCount } = await admin
    .from("interactions")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("related_person_id", personId);
  const { count: todayCount } = await admin
    .from("interactions")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("related_person_id", personId)
    .gte("occurred_at", startTodayIso);
  const repeatToday = (todayCount ?? 0) >= 2;
  const negativeSentiment = i.sentiment === "negative";

  // 6) Card upsert (respecting manually-locked fields).
  const { data: existingCard } = await admin
    .from("customer_cards")
    .select("id, locked_fields, latest_activity_at")
    .eq("tenant_id", tenantId)
    .eq("person_id", personId)
    .limit(1)
    .maybeSingle();
  const locked = (existingCard?.locked_fields as string[] | undefined) ?? [];
  const prevActivity = existingCard?.latest_activity_at as string | null | undefined;
  const latestActivity =
    prevActivity && Date.parse(prevActivity) > Date.parse(i.occurred_at)
      ? prevActivity
      : i.occurred_at;

  const cardId = existingCard?.id as string | undefined;

  // 7) Recommendations (need a card id — create the card first if missing).
  let ensuredCardId = cardId;
  const baseCard: Record<string, unknown> = {
    tenant_id: tenantId,
    person_id: personId,
    company_id: companyId,
    title: res.contactName ?? res.contactEmail ?? res.contactPhone,
    latest_activity_at: latestActivity,
    confidence: res.person.score,
  };
  for (const f of locked) delete baseCard[f];
  if (!ensuredCardId) {
    const { data } = await admin.from("customer_cards").insert(baseCard).select("id").single();
    ensuredCardId = data?.id as string | undefined;
  }
  if (!ensuredCardId) {
    return { personCreated, companyCreated, cardEnriched: false, recs: 0, unknown: false };
  }

  let recs = 0;
  let openRecScore = 0;
  if (repeatToday) {
    const added = await ensureRecommendation(admin, tenantId, ensuredCardId, {
      type: "repeat_contact_today",
      title: `Contacted ${todayCount} times today`,
      detail: "This contact has reached out multiple times today — prioritise a response.",
      severity: "high",
      action: "Prioritise a callback / reply",
      evidence: [{ source: "interactions", detail: `${todayCount} interactions today` }],
      personId,
      companyId,
      interactionId: i.id,
    });
    if (added) recs += 1;
    openRecScore += 20;
  }
  if (personCreated) {
    const added = await ensureRecommendation(admin, tenantId, ensuredCardId, {
      type: "review_new_contact",
      title: "New contact — confirm identity",
      detail: "This person was auto-created from a real interaction. Confirm or link them.",
      severity: "info",
      action: "Review and confirm the contact",
      evidence: res.person.evidence,
      personId,
      companyId,
      interactionId: i.id,
    });
    if (added) recs += 1;
    openRecScore += 5;
  }

  // 8) Priority + finalise the card.
  const priority = computePriority({
    interactionCount: interactionCount ?? 0,
    openRecScore,
    negativeSentiment,
    repeatToday,
  });
  const finalPatch: Record<string, unknown> = {
    ...baseCard,
    priority: priority.bucket,
    priority_score: priority.score,
    priority_inputs: {
      interaction_count: interactionCount ?? 0,
      open_rec_score: openRecScore,
      negative_sentiment: negativeSentiment,
      repeat_today: repeatToday,
    },
  };
  for (const f of locked) delete finalPatch[f];
  await admin.from("customer_cards").update(finalPatch).eq("id", ensuredCardId);

  return { personCreated, companyCreated, cardEnriched: true, recs, unknown: false };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return failResponse("method_not_allowed", "Use POST", 405);

  const admin = createSupabaseAdmin();
  if (!admin) return failResponse("config_error", "Supabase admin client is not configured", 500);

  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops"]);
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);
  const tenantId = auth.ctx.tenantId;

  let body: { limit?: unknown } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    body = {};
  }
  const batch = clampBatch(body.limit);
  const startTodayIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  const job = await createPlatformJob(admin, {
    tenantId,
    connectorId: "openfolk-core",
    moduleId: "core.identity",
    jobType: "identity.resolve",
    jobKey: `identity.resolve:${tenantId}`,
    payload: { batch },
  });
  const jobId = job.duplicate ? null : job.id;
  if (jobId) await startPlatformJob(admin, jobId);

  try {
    // Subscriber to interaction.ready: consume interactions that are fully
    // processed at source (READY) but not yet enriched. Also picks up the
    // pre-events 'pending' state so email/legacy rows are never stranded.
    const { data: pending, error } = await admin
      .from("interactions")
      .select(INTERACTION_COLUMNS)
      .eq("tenant_id", tenantId)
      .in("processing_status", ["pending", "ready"])
      .order("occurred_at", { ascending: false })
      .limit(batch);
    if (error) throw new Error(`interactions read failed: ${error.message}`);

    const rows = (pending ?? []) as Interaction[];
    let resolved = 0;
    let peopleCreated = 0;
    let companiesCreated = 0;
    let cardsEnriched = 0;
    let recommendations = 0;
    let unknown = 0;

    for (const i of rows) {
      try {
        const r = await enrichOne(admin, tenantId, i, startTodayIso);
        resolved += 1;
        if (r.personCreated) peopleCreated += 1;
        if (r.companyCreated) companiesCreated += 1;
        if (r.cardEnriched) cardsEnriched += 1;
        recommendations += r.recs;
        if (r.unknown) unknown += 1;
        // Close the loop: this subscriber has handled interaction.ready for this
        // subject. Best-effort — bus bookkeeping never fails the real enrichment.
        await markEventsConsumed(admin, {
          tenantId,
          eventType: "interaction.ready",
          subjectId: i.id,
        });
      } catch (_e) {
        // Failure-isolated: one bad interaction never aborts the batch.
      }
    }

    if (jobId) {
      await completePlatformJob(admin, jobId, {
        recordsProcessed: resolved,
        result: {
          people_created: peopleCreated,
          companies_created: companiesCreated,
          cards_enriched: cardsEnriched,
          recommendations,
          unknown,
        },
      });
    }

    return jsonResponse({
      success: true,
      resolved,
      people_created: peopleCreated,
      companies_created: companiesCreated,
      cards_enriched: cardsEnriched,
      recommendations,
      unknown,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "identity-resolve failed";
    if (jobId) await failPlatformJob(admin, jobId, message);
    return failResponse("resolve_error", message, 500);
  }
});
