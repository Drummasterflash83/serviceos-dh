/**
 * System Health — the executive "can I trust my AI today?" read. Tenant-scoped (RLS),
 * built from the unified system_health_checks rollup emitted by the pipeline, enriched with
 * a few live "today" counts. Honest: a component that has never reported shows `unknown`
 * (never), a healthy-but-stale component is downgraded to `attention` via the shared
 * freshness thresholds. Reuses getSupabaseClient() + ApiResult + health-model, no new deps.
 */

import { CADENCE_SEC, staleAfterSec } from "./health-model";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type { ApiResult } from "./types";

export type HealthLight = "healthy" | "attention" | "failed" | "unknown";

export interface HealthComponentView {
  component: string;
  label: string;
  category: string;
  light: HealthLight;
  status: string; // raw status
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
  lastError: string | null;
  count: number | null;
  countLabel: string | null;
}

export interface SystemHealthView {
  components: HealthComponentView[];
  overall: HealthLight;
  generatedAt: string;
}

interface CheckRow {
  component: string;
  status: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  failure_count: number | null;
  last_error: string | null;
}
interface ComponentRow {
  component: string;
  label: string;
  category: string;
  sort_order: number;
}

// The four pipeline sensors the executive panel surfaces, with their expected cadence
// (reused from health-model) and the "today" metric each carries.
const SURFACED: {
  component: string;
  cadenceSec: number;
  countTable: string | null;
  countColumn: string;
  pending?: { column: string; value: string };
  countLabel: string;
}[] = [
  {
    component: "phone_ingestion",
    cadenceSec: CADENCE_SEC.phoneProcessing,
    countTable: "phone_calls",
    countColumn: "created_at",
    countLabel: "calls analysed today",
  },
  {
    component: "email_sync",
    cadenceSec: CADENCE_SEC.emailWorkspace,
    countTable: "email_messages",
    countColumn: "created_at",
    countLabel: "emails processed today",
  },
  {
    // Personal Gmail OAuth — distinct from Workspace, so a reconnect condition surfaces
    // truthfully instead of being masked by a healthy Workspace sync.
    component: "email_gmail",
    cadenceSec: CADENCE_SEC.emailGmail,
    countTable: null,
    countColumn: "created_at",
    countLabel: "Gmail OAuth",
  },
  {
    component: "intelligence_processing",
    cadenceSec: CADENCE_SEC.interactions,
    countTable: "intelligence_objects",
    countColumn: "created_at",
    countLabel: "signals generated today",
  },
  {
    component: "automation_execution",
    cadenceSec: CADENCE_SEC.recommendations,
    countTable: "automation_intents",
    countColumn: "created_at",
    pending: { column: "status", value: "pending" },
    countLabel: "actions awaiting approval",
  },
];

function lightFor(row: CheckRow | undefined, cadenceSec: number): HealthLight {
  if (!row || row.status === "unknown") return "unknown";
  if (row.status === "failed") return "failed";
  if (row.status === "degraded") return "attention";
  // healthy — but downgrade if the last success is stale for its cadence.
  if (!row.last_success_at) return "unknown";
  const ageSec = (Date.now() - Date.parse(row.last_success_at)) / 1000;
  return Number.isNaN(ageSec) || ageSec > staleAfterSec(cadenceSec) ? "attention" : "healthy";
}

const startOfTodayIso = () => new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

async function countToday(
  supabase: ReturnType<typeof getSupabaseClient>,
  table: string,
  column: string,
  pending?: { column: string; value: string },
): Promise<number | null> {
  try {
    let q = supabase.from(table).select("*", { count: "exact", head: true });
    if (pending) q = q.eq(pending.column, pending.value);
    else q = q.gte(column, startOfTodayIso());
    const { count, error } = await q;
    return error ? null : (count ?? 0);
  } catch {
    return null;
  }
}

const WORST: Record<HealthLight, number> = { failed: 3, attention: 2, unknown: 1, healthy: 0 };

export async function getSystemHealth(): Promise<ApiResult<SystemHealthView>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();

  const [{ data: comps }, { data: checks }] = await Promise.all([
    supabase.from("system_health_components").select("component, label, category, sort_order"),
    supabase
      .from("system_health_checks")
      .select("component, status, last_success_at, last_failure_at, failure_count, last_error"),
  ]);

  const compMap = new Map<string, ComponentRow>(
    ((comps ?? []) as ComponentRow[]).map((c) => [c.component, c]),
  );
  const checkMap = new Map<string, CheckRow>(
    ((checks ?? []) as CheckRow[]).map((c) => [c.component, c]),
  );

  const counts = await Promise.all(
    SURFACED.map((s) =>
      s.countTable
        ? countToday(supabase, s.countTable, s.countColumn, s.pending)
        : Promise.resolve(null),
    ),
  );

  const components: HealthComponentView[] = SURFACED.map((s, i) => {
    const row = checkMap.get(s.component);
    const meta = compMap.get(s.component);
    return {
      component: s.component,
      label: meta?.label ?? s.component,
      category: meta?.category ?? "ingestion",
      light: lightFor(row, s.cadenceSec),
      status: row?.status ?? "unknown",
      lastSuccessAt: row?.last_success_at ?? null,
      lastFailureAt: row?.last_failure_at ?? null,
      failureCount: row?.failure_count ?? 0,
      lastError: row?.last_error ?? null,
      count: counts[i],
      countLabel: s.countLabel,
    };
  });

  const overall = components.reduce<HealthLight>(
    (worst, c) => (WORST[c.light] > WORST[worst] ? c.light : worst),
    "healthy",
  );

  return { ok: true, data: { components, overall, generatedAt: new Date().toISOString() } };
}
