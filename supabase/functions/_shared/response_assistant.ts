// ServiceOS — Response Assistant (IMPURE orchestration).
//
// Loads the EXISTING business context for a source interaction (the resolved customer
// card + its projection's relationship count, and prior interaction history) and drafts
// a business-aware proposed reply via the pure modules. Read-only; it mutates nothing.
// Used by the observe shell at PROPOSAL time so the human approves the actual, context-
// aware response. No new tables — it reuses customer_cards / context projection /
// business_graph (via the card projection) / interactions.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { buildResponseContext, type PriorInteraction } from "./response_context.ts";
import { draftResponse, type DraftedResponse } from "./response_draft.ts";

/** Assemble context + draft a reply for a source interaction. Returns null if the
 *  interaction is not found (the caller keeps the generic fallback body). */
export async function assembleReplyDraft(
  db: SupabaseClient,
  tenantId: string,
  sourceInteractionId: string,
): Promise<DraftedResponse | null> {
  const { data: cur } = await db
    .from("interactions")
    .select("id, subject, summary, from_name, related_person_id, related_company_id")
    .eq("id", sourceInteractionId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!cur) return null;

  const personId = (cur.related_person_id as string | null) ?? null;
  const companyId = (cur.related_company_id as string | null) ?? null;

  // Resolved customer card (+ relationship count from its context projection).
  let card: Parameters<typeof buildResponseContext>[0]["card"] = null;
  if (personId || companyId) {
    const filters: string[] = [];
    if (personId) filters.push(`person_id.eq.${personId}`);
    if (companyId) filters.push(`company_id.eq.${companyId}`);
    const { data: c } = await db
      .from("customer_cards")
      .select("id, title, status, priority, summary, context")
      .eq("tenant_id", tenantId)
      .or(filters.join(","))
      .order("latest_activity_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (c) {
      const projection = ((c.context as Record<string, unknown> | null)?.projection ?? null) as {
        business?: { relationship_count?: number };
      } | null;
      card = {
        id: c.id as string,
        title: (c.title as string | null) ?? null,
        status: (c.status as string | null) ?? null,
        priority: (c.priority as string | null) ?? null,
        summary: (c.summary as string | null) ?? null,
        relationshipCount: projection?.business?.relationship_count ?? null,
      };
    }
  }

  // Prior interaction history for this customer (most-recent first, bounded).
  let history: PriorInteraction[] = [];
  if (personId || companyId) {
    let q = db
      .from("interactions")
      .select("id, subject, occurred_at, direction")
      .eq("tenant_id", tenantId)
      .neq("id", sourceInteractionId)
      .order("occurred_at", { ascending: false })
      .limit(5);
    if (personId) q = q.eq("related_person_id", personId);
    else if (companyId) q = q.eq("related_company_id", companyId);
    const { data: h } = await q;
    history = (h ?? []) as PriorInteraction[];
  }

  const context = buildResponseContext({
    current: {
      id: cur.id as string,
      subject: (cur.subject as string | null) ?? null,
      summary: (cur.summary as string | null) ?? null,
      from_name: (cur.from_name as string | null) ?? null,
    },
    card,
    history,
  });
  return draftResponse(context);
}
