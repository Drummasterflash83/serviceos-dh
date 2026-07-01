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
