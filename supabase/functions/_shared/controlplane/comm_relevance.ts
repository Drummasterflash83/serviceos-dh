// ServiceOS — Communication operational-relevance read model (WS2, READ-ONLY).
//
// The intelligence pipeline ALREADY classifies every interaction deterministically via
// eligibility.ts (shouldCreateIntelligence) and records the verdict in the append-only
// `intelligence_ingestions` ledger (eligibility_reason + confidence). This module is a PURE,
// provider-neutral READ MODEL over that existing audited verdict — it introduces NO new
// classifier of record and MUTATES NOTHING. It maps the ledger's reasons onto the requested
// communication classes + operational_relevance, and estimates how much noise would leave the
// operational Learning queues if relevance were applied. Raw evidence is never rewritten.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export type CommClass =
  | "operational_customer"
  | "supplier_vendor"
  | "internal"
  | "system_notification"
  | "marketing_newsletter"
  | "spam_noise"
  | "unknown";
export type Relevance = "relevant" | "not_relevant" | "uncertain";

export interface CommVerdict {
  commClass: CommClass;
  relevance: Relevance;
  source: string; // always the existing eligibility ledger for now
  note?: string;
}

// Map the EXISTING eligibility_reason (eligibility.ts vocabulary) → class + relevance.
// customer_context is flagged uncertain-ish because, with email headers unavailable, header-less
// marketing leaks into it (a known false-negative) — see the analysis narrative.
export function mapReason(reason: string | null): CommVerdict {
  switch (reason) {
    case "customer_risk":
    case "sales_opportunity":
      return { commClass: "operational_customer", relevance: "relevant", source: "eligibility_ledger" };
    case "customer_context":
      return {
        commClass: "operational_customer",
        relevance: "relevant",
        source: "eligibility_ledger",
        note: "may include header-less marketing (headers not captured)",
      };
    case "supplier_risk":
      return { commClass: "supplier_vendor", relevance: "relevant", source: "eligibility_ledger" };
    case "marketing":
      return { commClass: "marketing_newsletter", relevance: "not_relevant", source: "eligibility_ledger" };
    case "automated_notification":
      return { commClass: "system_notification", relevance: "not_relevant", source: "eligibility_ledger" };
    case "outbound_no_signal":
      return { commClass: "internal", relevance: "not_relevant", source: "eligibility_ledger" };
    case "empty":
      return { commClass: "spam_noise", relevance: "not_relevant", source: "eligibility_ledger" };
    default:
      return { commClass: "unknown", relevance: "uncertain", source: "eligibility_ledger" };
  }
}

const NOISE_REASONS = new Set(["marketing", "automated_notification", "outbound_no_signal", "empty"]);

export interface CommRelevanceReport {
  tenantId: string;
  generatedAt: string;
  totalCommunications: number;
  byClass: Record<string, number>;
  byRelevance: Record<string, number>;
  // How much would leave the operational Learning queues if not_relevant were excluded.
  exclusion: {
    noiseInteractions: number;
    intelligenceObjectsExcluded: number;
    recommendationsExcluded: number;
    recommendationsOpenExcluded: number;
  };
  caveat: string;
}

async function pageAll(
  db: SupabaseClient,
  table: string,
  cols: string,
  tenantId: string,
  f?: (q: unknown) => unknown,
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < 100000; from += 1000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db.from(table).select(cols).eq("tenant_id", tenantId).range(from, from + 999);
    if (f) q = f(q);
    const r = await q;
    if (r.error || !r.data || r.data.length === 0) break;
    out.push(...(r.data as Row[]));
    if (r.data.length < 1000) break;
  }
  return out;
}

export async function gatherCommunicationRelevance(
  db: SupabaseClient,
  tenantId: string,
  now: string,
): Promise<CommRelevanceReport> {
  const led = await pageAll(db, "intelligence_ingestions", "interaction_id, eligibility_reason", tenantId);
  const byClass: Record<string, number> = {};
  const byRelevance: Record<string, number> = {};
  const noiseInteractions = new Set<string>();
  for (const x of led) {
    const v = mapReason(x.eligibility_reason ?? null);
    byClass[v.commClass] = (byClass[v.commClass] ?? 0) + 1;
    byRelevance[v.relevance] = (byRelevance[v.relevance] ?? 0) + 1;
    if (NOISE_REASONS.has(x.eligibility_reason)) noiseInteractions.add(x.interaction_id);
  }

  // Estimated exclusion — intel objects whose linked interactions are ALL noise, and recs on noise.
  const io = await pageAll(db, "intelligence_objects", "id, source_interactions", tenantId);
  let ioExcluded = 0;
  for (const o of io) {
    const si = (o.source_interactions ?? []) as string[];
    if (si.length > 0 && si.every((id) => noiseInteractions.has(id))) ioExcluded++;
  }
  const recs = await pageAll(db, "recommendations", "id, interaction_id, status", tenantId);
  let recExcluded = 0;
  let recOpenExcluded = 0;
  for (const r of recs) {
    if (r.interaction_id && noiseInteractions.has(r.interaction_id)) {
      recExcluded++;
      if (r.status === "open") recOpenExcluded++;
    }
  }

  return {
    tenantId,
    generatedAt: now,
    totalCommunications: led.length,
    byClass,
    byRelevance,
    exclusion: {
      noiseInteractions: noiseInteractions.size,
      intelligenceObjectsExcluded: ioExcluded,
      recommendationsExcluded: recExcluded,
      recommendationsOpenExcluded: recOpenExcluded,
    },
    caveat:
      "Relevance reflects the existing eligibility verdict. Email headers (List-Unsubscribe/" +
      "Precedence) are not captured, so header-less marketing is under-detected and leaks into " +
      "operational_customer; exclusion here is a conservative floor, not a ceiling. No raw evidence " +
      "is modified; no classification is written.",
  };
}
