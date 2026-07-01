/**
 * Supabase client — PLACEHOLDER.
 *
 * The `@supabase/supabase-js` SDK is intentionally NOT installed yet (keeping
 * the lockfile untouched for now), so this module does not import it. It only
 * resolves the public config from `VITE_*` env and exposes a stub so the rest
 * of the codebase can start importing a stable path.
 *
 * To activate later:
 *   1. `npm install @supabase/supabase-js`
 *   2. Uncomment the wiring below and delete the stub `getSupabaseClient`.
 *   3. Provide VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in `.env.local`.
 *
 * SECURITY: only the PUBLIC url + anon key are read here (both client-safe).
 * The service-role key must never be referenced from client-importable code.
 */

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

/**
 * Placeholder accessor. Throws until the SDK is installed and wired, so no
 * silent no-op client leaks into feature code.
 */
export function getSupabaseClient(): never {
  throw new Error(
    "Supabase client is not wired yet. Install @supabase/supabase-js and " +
      "replace the placeholder in src/lib/supabase.ts.",
  );
}

/*
 * --- Activation stub (kept commented until the SDK is added) ---
 *
 * import { createClient, type SupabaseClient } from "@supabase/supabase-js";
 *
 * let client: SupabaseClient | undefined;
 *
 * export function getSupabaseClient(): SupabaseClient {
 *   if (!isSupabaseConfigured()) {
 *     throw new Error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
 *   }
 *   if (!client) {
 *     client = createClient(supabaseConfig.url, supabaseConfig.anonKey);
 *   }
 *   return client;
 * }
 */
