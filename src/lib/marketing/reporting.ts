// Marketing Reporting & Objectives — typed client for the marketing-reporting
// Edge Function (Phase 7). Every number comes from the canonical per-type
// report authorities composed server-side; the browser performs NO
// authoritative joins or metric calculations. Unknown/unavailable metrics are
// null with a reason — never zero, and the UI must render them that way.

import { callMarketingFn } from "@/lib/marketing/call";
import type { ApiResult } from "@/lib/types";

const FN = "marketing-reporting";

export interface OverviewFilters {
  campaign_type?: "broadcast" | "sequence";
  status?: string;
  objective_id?: string;
  created_from?: string;
  created_to?: string;
  search?: string;
  limit?: number;
  cursor?: { at: string; id: string } | null;
}

export interface OverviewRow {
  id: string;
  name: string;
  campaign_type: "broadcast" | "sequence";
  status: string;
  created_at: string;
  launched_at: string | null;
  completed_at: string | null;
  schedule_at: string | null;
  objective_id: string | null;
  objective_title: string | null;
  // the canonical per-type report payload, verbatim
  report: Record<string, unknown>;
}

export interface OverviewData {
  campaigns: OverviewRow[];
  next_cursor: { at: string; id: string } | null;
  totals: {
    campaigns: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
  };
}

export interface ObjectiveSearchRow {
  id: string;
  title: string;
  objective_type: string;
  status: string;
  target_at: string | null;
  health: { status: string; evaluated_at: string } | null;
}

export interface ObjectiveContext {
  campaign_id: string;
  linked: boolean;
  note?: string;
  link?: {
    id: string;
    relation: string;
    expected_contribution: string | null;
    rationale: string | null;
    created_by: string | null;
    created_at: string;
    verification_state: string | null;
  };
  objective?: {
    id: string;
    title: string;
    objective_type: string;
    status: string;
    target_at: string | null;
  };
  health?: {
    status: string;
    progress: number | null;
    confidence: number | null;
    reasons: string[];
    stale_measurements: string[];
    evaluated_at: string;
    age_seconds: number;
  } | null;
  health_state?: "never_evaluated" | "stale" | "current";
  primary_metric?: {
    metric_key: string;
    metric_name: string;
    unit: string | null;
    baseline: number | null;
    target: number | null;
    direction: string;
    current: number | null;
    current_measured_at: string | null;
    comparability: "comparable" | "no_measurement" | "unit_mismatch" | "currency_mismatch";
  } | null;
  contribution?: {
    state: string | null;
    confidence?: number | null;
    evaluated_at?: string;
    observed_movement?: number | null;
    note?: string;
  };
  history_count?: number;
  history?: Array<{
    action: "linked" | "superseded" | "unlinked";
    objective_id: string;
    relation: string | null;
    expected_contribution: string | null;
    rationale: string | null;
    campaign_version: number;
    created_at: string;
  }>;
}

export interface CampaignReportData {
  id: string;
  name: string;
  campaign_type: "broadcast" | "sequence";
  status: string;
  version: number;
  created_at: string;
  launched_at: string | null;
  completed_at: string | null;
  report: Record<string, unknown>;
  objective_context: ObjectiveContext;
  template_lineage: Array<Record<string, unknown>>;
}

export function getReportingOverview(
  filters: OverviewFilters = {},
): Promise<ApiResult<OverviewData>> {
  return callMarketingFn(FN, { action: "overview", ...filters });
}

export function getCampaignReporting(campaignId: string): Promise<ApiResult<CampaignReportData>> {
  return callMarketingFn(FN, { action: "campaign_report", campaign_id: campaignId });
}

export function searchObjectives(
  search?: string,
  limit?: number,
): Promise<ApiResult<{ objectives: ObjectiveSearchRow[] }>> {
  return callMarketingFn(FN, {
    action: "objective_search",
    ...(search ? { search } : {}),
    ...(limit ? { limit } : {}),
  });
}

export function getObjectiveContext(campaignId: string): Promise<ApiResult<ObjectiveContext>> {
  return callMarketingFn(FN, { action: "objective_context", campaign_id: campaignId });
}

export function linkObjective(args: {
  campaign_id: string;
  expected_version: number;
  objective_id: string;
  relation?: "supports" | "contributes_to";
  expected_contribution?: string;
  rationale?: string;
  request_id: string;
}): Promise<ApiResult<{ campaign_id: string; objective_link_id: string; version: number }>> {
  return callMarketingFn(FN, { action: "link_objective", ...args });
}

export function unlinkObjective(args: {
  campaign_id: string;
  expected_version: number;
  rationale?: string;
}): Promise<ApiResult<{ campaign_id: string; version: number }>> {
  return callMarketingFn(FN, { action: "unlink_objective", ...args });
}

export function newObjectiveLinkRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `olk-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
