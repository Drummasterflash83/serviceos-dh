import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleEmergencyIntake } from "../_shared/receptionist-intake-webhook.ts";
import { emergencyIntakeIds } from "../_shared/receptionist-emergency-intake-gate.ts";
import { launchPromotionIds } from "../_shared/receptionist-launch-promotion.ts";

// Deliberately not a generic Vapi receiver. The only successful response is
// the fixed candidate-to-helper destination from the service-role RPC.
Deno.serve((req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return new Response('{"error":"Intake unavailable"}', {
    status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  const db = createClient(url, service, { auth: { persistSession: false } });
  let vapiKey: string | null = null;
  const key = async () => {
    if (vapiKey) return vapiKey;
    const workspace = await db.from("receptionist_workspaces")
      .select("assistant_id,vapi_secret_name").eq("tenant_id", emergencyIntakeIds.tenant).single();
    if (workspace.error || workspace.data?.assistant_id !== launchPromotionIds.live ||
        !/^[A-Z][A-Z0-9_]{2,80}$/.test(workspace.data?.vapi_secret_name ?? ""))
      throw Error("Provider binding unavailable");
    vapiKey = Deno.env.get(workspace.data.vapi_secret_name);
    if (!vapiKey) throw Error("Provider credential unavailable");
    return vapiKey;
  };
  const provider = async (path: string) => {
    const response = await fetch("https://api.vapi.ai/" + path, {
      redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { Authorization: "Bearer " + await key() },
    });
    if (!response.ok) throw Error("Provider verification unavailable");
    return response.json();
  };
  return handleEmergencyIntake(req, {
    token: Deno.env.get("EMMA_TEST_INTAKE_TOKEN") ?? "",
    now: () => new Date(),
    readCall: id => provider("call/" + id),
    readCandidate: () => provider("assistant/" + emergencyIntakeIds.candidate),
    readLive: () => provider("assistant/" + launchPromotionIds.live),
    installationVerified: async () => {
      const row = await db.from("receptionist_intake_installation")
        .select("state,candidate_id").eq("tenant_id", emergencyIntakeIds.tenant).maybeSingle();
      return !row.error && row.data?.state === "verified" &&
        row.data.candidate_id === emergencyIntakeIds.candidate;
    },
    record: values => db.rpc("receptionist_intake_record", values),
  });
});
