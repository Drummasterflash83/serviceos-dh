/**
 * Command Centre feed — browser accessor. The thin, browser-only wrapper over the
 * client-agnostic feed logic in ./command-feed: it resolves the RLS browser client and
 * runs the SAME fetch + pure mapping the demo export uses. All types + the fetch/mapping
 * live in ./command-feed and are re-exported here so existing imports are unchanged.
 *
 * No new architecture: same getSupabaseClient() + ApiResult<T> pattern as every other
 * lib module (see recommendations.ts). No writes, no Edge Functions, no side effects.
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import { fetchCommandRows, mapCommandFeed, type CommandFeed } from "./command-feed";
import type { ApiResult } from "./types";

export * from "./command-feed";

export interface CommandFeedOptions {
  perSource?: number;
}

/** Authenticated feed: fetch via the RLS browser client (tenant scoped by the session)
 *  then map. The demo export uses fetchCommandRows + mapCommandFeed directly. */
export async function getCommandFeed(
  opts: CommandFeedOptions = {},
): Promise<ApiResult<CommandFeed>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const rows = await fetchCommandRows(supabase, { perSource: opts.perSource });
  return { ok: true, data: mapCommandFeed(rows) };
}
