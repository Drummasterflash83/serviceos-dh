/**
 * Shared backend/data types for ServiceOS.
 *
 * Foundation only — generic building blocks used by the data/API layer.
 * Domain-specific types (calls, jobs, customers, integrations) will be added
 * per-module as the backend is wired. Nothing here is imported by the UI yet.
 */

/** Standard result envelope returned by the API helper in `./api`. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** Normalised error shape so callers never depend on raw fetch/throw details. */
export interface ApiError {
  /** Machine-readable code, e.g. "http_500", "network", "parse". */
  code: string;
  /** Human-readable message, safe to log. */
  message: string;
  /** HTTP status when the failure came from a response. */
  status?: number;
}

/** Generic cursor/offset pagination envelope (mirrors common REST list shapes). */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  nextPage?: number | null;
  prevPage?: number | null;
}

/** Public Supabase config resolved from `VITE_*` env (see `./supabase`). */
export interface SupabasePublicConfig {
  url: string;
  anonKey: string;
}

/** Safe, credential-free account summary returned by the Simwood test. */
export interface SimwoodCustomerSummary {
  id: string | null;
  name: string | null;
  type: string | null;
}

/** Result of the `simwood-test-connection` Edge Function (no secrets). */
export interface SimwoodConnectionResult {
  provider: string;
  customers: SimwoodCustomerSummary[];
  customerCount: number;
}

/** Input to the `simwood-sync-calls` Edge Function (Phase-1 call history sync). */
export interface SimwoodSyncCallsInput {
  tenantId: string;
  /** Simwood customer id; discovered server-side when omitted. */
  providerCustomerId?: string;
  /** ISO date — start of the sync window. Defaults server-side to now-24h. */
  from?: string;
  /** ISO date — end of the sync window. Defaults server-side to now. */
  to?: string;
  direction?: "inbound" | "outbound";
  /** Max records to process this run. */
  limit?: number;
}

/** Safe summary returned by `simwood-sync-calls`. */
export interface SimwoodSyncCallsResult {
  success: boolean;
  provider: string;
  records_processed: number;
  from: string;
  to: string;
  customer_id: string | null;
  sync_run_id: string | null;
}
