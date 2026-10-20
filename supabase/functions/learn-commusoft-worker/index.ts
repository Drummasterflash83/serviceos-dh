import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { runCommusoftWorker } from "../_shared/commusoft/worker.ts";
import { runCommusoftFreshness } from "../_shared/commusoft/freshness_worker.ts";
// The existing infrastructure HTTP guard is provider-neutral despite its path.
import { slackWorkerEndpoint as infrastructureWorkerEndpoint } from "../_shared/slack/slack_worker_http.ts";

// One durable source page per invocation. No schedule or caller-selected scope.
// Deploy only after schema/catalog acceptance and explicit trigger-key binding.
Deno.serve(
  infrastructureWorkerEndpoint(Deno.env.get("LEARN_COMMUSOFT_WORKER_KEY"), async () => {
    const url = Deno.env.get("SUPABASE_URL"),
      key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw Error("worker_unavailable");
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const source = await runCommusoftWorker(
      admin,
      crypto.randomUUID(),
      undefined,
      AbortSignal.timeout(90000),
    );
    // The ordinary source page gets first opportunity. Both reads share the
    // credential lease, so a pending freshness page may yield and try later.
    const freshness = await runCommusoftFreshness(admin, AbortSignal.timeout(20000));
    return { ...source, freshness: freshness.state };
  }),
);
