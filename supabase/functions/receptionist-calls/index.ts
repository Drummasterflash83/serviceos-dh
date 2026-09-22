// Read-only Vapi view. Does not ingest duplicate interactions or alter the assistant.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { scopedCalls, record } from "../_shared/receptionist-data.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const token = req.headers.get("authorization");
    if (!token) return reply({ error: "Sign in to view calls" }, 401);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: token } },
      auth: { persistSession: false },
    });
    const { data: user, error: authError } = await db.auth.getUser();
    if (authError || !user.user) return reply({ error: "Sign in to view calls" }, 401);
    const body = record(await req.json());
    if (typeof body.tenantId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.tenantId))
      return reply({ error: "Invalid workspace" }, 400);
    const { data: w, error } = await db
      .from("receptionist_workspaces")
      .select("assistant_id,vapi_secret_name")
      .eq("tenant_id", body.tenantId)
      .maybeSingle();
    if (error || !w) return reply({ error: "Workspace unavailable" }, 403);
    const key = Deno.env.get(w.vapi_secret_name);
    if (!key)
      return reply({
        connection: "not_configured",
        calls: [],
        nextCursor: null,
        checkedAt: new Date().toISOString(),
      });
    const url = new URL("https://api.vapi.ai/call");
    url.searchParams.set("assistantId", w.assistant_id);
    url.searchParams.set("limit", "100");
    if (body.before) {
      if (typeof body.before !== "string" || !Number.isFinite(Date.parse(body.before)))
        return reply({ error: "Invalid page" }, 400);
      url.searchParams.set("createdAtLt", new Date(body.before).toISOString());
    }
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      return reply(
        {
          error:
            response.status === 429
              ? "Vapi is busy. Please try again shortly."
              : "The Vapi connection needs attention.",
        },
        502,
      );
    const calls = scopedCalls(await response.json(), w.assistant_id);
    return reply({
      connection: "connected",
      calls,
      nextCursor: calls.length === 100 ? calls[calls.length - 1].createdAt : null,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return reply({ error: "Calls could not be refreshed. Please try again." }, 502);
  }
});
