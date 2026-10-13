import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { runQuickBooksImport } from "../_shared/quickbooks/import_worker.ts";
import { slackWorkerEndpoint as infrastructureWorkerEndpoint } from "../_shared/slack/slack_worker_http.ts";
import { quickBooksDiagnosticFetch } from "../_shared/quickbooks/provider_trace.ts";
Deno.serve(
  infrastructureWorkerEndpoint(Deno.env.get("LEARN_QUICKBOOKS_WORKER_KEY"), async () => {
    const url = Deno.env.get("SUPABASE_URL"),
      key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw Error("worker_unavailable");
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await runQuickBooksImport({
      rpc: (name, args) => db.rpc(name, args),
      signal: AbortSignal.timeout(85000),
      fetcher: quickBooksDiagnosticFetch(),
    });
    // Infrastructure replies contain only aggregate execution state, never source
    // records, accounting amounts, tenant IDs, provider tokens or raw exceptions.
    return { claimed: result.claimed, state: result.state };
  }),
);
