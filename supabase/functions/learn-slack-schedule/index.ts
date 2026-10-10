import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { slackWorkerEndpoint } from "../_shared/slack/slack_worker_http.ts";
import { scheduleRecurringSlack } from "../_shared/slack/slack_recurring.ts";

// Install recurring schema and explicitly approve channel capture first.
// Deployment does not create a recurring trigger or reuse notification credentials.
Deno.serve(slackWorkerEndpoint(Deno.env.get('LEARN_SLACK_WORKER_KEY'),async()=>{
  const url=Deno.env.get('SUPABASE_URL'), key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url || !key) throw Error('worker_unavailable');
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  return await scheduleRecurringSlack(admin);
}));
