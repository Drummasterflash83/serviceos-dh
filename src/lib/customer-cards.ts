/**
 * Customer Card Engine — tenant-scoped projection reads (RLS) + the build trigger.
 *
 * Customer Cards are PROJECTIONS of the Business Graph, not a source of truth. The
 * `customer-card-sync` Edge Function computes an explainable operational summary
 * and stores it in `customer_cards.context.projection`. These readers surface that
 * projection; every operational surface (Customer page, My Day, Operations Centre)
 * reads the SAME projection. NO service role in the browser — reads are RLS-scoped;
 * the build trigger binds the tenant server-side. Honest states only.
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type { ApiResult } from "./types";

export type CardHealth = "excellent" | "good" | "attention" | "critical";

export interface CardProjection {
  version: number;
  generated_at: string;
  identity: {
    display_name: string;
    company_name: string | null;
    primary_contact: string | null;
    emails: string[];
    phones: string[];
  };
  communication: {
    last_interaction_at: string | null;
    interaction_count: number;
    trend: "up" | "flat" | "down";
    channels: string[];
  };
  operations: {
    open_recommendations: number;
    urgent: Array<{ title: string | null; severity: string | null; action?: string | null }>;
    waiting: Array<{ title: string | null; severity: string | null }>;
    blockers: Array<string | null>;
  };
  business: {
    confidence: number | null;
    health: CardHealth;
    health_reasons: string[];
    sentiment: string | null;
    avg_response_hours: number | null;
    activity_score: number;
    activity_inputs?: Record<string, unknown>;
    relationship_count: number;
  };
  timeline: Array<{ at: string | null; kind: string; label: string }>;
}

export interface ProjectedCard {
  id: string;
  title: string | null;
  status: string;
  priority: string;
  person_id: string | null;
  company_id: string | null;
  latest_activity_at: string | null;
  updated_at: string;
  /** Parsed from context.projection — null until the engine has run on this card. */
  projection: CardProjection | null;
}

export interface CustomerCardSummary {
  total: number;
  projected: number; // cards that have a projection
  excellent: number;
  good: number;
  attention: number;
  critical: number;
  avgActivityScore: number | null;
  avgConfidence: number | null;
  topWaiting: { id: string; title: string | null; waiting: number } | null;
  latestProjectedAt: string | null;
}

const CARD_COLUMNS =
  "id, title, status, priority, person_id, company_id, latest_activity_at, updated_at, context";

const SUMMARY_SCAN = 500;

function parseProjection(context: unknown): CardProjection | null {
  if (!context || typeof context !== "object") return null;
  const proj = (context as Record<string, unknown>).projection;
  if (!proj || typeof proj !== "object") return null;
  // Projections are durable records and older rows pre-date several fields used by
  // the customer screen. Normalise at the data boundary so one legacy row cannot
  // crash the whole route (for example `operations.waiting.length`).
  const p = proj as Partial<CardProjection>;
  const identity = p.identity ?? ({} as CardProjection["identity"]);
  const communication = p.communication ?? ({} as CardProjection["communication"]);
  const operations = p.operations ?? ({} as CardProjection["operations"]);
  const business = p.business ?? ({} as CardProjection["business"]);
  return {
    version: typeof p.version === "number" ? p.version : 1,
    generated_at: p.generated_at ?? "",
    identity: {
      display_name: identity.display_name ?? "Unknown contact",
      company_name: identity.company_name ?? null,
      primary_contact: identity.primary_contact ?? null,
      emails: Array.isArray(identity.emails) ? identity.emails : [],
      phones: Array.isArray(identity.phones) ? identity.phones : [],
    },
    communication: {
      last_interaction_at: communication.last_interaction_at ?? null,
      interaction_count: communication.interaction_count ?? 0,
      trend: communication.trend ?? "flat",
      channels: Array.isArray(communication.channels) ? communication.channels : [],
    },
    operations: {
      open_recommendations: operations.open_recommendations ?? 0,
      urgent: Array.isArray(operations.urgent) ? operations.urgent : [],
      waiting: Array.isArray(operations.waiting) ? operations.waiting : [],
      blockers: Array.isArray(operations.blockers) ? operations.blockers : [],
    },
    business: {
      confidence: business.confidence ?? null,
      health: business.health ?? "attention",
      health_reasons: Array.isArray(business.health_reasons) ? business.health_reasons : [],
      sentiment: business.sentiment ?? null,
      avg_response_hours: business.avg_response_hours ?? null,
      activity_score: business.activity_score ?? 0,
      activity_inputs: business.activity_inputs,
      relationship_count: business.relationship_count ?? 0,
    },
    timeline: Array.isArray(p.timeline) ? p.timeline : [],
  };
}

function toProjectedCard(row: Record<string, unknown>): ProjectedCard {
  return {
    id: row.id as string,
    title: (row.title as string | null) ?? null,
    status: (row.status as string) ?? "grey",
    priority: (row.priority as string) ?? "medium",
    person_id: (row.person_id as string | null) ?? null,
    company_id: (row.company_id as string | null) ?? null,
    latest_activity_at: (row.latest_activity_at as string | null) ?? null,
    updated_at: row.updated_at as string,
    projection: parseProjection(row.context),
  };
}

/** List projected customer cards (RLS-scoped), most-recently-active first. */
export async function getCustomerCards(limit = 100): Promise<ApiResult<ProjectedCard[]>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("customer_cards")
    .select(CARD_COLUMNS)
    .order("latest_activity_at", { ascending: false, nullsFirst: false })
    .limit(Math.max(1, Math.min(500, limit)));
  if (error) return { ok: false, error: { code: "cards_unavailable", message: error.message } };
  return { ok: true, data: ((data ?? []) as Record<string, unknown>[]).map(toProjectedCard) };
}

/** One projected customer card by id. */
export async function getCustomerCard(id: string): Promise<ApiResult<ProjectedCard | null>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("customer_cards")
    .select(CARD_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: { code: "cards_unavailable", message: error.message } };
  return { ok: true, data: data ? toProjectedCard(data as Record<string, unknown>) : null };
}

/**
 * Aggregate customer-health summary for the Operations Centre / My Day. Health,
 * activity and confidence live inside each projection, so this scans a bounded
 * set of cards and aggregates honestly (no fabricated zeros — returns ok:false
 * when the table can't be read).
 */
export async function getCustomerCardSummary(): Promise<ApiResult<CustomerCardSummary>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("customer_cards")
    .select("id, title, context")
    .order("latest_activity_at", { ascending: false, nullsFirst: false })
    .limit(SUMMARY_SCAN);
  if (error) return { ok: false, error: { code: "cards_unavailable", message: error.message } };

  const rows = (data ?? []) as Record<string, unknown>[];
  const summary: CustomerCardSummary = {
    total: rows.length,
    projected: 0,
    excellent: 0,
    good: 0,
    attention: 0,
    critical: 0,
    avgActivityScore: null,
    avgConfidence: null,
    topWaiting: null,
    latestProjectedAt: null,
  };
  let scoreSum = 0;
  let scoreCount = 0;
  let confSum = 0;
  let confCount = 0;
  let topWaitingCount = -1;

  for (const row of rows) {
    const proj = parseProjection(row.context);
    if (!proj) continue;
    summary.projected += 1;
    if (proj.business.health in summary) {
      summary[proj.business.health] += 1;
    }
    if (typeof proj.business.activity_score === "number") {
      scoreSum += proj.business.activity_score;
      scoreCount += 1;
    }
    if (typeof proj.business.confidence === "number") {
      confSum += proj.business.confidence;
      confCount += 1;
    }
    const waiting = proj.operations.waiting.length;
    if (waiting > topWaitingCount) {
      topWaitingCount = waiting;
      if (waiting > 0) {
        summary.topWaiting = {
          id: row.id as string,
          title: (row.title as string | null) ?? null,
          waiting,
        };
      }
    }
    if (!summary.latestProjectedAt || proj.generated_at > summary.latestProjectedAt) {
      summary.latestProjectedAt = proj.generated_at;
    }
  }
  summary.avgActivityScore = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : null;
  summary.avgConfidence = confCount > 0 ? Math.round((confSum / confCount) * 100) / 100 : null;
  return { ok: true, data: summary };
}

export interface SyncCustomerCardsResult {
  success: boolean;
  cards_projected: number;
  skipped: number;
  failed: number;
  health_counts: Record<CardHealth, number>;
}

/**
 * Trigger a server-side projection (Edge Function, service role). The browser
 * forwards the user's session; the function binds the tenant. This is the manual
 * "Build cards" override — normal operation is automatic (scheduled after graph).
 */
export async function syncCustomerCards(limit = 200): Promise<ApiResult<SyncCustomerCardsResult>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("customer-card-sync", {
    body: { limit },
  });
  if (error) {
    return { ok: false, error: { code: "card_sync_failed", message: error.message } };
  }
  return { ok: true, data: data as SyncCustomerCardsResult };
}
