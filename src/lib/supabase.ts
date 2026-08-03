/**
 * Supabase browser client.
 *
 * Resolves the PUBLIC config from `VITE_*` env and lazily creates a singleton
 * client using the anon/publishable key. Only client-safe values are read here
 * — the service-role key must never be referenced from client-importable code.
 *
 * SSR note: `createClient` is only invoked via `getSupabaseClient()`, which the
 * auth layer calls inside effects / event handlers (browser only). The client
 * is configured to persist and auto-refresh the session in the browser.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { SupabasePublicConfig } from "./types";

/** Public config from Vite-injected env. Values are empty until `.env.local` is set. */
export const supabaseConfig: SupabasePublicConfig = {
  url: import.meta.env.VITE_SUPABASE_URL ?? "",
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
};

/** True once both public env values are present. */
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseConfig.url && supabaseConfig.anonKey);
}

let client: SupabaseClient | undefined;

/**
 * Return the singleton Supabase client. Throws if the public env is missing so
 * callers surface a clear configuration error rather than a silent no-op.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
  }
  if (!client) {
    client = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Required for recovery links: Supabase exchanges the URL tokens for
        // a short-lived authenticated session before the user sets a password.
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

/**
 * The current user's access token (JWT), or null when not configured / signed
 * out. Edge Function calls send this as the bearer so functions can verify the
 * user and bind the tenant server-side.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const { data } = await getSupabaseClient().auth.getSession();
  return data.session?.access_token ?? null;
}
