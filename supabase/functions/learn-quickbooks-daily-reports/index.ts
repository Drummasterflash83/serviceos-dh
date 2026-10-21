import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { slackWorkerEndpoint } from "../_shared/slack/slack_worker_http.ts";
import { quickBooksDiagnosticFetch } from "../_shared/quickbooks/provider_trace.ts";
import { runDailyQuickBooksReports } from "../_shared/quickbooks/daily_reports.ts";

// No schedule is installed by this function. The separate versioned host
// trigger uses a dedicated key and an empty POST body.
Deno.serve(slackWorkerEndpoint(Deno.env.get("LEARN_QUICKBOOKS_DAILY_REPORT_KEY"), async () => {
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw Error("worker_unavailable");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return runDailyQuickBooksReports({
    rpc: (name, args) => db.rpc(name, args),
    fetcher: quickBooksDiagnosticFetch(),
    signal: AbortSignal.timeout(85000),
  });
}));
