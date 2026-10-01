import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { timingSafeEqualStr } from "../_shared/marketing_tracking.ts";

// Existing platform scheduler credential. This endpoint only collects already
// authorised runs. It cannot start calls, change assistants or accept run IDs.
Deno.serve(async (req) => {
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("WORKER_SECRET");
  if (!secret || !timingSafeEqualStr(secret, req.headers.get("x-schedule-secret") ?? ""))
    return reply({ error: "Scheduler required" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, service, { auth: { persistSession: false } });
  const pending = await db
    .from("receptionist_test_runs")
    .select("id,tenant_id,actor_id")
    .eq("state", "running")
    .not("provider_id", "is", null)
    .order("updated_at")
    .limit(3);
  if (pending.error) return reply({ error: "Could not read pending checks" }, 503);
  const results = await Promise.all(
    (pending.data ?? []).map(async (r) => {
      try {
        const result = await fetch(url + "/functions/v1/receptionist-testing", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(45000),
          headers: { Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "refresh",
            tenantId: r.tenant_id,
            actorId: r.actor_id,
            runId: r.id,
          }),
        });
        return result.ok;
      } catch {
        return false;
      }
    }),
  );
  return reply({ checked: results.length, updated: results.filter(Boolean).length });
});
