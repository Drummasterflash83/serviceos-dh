// Marketing Provider Connections — typed client for the
// marketing-provider-connections Edge Function (Phase 9 — platform seams).
//
// HONESTY CONTRACT: zero provider adapters exist in this build. A connect
// attempt lands truthfully in error/'no_adapter'; sync refuses for every
// non-connected account; freshness is computed (never_run / error / stale /
// fresh) and nothing here ever shows a fabricated connected state, spend or
// CPL. Hidden controls are NOT the security boundary — the server enforces
// every permission again.

import { callMarketingFn } from "@/lib/marketing/call";
import type { ApiResult } from "@/lib/types";

const FN = "marketing-provider-connections";

export type ConnectionProvider = "meta" | "google_ads" | "linkedin" | "sheet";
export type ConnectionStatus = "preview" | "connecting" | "connected" | "error" | "revoked";
export type FreshnessState = "never_run" | "error" | "stale" | "fresh";

export interface ConnectionDescriptor {
  provider: ConnectionProvider;
  displayName: string;
  connectImplemented: boolean;
  syncImplemented: boolean;
  /** adapter verification depth — NEVER a tenant connection state */
  verification: "none" | "fixture_tested" | "live_verified";
  requirements: string[];
}

export interface ConnectionFreshness {
  state: FreshnessState;
  reason?: string;
  age_seconds?: number;
}

export interface ConnectionRunSummary {
  id: string;
  kind: "manual" | "scheduled";
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  error_class: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface DiscoveredExternalAccount {
  ref: string;
  name: string;
}

export interface ConnectionAccountRow {
  id: string;
  provider: ConnectionProvider;
  display_name: string;
  status: ConnectionStatus;
  status_reason: string | null;
  credential_state: "unconfigured" | "configured";
  connected_at: string | null;
  revoked_at: string | null;
  last_synced_at: string | null;
  stale_after_seconds: number;
  sync_cadence_minutes: number | null;
  adapter_version: string | null;
  external_account_ref: string | null;
  external_account_name: string | null;
  discovered_accounts: DiscoveredExternalAccount[];
  version: number;
  created_at: string;
  freshness: ConnectionFreshness;
  latest_run: ConnectionRunSummary | null;
}

export interface ConnectionReport {
  account_id: string;
  health: "healthy" | "degraded" | "error" | "never_run" | "revoked" | ConnectionStatus;
  totals: {
    spend: number | null;
    spend_unavailable_reason?: string | null;
    currencies: string[];
    leads: number | null;
    leads_unavailable_reason?: string | null;
  };
  cpl: { value: number | null; unavailable_reason?: string | null };
  campaigns: { external_ref: string; name: string | null }[];
  metrics: Record<string, unknown>[];
  metrics_status: { state: "available" | "unavailable"; reason?: string };
  latest_run: ConnectionRunSummary | null;
}

export function newConnectionRequestId(): string {
  return `conn-${crypto.randomUUID()}`;
}

export function getConnectionCatalogue(): Promise<
  ApiResult<{ providers: ConnectionDescriptor[] }>
> {
  return callMarketingFn(FN, { action: "catalogue" });
}

export function listConnections(): Promise<ApiResult<{ accounts: ConnectionAccountRow[] }>> {
  return callMarketingFn(FN, { action: "list" });
}

export function createConnection(
  provider: ConnectionProvider,
  displayName: string,
  requestId: string,
): Promise<ApiResult<{ id: string; provider: string; status: string; version: number }>> {
  return callMarketingFn(FN, {
    action: "account_create",
    provider,
    display_name: displayName,
    request_id: requestId,
  });
}

export function connectConnection(
  accountId: string,
  expectedVersion: number,
  requestId: string,
): Promise<
  ApiResult<{
    id: string;
    status: string;
    status_reason: string | null;
    version: number;
    adapter_implemented: boolean;
  }>
> {
  return callMarketingFn(FN, {
    action: "connect",
    account_id: accountId,
    expected_version: expectedVersion,
    request_id: requestId,
  });
}

export function setConnectionCredential(
  accountId: string,
  expectedVersion: number,
  credential: string,
  requestId: string,
): Promise<ApiResult<{ id: string; credential_state: string; stored: boolean; note?: string }>> {
  return callMarketingFn(FN, {
    action: "credential_set",
    account_id: accountId,
    expected_version: expectedVersion,
    credential,
    request_id: requestId,
  });
}

export function revokeConnection(
  accountId: string,
  expectedVersion: number,
  requestId: string,
): Promise<ApiResult<{ id: string; status: string; version: number }>> {
  return callMarketingFn(FN, {
    action: "revoke",
    account_id: accountId,
    expected_version: expectedVersion,
    request_id: requestId,
  });
}

export function requestConnectionSync(
  accountId: string,
  requestId: string,
): Promise<ApiResult<{ run_id: string; status: string }>> {
  return callMarketingFn(FN, {
    action: "sync_request",
    account_id: accountId,
    request_id: requestId,
  });
}

export function selectExternalAccount(
  accountId: string,
  expectedVersion: number,
  externalRef: string,
  requestId: string,
): Promise<ApiResult<{ id: string; external_account_ref: string; external_account_name: string }>> {
  return callMarketingFn(FN, {
    action: "external_select",
    account_id: accountId,
    expected_version: expectedVersion,
    external_ref: externalRef,
    request_id: requestId,
  });
}

export function getConnectionReport(accountId: string): Promise<ApiResult<ConnectionReport>> {
  return callMarketingFn(FN, { action: "report", account_id: accountId });
}

export function listConnectionRuns(
  accountId: string,
): Promise<ApiResult<{ runs: ConnectionRunSummary[] }>> {
  return callMarketingFn(FN, { action: "runs", account_id: accountId });
}
