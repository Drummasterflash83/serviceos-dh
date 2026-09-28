// Registered but not installed by migration. Three independent lanes keep alerts
// responsive while provider review is slow or credit is unavailable.
import { careSecretMatches } from "../_shared/care-worker-auth.ts";
Deno.serve(async (request) => {
  const secret = Deno.env.get("RECEPTIONIST_CARE_WORKER_SECRET");
  if (
    request.method !== "POST" ||
    !careSecretMatches(secret, request.headers.get("x-schedule-secret"))
  )
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  const origin = Deno.env.get("SUPABASE_URL");
  if (!origin) return Response.json({ error: "Worker unavailable" }, { status: 503 });
  const results = await Promise.all(
    ["alerts", "scan", "review"].map(async (lane) => {
      try {
        const response = await fetch(`${origin}/functions/v1/receptionist-care-worker`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(120000),
          headers: { "Content-Type": "application/json", "x-care-secret": secret! },
          body: JSON.stringify({ lane }),
        });
        return { lane, completed: response.ok };
      } catch {
        return { lane, completed: false };
      }
    }),
  );
  return Response.json({ results }, { status: results.every((r) => r.completed) ? 200 : 503 });
});
