import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { commusoftVerificationEndpoint } from "../_shared/commusoft/verification_http.ts";
import { verifyCommusoftConnection } from "../_shared/commusoft/verify_connection.ts";

// No schedule or infrastructure trigger. Every execution starts with a verified
// user JWT and the existing effective-dated platform administrator authority.
const boundedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(15000) });
Deno.serve(
  commusoftVerificationEndpoint({
    authenticate: async (req) => {
      const url = Deno.env.get("SUPABASE_URL"),
        anon = Deno.env.get("SUPABASE_ANON_KEY");
      if (!url || !anon) throw Error("verification_unavailable");
      const authorization = req.headers.get("Authorization");
      if (!authorization?.startsWith("Bearer ")) return null;
      const client = createClient(url, anon, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: authorization }, fetch: boundedFetch },
      });
      const { data, error } = await client.auth.getUser(authorization.slice(7));
      if (error || !data.user?.id) return null;
      return { actorId: data.user.id, rpc: (name, args) => client.rpc(name, args) };
    },
    execute: async (tenant, request) => {
      const url = Deno.env.get("SUPABASE_URL"),
        key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !key) throw Error("verification_unavailable");
      const admin = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: boundedFetch },
      });
      return await verifyCommusoftConnection(tenant, request, {
        rpc: (name, args) => admin.rpc(name, args),
        signal: AbortSignal.timeout(45000),
      });
    },
  }),
);
