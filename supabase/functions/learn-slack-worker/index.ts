import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleSlackHistorySync } from "../_shared/worker_handlers/slack_history.ts";
import { handleSlackEventSync } from "../_shared/slack/slack_event_worker.ts";
import { runSlackWorker } from "../_shared/slack/slack_worker.ts";
import { slackWorkerEndpoint } from "../_shared/slack/slack_worker_http.ts";

// One page/job per request; no broad handler registry, lease sweep or schedule.
// The schema release and exact-reference Vault resolver must precede deployment.
Deno.serve(
  slackWorkerEndpoint(Deno.env.get("LEARN_SLACK_WORKER_KEY"), async () => {
    const url = Deno.env.get("SUPABASE_URL"),
      key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw Error("worker_unavailable");
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return await runSlackWorker(
      admin,
      crypto.randomUUID(),
      (ctx) => ctx.jobType === "slack.event_sync"
        ? handleSlackEventSync(ctx) : handleSlackHistorySync(ctx),
      AbortSignal.timeout(90000),
    );
  }),
);
