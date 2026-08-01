// Marketing Ads — typed client for the marketing-ads Edge Function (Phase 8).
// Ads captures and attributes leads; it does not create or edit adverts.
// Hidden controls are NOT the security boundary — the server enforces every
// permission again, and the browser can never insert provider events,
// attribution touchpoints or metric facts.

import { callMarketingFn } from "@/lib/marketing/call";
import type { ApiResult } from "@/lib/types";

const FN = "marketing-ads";

export type AdsProvider = "meta" | "google_ads" | "linkedin" | "webhook" | "sheet";
export type AdsSourceStatus = "active" | "disabled" | "archived";
export type AdsEventState = "pending" | "processing" | "resolved" | "review" | "failed";

export interface AdsAdapterDescriptor {
  provider: AdsProvider;
  version: string;
  displayName: string;
  mode: "api" | "webhook" | "sheet";
  implemented: boolean;
  defaultConnectionState: "ready_after_credential" | "not_connected";
  capabilities: Record<string, boolean>;
  requirements: string[];
}

export interface AdSourceRow {
  id: string;
  provider: AdsProvider;
  mode: string;
  name: string;
  status: AdsSourceStatus;
  version: number;
  credential_state: "unconfigured" | "configured";
  connection_state: "ready" | "configuration_required" | "not_connected";
  public_key: string | null;
  account_ref: string | null;
  campaign_ref: string | null;
  form_ref: string | null;
  default_relationship_type: string | null;
  default_lifecycle_stage_key: string | null;
  last_event_at: string | null;
  last_processed_at: string | null;
  created_at: string;
  events_7d: number;
  pending: number;
  failed: number;
  review: number;
}

export interface AdsLeadRow {
  event_id: string;
  source_id: string;
  source_name: string | null;
  provider: string;
  state: AdsEventState;
  error_class: string | null;
  received_at: string;
  occurred_at: string;
  replay_count: number;
  lead_name: string;
  person_id: string | null;
  person_name: string | null;
  lifecycle: string | null;
  conflict_id: string | null;
  interaction_id: string | null;
  campaign_ref: string | null;
  form_ref: string | null;
}

export interface AdsHealthRow {
  id: string;
  name: string;
  provider: string;
  mode: string;
  status: AdsSourceStatus;
  connection_state: string;
  last_event_at: string | null;
  last_processed_at: string | null;
  pending: number;
  failed: number;
  review: number;
  oldest_pending_seconds: number | null;
  replay_conflicts: number;
  metric_freshness: string | null;
  sync_supported: boolean;
  attention: boolean;
  remediation: string | null;
}

export interface AdsMetricsData {
  facts: Array<Record<string, unknown>>;
  totals: {
    spend: number | null;
    currency: string | null;
    provider_leads: number | null;
    received_events: number;
    resolved_people: number;
  };
  cpl_provider: number | null;
  cpl_received: number | null;
  cpl_unavailable_reason: string | null;
  note: string;
}

export function newAdsRequestId(): string {
  return `ads-${crypto.randomUUID()}`;
}

export function getAdsOverview(): Promise<ApiResult<Record<string, unknown>>> {
  return callMarketingFn(FN, { action: "overview" });
}
export function getAdsCatalogue(): Promise<ApiResult<{ providers: AdsAdapterDescriptor[] }>> {
  return callMarketingFn(FN, { action: "catalogue" });
}
export function listAdSources(
  status?: AdsSourceStatus,
): Promise<ApiResult<{ sources: AdSourceRow[] }>> {
  return callMarketingFn(FN, { action: "source_list", ...(status ? { status } : {}) });
}
export function getAdSourceDetail(sourceId: string): Promise<ApiResult<Record<string, unknown>>> {
  return callMarketingFn(FN, { action: "source_detail", source_id: sourceId });
}
export function createAdSource(
  input: {
    provider: AdsProvider;
    name: string;
    description?: string;
    campaign_ref?: string;
    form_ref?: string;
    default_tag_id?: string;
    default_relationship_type?: string;
    default_lifecycle_stage_key?: string;
    default_owner_id?: string;
    timezone?: string;
  },
  requestId: string,
): Promise<ApiResult<{ id: string; public_key: string | null; version: number }>> {
  return callMarketingFn(FN, { action: "source_create", ...input, request_id: requestId });
}
export function reviseAdSource(
  sourceId: string,
  expectedVersion: number,
  changes: Record<string, unknown>,
  requestId: string,
): Promise<ApiResult<{ id: string; version: number }>> {
  return callMarketingFn(FN, {
    action: "source_revise",
    source_id: sourceId,
    expected_version: expectedVersion,
    changes,
    request_id: requestId,
  });
}
export function setAdSourceStatus(
  sourceId: string,
  expectedVersion: number,
  status: AdsSourceStatus,
  requestId: string,
): Promise<ApiResult<{ id: string; status: AdsSourceStatus; version: number }>> {
  return callMarketingFn(FN, {
    action: "source_status",
    source_id: sourceId,
    expected_version: expectedVersion,
    status,
    request_id: requestId,
  });
}
export function setupAdWebhook(
  sourceId: string,
  expectedVersion: number,
  requestId: string,
): Promise<
  ApiResult<{
    public_key: string;
    endpoint_path: string;
    signing_secret: string;
    shown_once: true;
    version: number;
    note: string;
  }>
> {
  return callMarketingFn(FN, {
    action: "webhook_setup",
    source_id: sourceId,
    expected_version: expectedVersion,
    request_id: requestId,
  });
}
export function manualAdSync(
  sourceId: string,
  requestId: string,
): Promise<ApiResult<Record<string, unknown>>> {
  return callMarketingFn(FN, { action: "manual_sync", source_id: sourceId, request_id: requestId });
}
export function retryAdEvent(
  eventId: string,
  requestId: string,
): Promise<ApiResult<{ event_id: string; state: string }>> {
  return callMarketingFn(FN, { action: "event_retry", event_id: eventId, request_id: requestId });
}
export function getAdsLeadFeed(args: {
  window?: "today" | "7d" | "30d" | "all";
  source_id?: string;
  state?: AdsEventState;
  limit?: number;
  cursor?: { at: string; id: string } | null;
}): Promise<
  ApiResult<{
    leads: AdsLeadRow[];
    next_cursor: { at: string; id: string } | null;
    counts: Record<string, number>;
  }>
> {
  return callMarketingFn(FN, { action: "lead_feed", ...args });
}
export function getAdsLeadDetail(eventId: string): Promise<ApiResult<Record<string, unknown>>> {
  return callMarketingFn(FN, { action: "lead_detail", event_id: eventId });
}
export function getAdsAttribution(personId: string): Promise<ApiResult<Record<string, unknown>>> {
  return callMarketingFn(FN, { action: "attribution", person_id: personId });
}
export function getAdsMetrics(args: {
  source_id?: string;
  from?: string;
  to?: string;
}): Promise<ApiResult<AdsMetricsData>> {
  return callMarketingFn(FN, { action: "metrics", ...args });
}
export function getAdsHealth(): Promise<ApiResult<{ sources: AdsHealthRow[] }>> {
  return callMarketingFn(FN, { action: "health" });
}
