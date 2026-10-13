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
  | "reviewed_work"
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
// These are historical eligibility decisions, not a fresh classifier or proof of source coverage.
export function mapReason(reason: string | null): CommVerdict {
  switch (reason) {
    case "customer_risk":
    case "sales_opportunity":
      return {
        commClass: "operational_customer",
        relevance: "relevant",
        source: "eligibility_ledger",
      };
    case "customer_context":
      return {
        commClass: "operational_customer",
        relevance: "relevant",
        source: "eligibility_ledger",
        note: "customer context alone does not establish an actionable issue",
      };
    case "reviewed_work_context":
      return {
        commClass: "reviewed_work",
        relevance: "relevant",
        source: "eligibility_ledger",
        note: "operator-reviewed work context",
      };
    case "supplier_risk":
      return { commClass: "supplier_vendor", relevance: "relevant", source: "eligibility_ledger" };
    case "marketing":
      return {
        commClass: "marketing_newsletter",
        relevance: "not_relevant",
        source: "eligibility_ledger",
      };
    case "automated_notification":
      return {
        commClass: "system_notification",
        relevance: "not_relevant",
        source: "eligibility_ledger",
      };
    case "outbound_no_signal":
      return { commClass: "internal", relevance: "not_relevant", source: "eligibility_ledger" };
    case "empty":
      return { commClass: "spam_noise", relevance: "not_relevant", source: "eligibility_ledger" };
    default:
      return { commClass: "unknown", relevance: "uncertain", source: "eligibility_ledger" };
  }
}

export interface CommRelevanceReport {
  tenantId: string;
  generatedAt: string;
  classificationScope: "historical_eligibility_consensus";
  ledgerRecords: number;
  reprocessedCommunications: number;
  conflictingCommunications: number;
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

/** A failed, capped or changing read must not masquerade as complete totals.
 * Keyset paging avoids offset shifts. Exact remaining counts detect truncation
 * and many concurrent changes; this is still not a database snapshot. */
async function pageAll(
  db: SupabaseClient,
  table: string,
  cols: string,
  tenantId: string,
): Promise<Row[]> {
  const out: Row[] = [];
  let expected: number | null = null,
    last: string | null = null;
  for (;;) {
    let q = db
      .from(table)
      .select(cols, { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("id", { ascending: true })
      .limit(1000);
    if (last) q = q.gt("id", last);
    const r = await q;
    if (r.error || !Array.isArray(r.data) || !Number.isSafeInteger(r.count) || r.count! < 0)
      throw Error("Communication relevance read unavailable");
    if (expected === null) expected = r.count!;
    if (
      expected > 100000 ||
      r.count !== expected - out.length ||
      r.data.length !== Math.min(1000, r.count!)
    )
      throw Error("Communication relevance coverage unconfirmed");
    for (const row of r.data as Row[]) {
      if (typeof row.id !== "string" || (last !== null && row.id <= last))
        throw Error("Communication relevance page order differs");
      last = row.id;
      out.push(row);
    }
    if (out.length === expected) return out;
  }
}

/** One communication counts once even if several mapper versions ran. Conflicting
 * historical verdicts stay uncertain; a later timestamp alone cannot resolve them. */
export function recordedVerdicts(ledger: Row[]) {
  const grouped = new Map<string, Row[]>();
  for (const row of ledger) {
    if (typeof row.interaction_id !== "string" || !row.interaction_id)
      throw Error("Communication relevance lineage unavailable");
    const rows = grouped.get(row.interaction_id) ?? [];
    rows.push(row);
    grouped.set(row.interaction_id, rows);
  }
  return [...grouped].map(([id, rows]) => {
    const verdicts = rows.map((row) => mapReason(row.eligibility_reason ?? null));
    const distinct = new Set(verdicts.map((v) => `${v.commClass}:${v.relevance}`));
    const conflict = distinct.size > 1;
    return {
      id,
      records: rows.length,
      conflict,
      verdict: conflict ? mapReason(null) : verdicts[0],
    };
  });
}

export async function gatherCommunicationRelevance(
  db: SupabaseClient,
  tenantId: string,
  now: string,
): Promise<CommRelevanceReport> {
  const [led, io, recs] = await Promise.all([
    pageAll(db, "intelligence_ingestions", "id,interaction_id,eligibility_reason", tenantId),
    pageAll(db, "intelligence_objects", "id,source_interactions", tenantId),
    pageAll(db, "recommendations", "id,interaction_id,status", tenantId),
  ]);
  const verdicts = recordedVerdicts(led);
  const byClass: Record<string, number> = {};
  const byRelevance: Record<string, number> = {};
  const noiseInteractions = new Set<string>();
  for (const x of verdicts) {
    const v = x.verdict;
    byClass[v.commClass] = (byClass[v.commClass] ?? 0) + 1;
    byRelevance[v.relevance] = (byRelevance[v.relevance] ?? 0) + 1;
    if (v.relevance === "not_relevant") noiseInteractions.add(x.id);
  }

  // Estimated exclusion — intel objects whose linked interactions are ALL noise, and recs on noise.
  let ioExcluded = 0;
  for (const o of io) {
    if (
      o.source_interactions != null &&
      (!Array.isArray(o.source_interactions) ||
        o.source_interactions.some((id: unknown) => typeof id !== "string"))
    )
      throw Error("Communication relevance object lineage unavailable");
    const si = (o.source_interactions ?? []) as string[];
    if (si.length > 0 && si.every((id) => noiseInteractions.has(id))) ioExcluded++;
  }
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
    classificationScope: "historical_eligibility_consensus",
    ledgerRecords: led.length,
    reprocessedCommunications: verdicts.filter((v) => v.records > 1).length,
    conflictingCommunications: verdicts.filter((v) => v.conflict).length,
    totalCommunications: verdicts.length,
    byClass,
    byRelevance,
    exclusion: {
      noiseInteractions: noiseInteractions.size,
      intelligenceObjectsExcluded: ioExcluded,
      recommendationsExcluded: recExcluded,
      recommendationsOpenExcluded: recOpenExcluded,
    },
    caveat:
      "Each communication appears once across its recorded eligibility decisions. Conflicting " +
      "versions remain uncertain. These historical decisions have not been rechecked against " +
      "current source revisions; they are not proof of complete capture or actionable insight. " +
      "Email marketing may be under-detected. Reads are sequential, not a single database snapshot. " +
      "Exclusions are estimates only: this report does not filter queues or change source data.",
  };
}
