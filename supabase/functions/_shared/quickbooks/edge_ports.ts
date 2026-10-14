// Server-only Deno adapter. Logs only bounded provider response metadata.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { quickBooksDiagnosticFetch } from "./provider_trace.ts";
export function quickBooksEdgePorts() {
  const url = Deno.env.get("SUPABASE_URL"),
    anon = Deno.env.get("SUPABASE_ANON_KEY"),
    service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const siteOrigin = Deno.env.get("QUICKBOOKS_SITE_ORIGIN"),
    minor = Deno.env.get("QUICKBOOKS_MINOR_VERSION");
  if (!url || !anon || !service || !siteOrigin || !minor || !/^\d{1,4}$/.test(minor))
    throw new Error("configuration_unavailable");
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  };
  const server = createClient(url, service, options);
  return {
    siteOrigin,
    fetcher: quickBooksDiagnosticFetch(),
    minorVersion: Number(minor),
    serviceRpc: (name: string, args: Record<string, unknown>) => server.rpc(name, args),
    userRpc: async (jwt: string) => {
      const user = createClient(url, anon, {
        ...options,
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const result = await user.auth.getUser(jwt);
      if (result.error || !result.data.user) return null;
      return (name: string, args: Record<string, unknown>) => user.rpc(name, args);
    },
  };
}
