// ServiceOS — Worker handler: identity.resolve (Identity Resolution Engine v1).
// Pure business logic — moved verbatim from identity-resolve/index.ts (evidence
// engine, provisional person/company creation, card enrichment, priority scoring,
// recommendation creation, event consumption, best-effort graph trigger). Auth,
// CORS and the platform_jobs lifecycle live in the caller. Tenant is always
// caller-validated. No fabricated certainty; no silent weak-match merges.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { markEventsConsumed } from "../events.ts";
import { triggerGraphSyncBackground } from "../business_graph.ts";
import {
  matchLevelOf,
  resolveIdentity,
  type IdentityResolution,
  type ResolvableInteraction,
} from "../identity.ts";
import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";

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

/** Write an explainable suggestion for an exact-match candidate (idempotent).
 *  Returns true when a concrete existing-match suggestion was written. */
async function writeSuggestion(
  admin: Admin,
  tenantId: string,
  interactionId: string,
  targetType: "person" | "company",
  res: IdentityResolution,
): Promise<boolean> {
  const cand = targetType === "person" ? res.person : res.company;
  if (!cand.id) return false; // only suggest concrete existing matches (create → recommendation)
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
  return true;
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
  suggestions: number;
  unknown: boolean;
}> {
  const res = await resolveIdentity(admin, tenantId, i);

  // 1) Suggestions for concrete matches.
  const sPerson = await writeSuggestion(admin, tenantId, i.id, "person", res);
  const sCompany = await writeSuggestion(admin, tenantId, i.id, "company", res);
  const suggestions = (sPerson ? 1 : 0) + (sCompany ? 1 : 0);

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
    return {
      personCreated,
      companyCreated,
      cardEnriched: false,
      recs: 0,
      suggestions,
      unknown: true,
    };
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
    return {
      personCreated,
      companyCreated,
      cardEnriched: false,
      recs: 0,
      suggestions,
      unknown: false,
    };
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

  return { personCreated, companyCreated, cardEnriched: true, recs, suggestions, unknown: false };
}

export async function handleIdentityResolve(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin: admin, tenantId, payload } = ctx;
  const batch = clampBatch(payload.limit);
  const startTodayIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

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
    let suggestionsCreated = 0;
    let eventsConsumed = 0;
    let unknown = 0;
    let failed = 0;

    for (const i of rows) {
      try {
        const r = await enrichOne(admin, tenantId, i, startTodayIso);
        resolved += 1;
        if (r.personCreated) peopleCreated += 1;
        if (r.companyCreated) companiesCreated += 1;
        if (r.cardEnriched) cardsEnriched += 1;
        recommendations += r.recs;
        suggestionsCreated += r.suggestions;
        if (r.unknown) unknown += 1;
        // Close the loop: this subscriber has handled interaction.ready for this
        // subject. Best-effort — bus bookkeeping never fails the real enrichment.
        await markEventsConsumed(admin, {
          tenantId,
          eventType: "interaction.ready",
          subjectId: i.id,
        });
        eventsConsumed += 1;
      } catch (_e) {
        // Failure-isolated: one bad interaction never aborts the batch.
        failed += 1;
      }
    }

    // Best-effort: project the freshly-enriched identities into the Business Graph.
    // Identity does NOT depend on the graph — this is fire-and-forget, failure-
    // isolated, and the scheduled graph sync also covers it. Only fire when there
    // was real enrichment work to project.
    if (resolved > 0) triggerGraphSyncBackground(tenantId);

    return {
      success: true,
      recordsProcessed: resolved,
      result: {
        resolved,
        cards_enriched: cardsEnriched,
        people_created: peopleCreated,
        companies_created: companiesCreated,
        suggestions_created: suggestionsCreated,
        events_consumed: eventsConsumed,
        recommendations,
        unknown,
        skipped: 0,
        failed,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "identity-resolve failed";
    return {
      success: false,
      error: { code: "resolve_error", message: message.slice(0, 500), retryable: true },
    };
  }
}
