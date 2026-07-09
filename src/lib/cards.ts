/**
 * Customer Cards foundation — tenant-scoped reads (RLS browser client).
 *
 * Cards are the future daily "what needs attention" surface (customers, companies,
 * jobs, tasks…). This v1 reader is READ-ONLY and honest: no fake CRM, no AI
 * assumptions. The tables are populated by service-role Edge Functions in a later
 * enrichment phase; until then these return empty (ok:true) or unavailable
 * (ok:false) — never a fabricated number.
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type { ApiResult } from "./types";

/** Traffic-light health of a card. */
export type CardStatus = "grey" | "green" | "amber" | "red";

/** Priority-queue bucket — "what do I deal with first?" (scoring is future work). */
export type CardPriority = "critical" | "high" | "medium" | "low" | "waiting" | "done";

export interface Person {
  id: string;
  tenant_id: string;
  company_id: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: string;
  tenant_id: string;
  name: string;
  domain: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerCard {
  id: string;
  tenant_id: string;
  person_id: string | null;
  company_id: string | null;
  title: string | null;
  summary: string | null;
  status: CardStatus | string;
  priority: CardPriority | string;
  owner_id: string | null;
  due_at: string | null;
  latest_activity_at: string | null;
  recommended_action: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CardFilter {
  status?: string;
  priority?: string;
  limit?: number;
}

export interface CardsSummary {
  total: number;
  /** critical + high, not yet done. */
  urgent: number;
  waiting: number;
  done: number;
  latest_activity_at: string | null;
}

const CARD_COLUMNS =
  "id, tenant_id, person_id, company_id, title, summary, status, priority, owner_id, due_at, latest_activity_at, recommended_action, completed_at, created_at, updated_at";

function clampLimit(v: number | undefined): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 100;
  return Math.max(1, Math.min(500, n));
}

/** List customer cards (RLS-scoped), most-recently-active first. */
export async function listCustomerCards(
  filter: CardFilter = {},
): Promise<ApiResult<CustomerCard[]>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  let query = supabase
    .from("customer_cards")
    .select(CARD_COLUMNS)
    .order("latest_activity_at", { ascending: false, nullsFirst: false })
    .limit(clampLimit(filter.limit));
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.priority) query = query.eq("priority", filter.priority);

  const { data, error } = await query;
  if (error) return { ok: false, error: { code: "query_error", message: error.message } };
  return { ok: true, data: (data ?? []) as CustomerCard[] };
}

/**
 * Card counts for the Operations Centre. ok:false ("cards_unavailable") when the
 * table can't be read; empty-but-readable returns zeros (⇒ "no cards yet").
 */
export async function getCardsSummary(): Promise<ApiResult<CardsSummary>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const head = { count: "exact" as const, head: true as const };
  const count = (build: () => PromiseLike<{ count: number | null; error: unknown }>) =>
    build().then((r) => (r.error ? null : (r.count ?? 0)));

  const probe = await supabase.from("customer_cards").select("*", head);
  if (probe.error) {
    return { ok: false, error: { code: "cards_unavailable", message: probe.error.message } };
  }

  const [urgent, waiting, done, latest] = await Promise.all([
    count(() =>
      supabase
        .from("customer_cards")
        .select("*", head)
        .in("priority", ["critical", "high"])
        .neq("priority", "done"),
    ),
    count(() => supabase.from("customer_cards").select("*", head).eq("priority", "waiting")),
    count(() => supabase.from("customer_cards").select("*", head).eq("priority", "done")),
    supabase
      .from("customer_cards")
      .select("latest_activity_at")
      .order("latest_activity_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    ok: true,
    data: {
      total: probe.count ?? 0,
      urgent: urgent ?? 0,
      waiting: waiting ?? 0,
      done: done ?? 0,
      latest_activity_at:
        (latest.data as { latest_activity_at: string | null } | null)?.latest_activity_at ?? null,
    },
  };
}
