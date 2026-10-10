// Manual requests enter the durable queue; platform-worker owns capture.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  emailEnqueueCors,
  emailEnqueueFailure,
  handleEmailEnqueue,
} from "../_shared/email_enqueue.ts";
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: emailEnqueueCors });
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key)
    return emailEnqueueFailure("config_error", "Email queue is not configured.", 503);
  return handleEmailEnqueue(req, createClient(url, key), "email.gmail_sync");
});
